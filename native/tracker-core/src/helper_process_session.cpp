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
// Native Core can block indefinitely. Child handle/fd inheritance is restricted
// to exactly the three stdio channels.
// ===========================================================================

#ifdef _WIN32

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
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

void closeHandleOnce(HANDLE& handle) {
  if (handle != nullptr && handle != INVALID_HANDLE_VALUE) {
    CloseHandle(handle);
  }
  handle = nullptr;
}

// Launches the child with STARTUPINFOEX + PROC_THREAD_ATTRIBUTE_HANDLE_LIST so
// ONLY the three intended stdio handles are inheritable. Every setup call is
// checked and every partial-failure path closes exactly what it created.
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

  const auto closeAllPipes = [&]() {
    closeHandleOnce(stdinRead);
    closeHandleOnce(stdinWrite);
    closeHandleOnce(stdoutRead);
    closeHandleOnce(stdoutWrite);
    closeHandleOnce(stderrRead);
    closeHandleOnce(stderrWrite);
  };

  if (!CreatePipe(&stdinRead, &stdinWrite, &securityAttributes, 0)) {
    return false;
  }
  if (!CreatePipe(&stdoutRead, &stdoutWrite, &securityAttributes, 0)) {
    closeAllPipes();
    return false;
  }
  if (!CreatePipe(&stderrRead, &stderrWrite, &securityAttributes, 0)) {
    closeAllPipes();
    return false;
  }

  // The parent's own ends must not be inherited by the child; the child-side
  // ends must be inheritable and are enumerated explicitly below.
  if (!SetHandleInformation(stdinWrite, HANDLE_FLAG_INHERIT, 0) ||
      !SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0) ||
      !SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0) ||
      !SetHandleInformation(
          stdinRead, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) ||
      !SetHandleInformation(
          stdoutWrite, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) ||
      !SetHandleInformation(
          stderrWrite, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) {
    closeAllPipes();
    return false;
  }

  // Build a proc-thread attribute list restricting inheritance to exactly the
  // three child stdio handles.
  SIZE_T attributeListSize = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeListSize);
  std::vector<char> attributeListBuffer(attributeListSize);
  auto* attributeList =
      reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributeListBuffer.data());
  if (!InitializeProcThreadAttributeList(
          attributeList, 1, 0, &attributeListSize)) {
    closeAllPipes();
    return false;
  }

  HANDLE inheritedHandles[3] = {stdinRead, stdoutWrite, stderrWrite};
  if (!UpdateProcThreadAttribute(
          attributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inheritedHandles,
          sizeof(inheritedHandles), nullptr, nullptr)) {
    DeleteProcThreadAttributeList(attributeList);
    closeAllPipes();
    return false;
  }

  STARTUPINFOEXA startupInfo{};
  startupInfo.StartupInfo.cb = sizeof(STARTUPINFOEXA);
  startupInfo.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startupInfo.StartupInfo.hStdInput = stdinRead;
  startupInfo.StartupInfo.hStdOutput = stdoutWrite;
  startupInfo.StartupInfo.hStdError = stderrWrite;
  startupInfo.lpAttributeList = attributeList;

  std::string commandLine = quoteArgument(executablePath);
  for (const std::string& argument : arguments) {
    commandLine += " ";
    commandLine += quoteArgument(argument);
  }
  std::vector<char> commandLineBuffer(commandLine.begin(), commandLine.end());
  commandLineBuffer.push_back('\0');

  PROCESS_INFORMATION processInfo{};
  const BOOL launched = CreateProcessA(
      nullptr, commandLineBuffer.data(), nullptr, nullptr, TRUE,
      EXTENDED_STARTUPINFO_PRESENT, nullptr, nullptr, &startupInfo.StartupInfo,
      &processInfo);

  DeleteProcThreadAttributeList(attributeList);

  // The child now owns its ends; the parent closes the child-side handles.
  closeHandleOnce(stdinRead);
  closeHandleOnce(stdoutWrite);
  closeHandleOnce(stderrWrite);

  if (!launched) {
    closeHandleOnce(stdinWrite);
    closeHandleOnce(stdoutRead);
    closeHandleOnce(stderrRead);
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
  closeHandleOnce(handles.childStdinWrite);
  closeHandleOnce(handles.childStdoutRead);
  closeHandleOnce(handles.childStderrRead);
  closeHandleOnce(handles.process);
  closeHandleOnce(handles.thread);
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

void setCloexec(int fd) {
  const int flags = fcntl(fd, F_GETFD, 0);
  if (flags >= 0) {
    fcntl(fd, F_SETFD, flags | FD_CLOEXEC);
  }
}

void closeFdOnce(int& fd) {
  if (fd >= 0) {
    close(fd);
    fd = -1;
  }
}

// EINTR-safe blocking read of a single byte-count from an fd; returns bytes read
// (0 on EOF, -1 on hard error).
ssize_t readRetry(int fd, void* buffer, std::size_t length) {
  while (true) {
    const ssize_t result = read(fd, buffer, length);
    if (result < 0 && errno == EINTR) {
      continue;
    }
    return result;
  }
}

// Reaps the child if it has exited. Returns true when the child was successfully
// reaped or is already gone (ECHILD); false while still running or on a
// transient/unknown error (pid ownership is NOT cleared on such errors).
bool tryReap(pid_t& pid, bool block) {
  if (pid < 0) {
    return true;
  }
  while (true) {
    int status = 0;
    const pid_t result = waitpid(pid, &status, block ? 0 : WNOHANG);
    if (result == pid) {
      pid = -1;
      return true;
    }
    if (result == 0) {
      return false;  // WNOHANG: still running
    }
    // result < 0
    if (errno == EINTR) {
      continue;
    }
    if (errno == ECHILD) {
      pid = -1;  // already reaped elsewhere / no such child
      return true;
    }
    return false;  // other error: keep pid ownership, treat as not complete
  }
}

bool platformLaunch(
    HelperSessionHandles& handles,
    const std::string& executablePath,
    const std::vector<std::string>& arguments) {
  // Writing to a helper that has closed its stdin must yield EPIPE, never a
  // process-terminating SIGPIPE. Set once, process-wide; idempotent.
  static const bool ignoredSigpipe = []() {
    signal(SIGPIPE, SIG_IGN);
    return true;
  }();
  (void)ignoredSigpipe;

  int stdinPipe[2] = {-1, -1};
  int stdoutPipe[2] = {-1, -1};
  int stderrPipe[2] = {-1, -1};
  int execErrPipe[2] = {-1, -1};

  const auto closeAll = [&]() {
    closeFdOnce(stdinPipe[0]);
    closeFdOnce(stdinPipe[1]);
    closeFdOnce(stdoutPipe[0]);
    closeFdOnce(stdoutPipe[1]);
    closeFdOnce(stderrPipe[0]);
    closeFdOnce(stderrPipe[1]);
    closeFdOnce(execErrPipe[0]);
    closeFdOnce(execErrPipe[1]);
  };

  if (pipe(stdinPipe) != 0) {
    return false;
  }
  if (pipe(stdoutPipe) != 0 || pipe(stderrPipe) != 0 ||
      pipe(execErrPipe) != 0) {
    closeAll();
    return false;
  }

  // All pipe fds are CLOEXEC so none leak across exec except the three stdio
  // descriptors, which are re-established via dup2 (dup2 clears CLOEXEC on the
  // new descriptor).
  for (int fd : {stdinPipe[0], stdinPipe[1], stdoutPipe[0], stdoutPipe[1],
                 stderrPipe[0], stderrPipe[1], execErrPipe[0], execErrPipe[1]}) {
    setCloexec(fd);
  }

  const pid_t pid = fork();
  if (pid < 0) {
    closeAll();
    return false;
  }

  if (pid == 0) {
    // Child: wire the three stdio ends, then exec. Only fds 0/1/2 survive.
    dup2(stdinPipe[0], STDIN_FILENO);
    dup2(stdoutPipe[1], STDOUT_FILENO);
    dup2(stderrPipe[1], STDERR_FILENO);

    std::vector<char*> argv;
    argv.push_back(const_cast<char*>(executablePath.c_str()));
    for (const std::string& argument : arguments) {
      argv.push_back(const_cast<char*>(argument.c_str()));
    }
    argv.push_back(nullptr);

    execv(executablePath.c_str(), argv.data());

    // exec failed: report errno to the parent through the CLOEXEC error pipe,
    // then exit. On success this write never happens and the pipe closes on
    // exec, which the parent observes as EOF.
    const int execErrno = errno;
    ssize_t ignored = write(execErrPipe[1], &execErrno, sizeof(execErrno));
    (void)ignored;
    _exit(127);
  }

  // Parent: close the child-side ends and the write end of the error pipe.
  closeFdOnce(stdinPipe[0]);
  closeFdOnce(stdoutPipe[1]);
  closeFdOnce(stderrPipe[1]);
  closeFdOnce(execErrPipe[1]);

  // Determine whether exec succeeded: a successful exec closes execErrPipe[1]
  // (CLOEXEC) with no data, so the parent reads EOF; a failed exec delivers the
  // child's errno.
  int childErrno = 0;
  const ssize_t reported =
      readRetry(execErrPipe[0], &childErrno, sizeof(childErrno));
  closeFdOnce(execErrPipe[0]);

  if (reported == static_cast<ssize_t>(sizeof(childErrno))) {
    // exec failed in the child: reap it and report a clean launch failure.
    pid_t deadChild = pid;
    tryReap(deadChild, /*block=*/true);
    closeFdOnce(stdinPipe[1]);
    closeFdOnce(stdoutPipe[0]);
    closeFdOnce(stderrPipe[0]);
    return false;
  }

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
      return false;  // includes EPIPE (helper closed its stdin)
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
  long long waited = 0;
  while (true) {
    if (tryReap(handles.pid, /*block=*/false)) {
      return handles.pid < 0;  // true only if actually reaped / ECHILD
    }
    if (timeoutMs >= 0 && waited >= timeoutMs) {
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
  // SIGKILL cannot be caught, so a bounded blocking reap terminates promptly.
  tryReap(handles.pid, /*block=*/true);
  handles.pid = -1;
}

void platformClose(HelperSessionHandles& handles) {
  closeFdOnce(handles.stdinWrite);
  closeFdOnce(handles.stdoutRead);
  closeFdOnce(handles.stderrRead);
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

bool HelperProcessSession::drainStderr() {
  // Continuously validate captured child stderr: bounded line size and the safe
  // "[helper] " diagnostic prefix. No raw diagnostic content is retained (only a
  // count), and nothing is ever forwarded. Unsafe/oversized stderr fails closed.
  while (true) {
    std::string line;
    const HelperLineScan scan = scanBoundedLine(stderrBuffer_, line);
    if (scan == HelperLineScan::Oversized) {
      return false;
    }
    if (scan == HelperLineScan::NeedMore) {
      // At EOF, validate any unterminated residual as the final line so an
      // unsafe partial stderr line cannot slip through unvalidated.
      if (stderrEof_ && !stderrBuffer_.empty()) {
        std::string residual;
        residual.swap(stderrBuffer_);
        if (residual.size() > kHelperMaxLineBytes) {
          return false;
        }
        if (!residual.empty() && residual.back() == '\r') {
          residual.pop_back();
        }
        if (!residual.empty() && residual.rfind("[helper] ", 0) != 0) {
          return false;  // unterminated unsafe diagnostic -> fail closed
        }
        if (!residual.empty()) {
          ++stderrDiagnosticCount_;
        }
      }
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

    const HelperLineScan scan = scanBoundedLine(stdoutBuffer_, lineOut);
    if (scan == HelperLineScan::Oversized) {
      lastDiagnostic_ = HelperDiagnosticCategory::MalformedMessage;
      return false;
    }
    if (scan == HelperLineScan::Line) {
      return true;
    }

    if (stdoutEof_) {
      // EOF with an unterminated partial stdout line is malformed framing; a
      // clean exit with no pending line is a child exit. Either way, reject the
      // read (fail closed) without emitting the residual.
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

HelperProcessSession::ShutdownOutcome HelperProcessSession::drainUntilStopped(
    int timeoutMs) {
  const long long deadline = nowMs() + timeoutMs;
  while (true) {
    if (!drainStderr()) {
      return ShutdownOutcome::Malformed;  // unsafe/oversized stderr in shutdown
    }
    std::string line;
    const HelperLineScan scan = scanBoundedLine(stdoutBuffer_, line);
    if (scan == HelperLineScan::Oversized) {
      return ShutdownOutcome::Malformed;
    }
    if (scan == HelperLineScan::Line) {
      std::string reason;
      if (parseHelperStoppedLine(line, reason)) {
        return ShutdownOutcome::StoppedCleanly;
      }
      // A valid "stopping" line may precede "stopped"; anything else during
      // shutdown is a malformed lifecycle line.
      if (classifyHelperLine(line) == HelperLineType::Stopping) {
        continue;
      }
      return ShutdownOutcome::Malformed;
    }
    if (stdoutEof_) {
      return ShutdownOutcome::ChildExit;  // EOF before a valid "stopped" line
    }
    const long long remaining = deadline - nowMs();
    if (remaining <= 0) {
      return ShutdownOutcome::Timeout;
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
  // Full correlation: both the request id and the parent frame timestamp must
  // match the outstanding request. A stale/mismatched result is rejected and
  // never becomes MotionFrame output.
  if (parsed.requestId != requestId ||
      parsed.frameTimestampMs != frameTimestampMs) {
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

  HelperDiagnosticCategory shutdownCategory = HelperDiagnosticCategory::None;
  bool enteredStopping = false;

  if (handles_ && handles_->launched) {
    bool validStopped = false;
    if (state_ == HelperSessionState::Ready ||
        state_ == HelperSessionState::Running) {
      enteredStopping = true;
      state_ = HelperSessionState::Stopping;
      if (writeControlLine("{\"type\":\"stop\",\"schemaVersion\":1}\n")) {
        switch (drainUntilStopped(config_.stopTimeoutMs)) {
          case ShutdownOutcome::StoppedCleanly:
            validStopped = true;
            break;
          case ShutdownOutcome::Malformed:
            shutdownCategory = HelperDiagnosticCategory::MalformedMessage;
            break;
          case ShutdownOutcome::ChildExit:
            shutdownCategory = HelperDiagnosticCategory::ChildExit;
            break;
          case ShutdownOutcome::Timeout:
            shutdownCategory = HelperDiagnosticCategory::ShutdownTimeout;
            break;
        }
      } else {
        shutdownCategory = HelperDiagnosticCategory::ChildExit;
      }
    }

    const bool exited = platformWaitExit(*handles_, config_.stopTimeoutMs);
    if (!exited) {
      platformForceTerminate(*handles_);
      shutdownCategory = HelperDiagnosticCategory::ShutdownTimeout;
    }
    platformClose(*handles_);

    // A clean graceful stop requires a strictly valid "stopped" line AND a
    // bounded child exit. Anything else on a session that reached Ready/Running
    // is reported as a generic incomplete-shutdown category.
    if (enteredStopping) {
      if (validStopped && exited) {
        shutdownCategory = HelperDiagnosticCategory::None;
      } else if (shutdownCategory == HelperDiagnosticCategory::None) {
        shutdownCategory = HelperDiagnosticCategory::ShutdownTimeout;
      }
    }
  }

  cleaned_ = true;
  shutdownDiagnostic_ =
      enteredStopping ? shutdownCategory : HelperDiagnosticCategory::None;
  if (state_ != HelperSessionState::Failed) {
    state_ = HelperSessionState::Stopped;
  }
}

}  // namespace lvk::tracker
