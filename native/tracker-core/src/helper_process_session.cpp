#include "helper_process_session.h"

#include "helper_message.h"

#include <chrono>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

// v0.13.0 reusable Native Core helper session (#533).
//
// Owns one synthetic helper child and its three private pipes. No camera frame
// pixels are ever sent to the helper (that is #534). Helper stdout/stderr stay
// private to Native Core; child stderr is drained and validated (safe "[helper] "
// prefix + bounded line size) but never forwarded. Every message line is bounded
// to kHelperMaxLineBytes, enforced while accumulating a partial line. No temp
// files, sockets, shared memory, or network behavior.

namespace lvk::tracker {
namespace {

long long nowMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

std::string buildRequestLine(std::uint64_t requestId, long long frameTimestampMs) {
  std::string line = "{\"type\":\"request\",\"schemaVersion\":1,\"requestId\":";
  line += std::to_string(requestId);
  line += ",\"frameTimestampMs\":";
  line += std::to_string(frameTimestampMs);
  line += "}\n";
  return line;
}

}  // namespace
}  // namespace lvk::tracker

// ===========================================================================
// Platform layer: process launch, bounded pipe I/O, and cleanup. Each stream is
// read non-blocking in a single bounded poll loop so neither the child nor
// Native Core can block indefinitely.
// ===========================================================================

#ifdef _WIN32

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

namespace lvk::tracker {

struct HelperSessionHandles {
  HANDLE childStdinWrite = nullptr;
  HANDLE childStdoutRead = nullptr;
  HANDLE childStderrRead = nullptr;
  HANDLE process = nullptr;
  HANDLE thread = nullptr;
  bool launched = false;
};

namespace {

std::string quoteArgument(const std::string& value) {
  return "\"" + value + "\"";
}

bool platformLaunch(
    HelperSessionHandles& handles,
    const std::string& executablePath,
    const std::vector<std::string>& arguments) {
  SECURITY_ATTRIBUTES securityAttributes{};
  securityAttributes.nLength = sizeof(securityAttributes);
  securityAttributes.bInheritHandle = TRUE;
  securityAttributes.lpSecurityDescriptor = nullptr;

  HANDLE stdinRead = nullptr;
  HANDLE stdinWrite = nullptr;
  HANDLE stdoutRead = nullptr;
  HANDLE stdoutWrite = nullptr;
  HANDLE stderrRead = nullptr;
  HANDLE stderrWrite = nullptr;

  if (!CreatePipe(&stdinRead, &stdinWrite, &securityAttributes, 0)) {
    return false;
  }
  if (!CreatePipe(&stdoutRead, &stdoutWrite, &securityAttributes, 0)) {
    CloseHandle(stdinRead);
    CloseHandle(stdinWrite);
    return false;
  }
  if (!CreatePipe(&stderrRead, &stderrWrite, &securityAttributes, 0)) {
    CloseHandle(stdinRead);
    CloseHandle(stdinWrite);
    CloseHandle(stdoutRead);
    CloseHandle(stdoutWrite);
    return false;
  }

  // The parent's own ends must not be inherited by the child.
  SetHandleInformation(stdinWrite, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0);

  STARTUPINFOA startupInfo{};
  startupInfo.cb = sizeof(startupInfo);
  startupInfo.dwFlags = STARTF_USESTDHANDLES;
  startupInfo.hStdInput = stdinRead;
  startupInfo.hStdOutput = stdoutWrite;
  startupInfo.hStdError = stderrWrite;

  std::string commandLine = quoteArgument(executablePath);
  for (const std::string& argument : arguments) {
    commandLine += " ";
    commandLine += quoteArgument(argument);
  }
  std::vector<char> commandLineBuffer(commandLine.begin(), commandLine.end());
  commandLineBuffer.push_back('\0');

  PROCESS_INFORMATION processInfo{};
  const BOOL launched = CreateProcessA(
      nullptr, commandLineBuffer.data(), nullptr, nullptr, TRUE, 0, nullptr,
      nullptr, &startupInfo, &processInfo);

  // The child now owns its ends; the parent closes the child-side handles.
  CloseHandle(stdinRead);
  CloseHandle(stdoutWrite);
  CloseHandle(stderrWrite);

  if (!launched) {
    CloseHandle(stdinWrite);
    CloseHandle(stdoutRead);
    CloseHandle(stderrRead);
    return false;
  }

  handles.childStdinWrite = stdinWrite;
  handles.childStdoutRead = stdoutRead;
  handles.childStderrRead = stderrRead;
  handles.process = processInfo.hProcess;
  handles.thread = processInfo.hThread;
  handles.launched = true;
  return true;
}

bool platformWriteAll(
    HelperSessionHandles& handles, const char* data, std::size_t length) {
  if (handles.childStdinWrite == nullptr) {
    return false;
  }
  std::size_t written = 0;
  while (written < length) {
    DWORD chunk = 0;
    const DWORD toWrite = static_cast<DWORD>(length - written);
    if (!WriteFile(
            handles.childStdinWrite, data + written, toWrite, &chunk, nullptr) ||
        chunk == 0) {
      return false;
    }
    written += chunk;
  }
  return true;
}

void platformPump(
    HelperSessionHandles& handles,
    int timeoutMs,
    std::string& stdoutBuffer,
    bool& stdoutEof,
    std::string& stderrBuffer,
    bool& stderrEof) {
  char buffer[4096];
  bool readAny = false;

  const auto tryRead =
      [&](HANDLE pipe, std::string& buf, bool& eof) {
        if (eof || pipe == nullptr) {
          return;
        }
        DWORD available = 0;
        if (!PeekNamedPipe(pipe, nullptr, 0, nullptr, &available, nullptr)) {
          eof = true;  // broken pipe: child closed this stream
          return;
        }
        if (available == 0) {
          return;
        }
        const DWORD toRead =
            available < sizeof(buffer) ? available : sizeof(buffer);
        DWORD readBytes = 0;
        if (ReadFile(pipe, buffer, toRead, &readBytes, nullptr) &&
            readBytes > 0) {
          buf.append(buffer, readBytes);
          readAny = true;
        } else {
          eof = true;
        }
      };

  tryRead(handles.childStdoutRead, stdoutBuffer, stdoutEof);
  tryRead(handles.childStderrRead, stderrBuffer, stderrEof);

  if (!readAny && timeoutMs > 0) {
    Sleep(timeoutMs < 5 ? static_cast<DWORD>(timeoutMs) : 5u);
  }
}

bool platformWaitExit(HelperSessionHandles& handles, int timeoutMs) {
  if (handles.process == nullptr) {
    return true;
  }
  const DWORD waitMs = timeoutMs < 0 ? INFINITE : static_cast<DWORD>(timeoutMs);
  return WaitForSingleObject(handles.process, waitMs) == WAIT_OBJECT_0;
}

void platformForceTerminate(HelperSessionHandles& handles) {
  if (handles.process == nullptr) {
    return;
  }
  TerminateProcess(handles.process, 1);
  WaitForSingleObject(handles.process, 2000);
}

void platformClose(HelperSessionHandles& handles) {
  if (handles.childStdinWrite != nullptr) {
    CloseHandle(handles.childStdinWrite);
    handles.childStdinWrite = nullptr;
  }
  if (handles.childStdoutRead != nullptr) {
    CloseHandle(handles.childStdoutRead);
    handles.childStdoutRead = nullptr;
  }
  if (handles.childStderrRead != nullptr) {
    CloseHandle(handles.childStderrRead);
    handles.childStderrRead = nullptr;
  }
  if (handles.process != nullptr) {
    CloseHandle(handles.process);
    handles.process = nullptr;
  }
  if (handles.thread != nullptr) {
    CloseHandle(handles.thread);
    handles.thread = nullptr;
  }
  handles.launched = false;
}

}  // namespace
}  // namespace lvk::tracker

#else  // POSIX

#include <cerrno>
#include <csignal>
#include <ctime>

#include <fcntl.h>
#include <poll.h>
#include <sys/wait.h>
#include <unistd.h>

namespace lvk::tracker {

struct HelperSessionHandles {
  int stdinWrite = -1;
  int stdoutRead = -1;
  int stderrRead = -1;
  pid_t pid = -1;
  bool launched = false;
};

namespace {

void sleepMs(int milliseconds) {
  struct timespec request{};
  request.tv_sec = milliseconds / 1000;
  request.tv_nsec = static_cast<long>(milliseconds % 1000) * 1000000L;
  nanosleep(&request, nullptr);
}

bool platformLaunch(
    HelperSessionHandles& handles,
    const std::string& executablePath,
    const std::vector<std::string>& arguments) {
  int stdinPipe[2];
  int stdoutPipe[2];
  int stderrPipe[2];
  if (pipe(stdinPipe) != 0) {
    return false;
  }
  if (pipe(stdoutPipe) != 0) {
    close(stdinPipe[0]);
    close(stdinPipe[1]);
    return false;
  }
  if (pipe(stderrPipe) != 0) {
    close(stdinPipe[0]);
    close(stdinPipe[1]);
    close(stdoutPipe[0]);
    close(stdoutPipe[1]);
    return false;
  }

  const pid_t pid = fork();
  if (pid < 0) {
    close(stdinPipe[0]);
    close(stdinPipe[1]);
    close(stdoutPipe[0]);
    close(stdoutPipe[1]);
    close(stderrPipe[0]);
    close(stderrPipe[1]);
    return false;
  }

  if (pid == 0) {
    // Child: wire pipe ends to std streams.
    dup2(stdinPipe[0], STDIN_FILENO);
    dup2(stdoutPipe[1], STDOUT_FILENO);
    dup2(stderrPipe[1], STDERR_FILENO);
    close(stdinPipe[0]);
    close(stdinPipe[1]);
    close(stdoutPipe[0]);
    close(stdoutPipe[1]);
    close(stderrPipe[0]);
    close(stderrPipe[1]);

    std::vector<char*> argv;
    argv.push_back(const_cast<char*>(executablePath.c_str()));
    for (const std::string& argument : arguments) {
      argv.push_back(const_cast<char*>(argument.c_str()));
    }
    argv.push_back(nullptr);

    execv(executablePath.c_str(), argv.data());
    _exit(127);  // exec failed
  }

  // Parent: keep its own ends, close the child-side ends.
  close(stdinPipe[0]);
  close(stdoutPipe[1]);
  close(stderrPipe[1]);

  handles.stdinWrite = stdinPipe[1];
  handles.stdoutRead = stdoutPipe[0];
  handles.stderrRead = stderrPipe[0];
  handles.pid = pid;
  handles.launched = true;
  return true;
}

bool platformWriteAll(
    HelperSessionHandles& handles, const char* data, std::size_t length) {
  if (handles.stdinWrite < 0) {
    return false;
  }
  std::size_t written = 0;
  while (written < length) {
    const ssize_t chunk =
        write(handles.stdinWrite, data + written, length - written);
    if (chunk > 0) {
      written += static_cast<std::size_t>(chunk);
    } else if (chunk < 0 && (errno == EINTR || errno == EAGAIN)) {
      continue;
    } else {
      return false;  // includes EPIPE
    }
  }
  return true;
}

void platformPump(
    HelperSessionHandles& handles,
    int timeoutMs,
    std::string& stdoutBuffer,
    bool& stdoutEof,
    std::string& stderrBuffer,
    bool& stderrEof) {
  struct pollfd fds[2];
  int slot[2];
  nfds_t count = 0;
  if (!stdoutEof && handles.stdoutRead >= 0) {
    fds[count].fd = handles.stdoutRead;
    fds[count].events = POLLIN;
    fds[count].revents = 0;
    slot[count] = 0;
    ++count;
  }
  if (!stderrEof && handles.stderrRead >= 0) {
    fds[count].fd = handles.stderrRead;
    fds[count].events = POLLIN;
    fds[count].revents = 0;
    slot[count] = 1;
    ++count;
  }
  if (count == 0) {
    return;
  }

  const int slice = timeoutMs < 0 ? 5 : (timeoutMs < 5 ? timeoutMs : 5);
  const int polled = poll(fds, count, slice);
  if (polled <= 0) {
    return;  // slice timeout or EINTR: caller re-loops against its own deadline
  }

  char buffer[4096];
  for (nfds_t index = 0; index < count; ++index) {
    if ((fds[index].revents & (POLLIN | POLLHUP | POLLERR)) == 0) {
      continue;
    }
    std::string& target = slot[index] == 0 ? stdoutBuffer : stderrBuffer;
    bool& eof = slot[index] == 0 ? stdoutEof : stderrEof;
    const ssize_t readBytes = read(fds[index].fd, buffer, sizeof(buffer));
    if (readBytes > 0) {
      target.append(buffer, static_cast<std::size_t>(readBytes));
    } else if (readBytes == 0) {
      eof = true;
    } else if (errno != EINTR && errno != EAGAIN) {
      eof = true;
    }
  }
}

bool platformWaitExit(HelperSessionHandles& handles, int timeoutMs) {
  if (handles.pid < 0) {
    return true;
  }
  const long long deadline = static_cast<long long>(timeoutMs);
  long long waited = 0;
  while (true) {
    int status = 0;
    const pid_t result = waitpid(handles.pid, &status, WNOHANG);
    if (result == handles.pid || result < 0) {
      handles.pid = -1;
      return true;
    }
    if (timeoutMs >= 0 && waited >= deadline) {
      return false;
    }
    sleepMs(2);
    waited += 2;
  }
}

void platformForceTerminate(HelperSessionHandles& handles) {
  if (handles.pid < 0) {
    return;
  }
  kill(handles.pid, SIGKILL);
  int status = 0;
  waitpid(handles.pid, &status, 0);
  handles.pid = -1;
}

void platformClose(HelperSessionHandles& handles) {
  if (handles.stdinWrite >= 0) {
    close(handles.stdinWrite);
    handles.stdinWrite = -1;
  }
  if (handles.stdoutRead >= 0) {
    close(handles.stdoutRead);
    handles.stdoutRead = -1;
  }
  if (handles.stderrRead >= 0) {
    close(handles.stderrRead);
    handles.stderrRead = -1;
  }
  handles.launched = false;
}

}  // namespace
}  // namespace lvk::tracker

#endif

// ===========================================================================
// Platform-independent session logic.
// ===========================================================================

namespace lvk::tracker {

const char* helperDiagnosticCategoryLabel(HelperDiagnosticCategory category) {
  switch (category) {
    case HelperDiagnosticCategory::None:
      return "none";
    case HelperDiagnosticCategory::LaunchFailure:
      return "launch-failure";
    case HelperDiagnosticCategory::ReadyTimeout:
      return "ready-timeout";
    case HelperDiagnosticCategory::MalformedMessage:
      return "malformed-message";
    case HelperDiagnosticCategory::ResultTimeout:
      return "result-timeout";
    case HelperDiagnosticCategory::ChildExit:
      return "child-exit";
    case HelperDiagnosticCategory::ShutdownTimeout:
      return "shutdown-timeout";
  }
  return "none";
}

HelperProcessSession::HelperProcessSession(HelperSessionConfig config)
    : config_(std::move(config)),
      handles_(std::make_unique<HelperSessionHandles>()) {}

HelperProcessSession::~HelperProcessSession() {
  // No-throw, bounded cleanup backstop for early returns / signals. stop() is
  // idempotent; swallow any exception so the destructor never throws.
  try {
    stop();
  } catch (...) {
    // Intentionally ignored.
  }
}

HelperProcessSession::LineScan HelperProcessSession::scanLine(
    std::string& buffer, std::string& lineOut) {
  const std::size_t newline = buffer.find('\n');
  if (newline == std::string::npos) {
    // Enforce the bound WHILE accumulating: a partial line already exceeding the
    // limit is rejected before any newline arrives.
    if (buffer.size() > kHelperMaxLineBytes) {
      return LineScan::Oversized;
    }
    return LineScan::NeedMore;
  }
  if (newline > kHelperMaxLineBytes) {
    return LineScan::Oversized;
  }
  lineOut.assign(buffer, 0, newline);
  if (!lineOut.empty() && lineOut.back() == '\r') {
    lineOut.pop_back();
  }
  buffer.erase(0, newline + 1);
  return LineScan::Line;
}

bool HelperProcessSession::drainStderr() {
  // Continuously validate captured child stderr: bounded line size and the safe
  // "[helper] " diagnostic prefix. No raw diagnostic content is retained (only a
  // count), and nothing is ever forwarded. Unsafe/oversized stderr fails closed.
  while (true) {
    std::string line;
    const LineScan scan = scanLine(stderrBuffer_, line);
    if (scan == LineScan::Oversized) {
      return false;
    }
    if (scan == LineScan::NeedMore) {
      return true;
    }
    if (line.empty()) {
      continue;
    }
    if (line.rfind("[helper] ", 0) != 0) {
      return false;  // unsafe diagnostic -> fail closed
    }
    ++stderrDiagnosticCount_;
  }
}

bool HelperProcessSession::nextStdoutLine(
    std::string& lineOut,
    int timeoutMs,
    HelperDiagnosticCategory timeoutCategory) {
  const long long deadline = nowMs() + timeoutMs;
  while (true) {
    if (!drainStderr()) {
      lastDiagnostic_ = HelperDiagnosticCategory::MalformedMessage;
      return false;
    }

    const LineScan scan = scanLine(stdoutBuffer_, lineOut);
    if (scan == LineScan::Oversized) {
      lastDiagnostic_ = HelperDiagnosticCategory::MalformedMessage;
      return false;
    }
    if (scan == LineScan::Line) {
      return true;
    }

    if (stdoutEof_) {
      lastDiagnostic_ = HelperDiagnosticCategory::ChildExit;
      return false;
    }

    const long long remaining = deadline - nowMs();
    if (remaining <= 0) {
      lastDiagnostic_ = timeoutCategory;
      return false;
    }

    platformPump(
        *handles_, static_cast<int>(remaining), stdoutBuffer_, stdoutEof_,
        stderrBuffer_, stderrEof_);
  }
}

void HelperProcessSession::drainUntilStopped(int timeoutMs) {
  const long long deadline = nowMs() + timeoutMs;
  while (true) {
    if (!drainStderr()) {
      return;  // unsafe stderr during shutdown: stop draining, forced path follows
    }
    std::string line;
    const LineScan scan = scanLine(stdoutBuffer_, line);
    if (scan == LineScan::Oversized) {
      return;
    }
    if (scan == LineScan::Line) {
      if (classifyHelperLine(line) == HelperLineType::Stopped) {
        return;
      }
      continue;
    }
    if (stdoutEof_) {
      return;
    }
    const long long remaining = deadline - nowMs();
    if (remaining <= 0) {
      return;
    }
    platformPump(
        *handles_, static_cast<int>(remaining), stdoutBuffer_, stdoutEof_,
        stderrBuffer_, stderrEof_);
  }
}

bool HelperProcessSession::writeControlLine(const std::string& line) {
  return platformWriteAll(*handles_, line.data(), line.size());
}

bool HelperProcessSession::start() {
  if (state_ != HelperSessionState::NotStarted) {
    return state_ == HelperSessionState::Ready ||
           state_ == HelperSessionState::Running;
  }

  state_ = HelperSessionState::Starting;
  std::vector<std::string> arguments;
  arguments.reserve(1 + config_.extraArgs.size());
  arguments.push_back("--session");
  for (const std::string& extra : config_.extraArgs) {
    arguments.push_back(extra);
  }
  if (!platformLaunch(*handles_, config_.executablePath, arguments)) {
    lastDiagnostic_ = HelperDiagnosticCategory::LaunchFailure;
    state_ = HelperSessionState::Failed;
    return false;
  }

  std::string line;
  if (!nextStdoutLine(
          line, config_.readyTimeoutMs,
          HelperDiagnosticCategory::ReadyTimeout)) {
    state_ = HelperSessionState::Failed;
    return false;
  }

  std::string reason;
  if (classifyHelperLine(line) != HelperLineType::Ready ||
      !parseHelperReadyLine(line, reason)) {
    lastDiagnostic_ = HelperDiagnosticCategory::MalformedMessage;
    state_ = HelperSessionState::Failed;
    return false;
  }

  state_ = HelperSessionState::Ready;
  return true;
}

HelperTrackOutcome HelperProcessSession::track(long long frameTimestampMs) {
  HelperTrackOutcome outcome;

  if (state_ == HelperSessionState::Ready) {
    state_ = HelperSessionState::Running;
  }
  if (state_ != HelperSessionState::Running) {
    // Failed / Stopped / NotStarted: return not-ok immediately, no waiting.
    return outcome;
  }

  const std::uint64_t requestId = ++nextRequestId_;
  if (!writeControlLine(buildRequestLine(requestId, frameTimestampMs))) {
    lastDiagnostic_ = HelperDiagnosticCategory::ChildExit;
    state_ = HelperSessionState::Failed;
    return outcome;
  }

  std::string line;
  if (!nextStdoutLine(
          line, config_.resultTimeoutMs,
          HelperDiagnosticCategory::ResultTimeout)) {
    state_ = HelperSessionState::Failed;
    return outcome;
  }

  if (classifyHelperLine(line) != HelperLineType::Result) {
    lastDiagnostic_ = HelperDiagnosticCategory::MalformedMessage;
    state_ = HelperSessionState::Failed;
    return outcome;
  }

  ParsedHelperResult parsed;
  std::string reason;
  if (!parseHelperResultEnvelope(line, parsed, reason)) {
    lastDiagnostic_ = HelperDiagnosticCategory::MalformedMessage;
    state_ = HelperSessionState::Failed;
    return outcome;
  }
  if (parsed.requestId != requestId) {
    // Stale / mismatched correlation: reject, do not reuse.
    lastDiagnostic_ = HelperDiagnosticCategory::MalformedMessage;
    state_ = HelperSessionState::Failed;
    return outcome;
  }

  outcome.ok = true;
  outcome.result = parsed.payload;
  return outcome;
}

void HelperProcessSession::stop() {
  if (cleaned_) {
    return;
  }

  if (handles_ && handles_->launched) {
    if (state_ == HelperSessionState::Ready ||
        state_ == HelperSessionState::Running) {
      state_ = HelperSessionState::Stopping;
      if (writeControlLine("{\"type\":\"stop\",\"schemaVersion\":1}\n")) {
        drainUntilStopped(config_.stopTimeoutMs);
      }
    }

    if (!platformWaitExit(*handles_, config_.stopTimeoutMs)) {
      platformForceTerminate(*handles_);
      lastDiagnostic_ = HelperDiagnosticCategory::ShutdownTimeout;
    }
    platformClose(*handles_);
  }

  cleaned_ = true;
  if (state_ != HelperSessionState::Failed) {
    state_ = HelperSessionState::Stopped;
  }
}

}  // namespace lvk::tracker
