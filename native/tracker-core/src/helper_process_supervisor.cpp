#include "helper_process_supervisor.h"

// Minimal, smoke-only child-process supervision primitive (H1c).
//
// Captures child stdout/stderr via pipes (never temporary files), with a
// bounded timeout that terminates a hung child. Captured output is bounded by a
// smoke-only cumulative byte cap so even high-volume synthetic output stays
// bounded, local, and private. Not a production process manager and not wired
// into the lvk-tracker-core runtime.

#include <cstddef>
#include <string>

namespace lvk::tracker {
namespace {

// Appends up to the smoke-only cap into `dest`. Bytes beyond the cap are
// discarded (the caller still fully drains the pipe so the child never blocks),
// and `truncated` is set. Only the stored buffer is bounded; pipe draining and
// exit/timeout detection are unaffected.
void appendBoundedCapture(
    std::string& dest,
    bool& truncated,
    const char* data,
    std::size_t length) {
  if (dest.size() >= kHelperSmokeCapturedStreamByteCap) {
    truncated = true;
    return;
  }
  const std::size_t remaining = kHelperSmokeCapturedStreamByteCap - dest.size();
  if (length > remaining) {
    dest.append(data, remaining);
    truncated = true;
  } else {
    dest.append(data, length);
  }
}

}  // namespace
}  // namespace lvk::tracker

#ifdef _WIN32

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

namespace lvk::tracker {
namespace {

// Quote a command-line token. The smoke only passes simple tokens (paths and
// flags) without embedded quotes, so basic double-quote wrapping is sufficient.
std::string quoteArgument(const std::string& value) {
  return "\"" + value + "\"";
}

std::string buildCommandLine(
    const std::string& executablePath,
    const std::vector<std::string>& arguments) {
  std::string commandLine = quoteArgument(executablePath);
  for (const std::string& argument : arguments) {
    commandLine += " ";
    commandLine += quoteArgument(argument);
  }
  return commandLine;
}

// Larger explicit read-pipe buffer so a high-volume synthetic child can write
// its full output without blocking before the parent reads (the Windows path
// reads after the wait). This keeps high-volume synthetic completion
// deterministic; the stored capture is still bounded by appendBoundedCapture.
constexpr DWORD kWindowsPipeBufferBytes = 1u << 20;  // 1 MiB

// Fully drains `pipe` to EOF, storing at most the smoke-only cap into
// `contents` (setting `truncated` when bytes are discarded). Draining always
// runs to completion so the child never blocks on a full pipe.
void readAllFromPipe(HANDLE pipe, std::string& contents, bool& truncated) {
  char buffer[4096];
  DWORD bytesRead = 0;
  while (ReadFile(pipe, buffer, sizeof(buffer), &bytesRead, nullptr) &&
         bytesRead > 0) {
    appendBoundedCapture(
        contents, truncated, buffer, static_cast<std::size_t>(bytesRead));
  }
}

}  // namespace

HelperProcessRunResult runHelperProcessForSmoke(
    const std::string& executablePath,
    const std::vector<std::string>& arguments,
    int timeoutMs) {
  HelperProcessRunResult result;

  SECURITY_ATTRIBUTES securityAttributes{};
  securityAttributes.nLength = sizeof(securityAttributes);
  securityAttributes.bInheritHandle = TRUE;
  securityAttributes.lpSecurityDescriptor = nullptr;

  HANDLE stdoutRead = nullptr;
  HANDLE stdoutWrite = nullptr;
  HANDLE stderrRead = nullptr;
  HANDLE stderrWrite = nullptr;

  if (!CreatePipe(
          &stdoutRead, &stdoutWrite, &securityAttributes,
          kWindowsPipeBufferBytes)) {
    return result;
  }
  if (!CreatePipe(
          &stderrRead, &stderrWrite, &securityAttributes,
          kWindowsPipeBufferBytes)) {
    CloseHandle(stdoutRead);
    CloseHandle(stdoutWrite);
    return result;
  }

  // The parent's read ends must not be inherited by the child.
  SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0);

  // Give the child a null stdin (the helper does not read stdin). "NUL" is a
  // device, not a temporary file.
  HANDLE stdinRead = CreateFileA(
      "NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
      &securityAttributes, OPEN_EXISTING, 0, nullptr);

  STARTUPINFOA startupInfo{};
  startupInfo.cb = sizeof(startupInfo);
  startupInfo.dwFlags = STARTF_USESTDHANDLES;
  startupInfo.hStdInput = stdinRead;
  startupInfo.hStdOutput = stdoutWrite;
  startupInfo.hStdError = stderrWrite;

  PROCESS_INFORMATION processInfo{};

  std::string commandLine = buildCommandLine(executablePath, arguments);
  std::vector<char> commandLineBuffer(commandLine.begin(), commandLine.end());
  commandLineBuffer.push_back('\0');

  const BOOL launched = CreateProcessA(
      nullptr, commandLineBuffer.data(), nullptr, nullptr, TRUE, 0, nullptr,
      nullptr, &startupInfo, &processInfo);

  // The parent does not write to the child's input/output; close those ends so
  // pipe reads observe EOF when the child exits.
  CloseHandle(stdoutWrite);
  CloseHandle(stderrWrite);
  if (stdinRead != INVALID_HANDLE_VALUE) {
    CloseHandle(stdinRead);
  }

  if (!launched) {
    CloseHandle(stdoutRead);
    CloseHandle(stderrRead);
    return result;
  }

  result.launched = true;

  const DWORD waitTimeout =
      timeoutMs > 0 ? static_cast<DWORD>(timeoutMs) : INFINITE;
  const DWORD waitResult = WaitForSingleObject(processInfo.hProcess, waitTimeout);
  if (waitResult == WAIT_TIMEOUT) {
    result.timedOut = true;
    TerminateProcess(processInfo.hProcess, 1);
    WaitForSingleObject(processInfo.hProcess, INFINITE);
  }

  // Read remaining buffered pipe data after the process has exited or been
  // terminated. Each stream is fully drained but stored only up to the
  // smoke-only cap (setting the *Truncated flags when output is high-volume).
  readAllFromPipe(stdoutRead, result.stdoutText, result.stdoutTruncated);
  readAllFromPipe(stderrRead, result.stderrText, result.stderrTruncated);

  DWORD exitCode = 0;
  if (GetExitCodeProcess(processInfo.hProcess, &exitCode)) {
    result.exitCode = static_cast<int>(exitCode);
  }

  CloseHandle(stdoutRead);
  CloseHandle(stderrRead);
  CloseHandle(processInfo.hProcess);
  CloseHandle(processInfo.hThread);

  return result;
}

}  // namespace lvk::tracker

#else  // POSIX

#include <cerrno>
#include <ctime>

#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

namespace lvk::tracker {
namespace {

long long monotonicMillis() {
  struct timespec now{};
  clock_gettime(CLOCK_MONOTONIC, &now);
  return static_cast<long long>(now.tv_sec) * 1000 +
         now.tv_nsec / 1000000;
}

}  // namespace

HelperProcessRunResult runHelperProcessForSmoke(
    const std::string& executablePath,
    const std::vector<std::string>& arguments,
    int timeoutMs) {
  HelperProcessRunResult result;

  int stdoutPipe[2];
  int stderrPipe[2];
  if (pipe(stdoutPipe) != 0) {
    return result;
  }
  if (pipe(stderrPipe) != 0) {
    close(stdoutPipe[0]);
    close(stdoutPipe[1]);
    return result;
  }

  const pid_t pid = fork();
  if (pid < 0) {
    close(stdoutPipe[0]);
    close(stdoutPipe[1]);
    close(stderrPipe[0]);
    close(stderrPipe[1]);
    return result;
  }

  if (pid == 0) {
    // Child: redirect stdout/stderr to the pipe write ends, null stdin.
    dup2(stdoutPipe[1], STDOUT_FILENO);
    dup2(stderrPipe[1], STDERR_FILENO);
    const int devNull = open("/dev/null", O_RDONLY);
    if (devNull >= 0) {
      dup2(devNull, STDIN_FILENO);
      close(devNull);
    }
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

  // Parent.
  result.launched = true;
  close(stdoutPipe[1]);
  close(stderrPipe[1]);

  bool stdoutOpen = true;
  bool stderrOpen = true;
  const long long startMs = monotonicMillis();
  char buffer[4096];

  while (stdoutOpen || stderrOpen) {
    int pollTimeout = -1;
    if (timeoutMs > 0) {
      const long long remaining =
          static_cast<long long>(timeoutMs) - (monotonicMillis() - startMs);
      if (remaining <= 0) {
        result.timedOut = true;
        break;
      }
      pollTimeout = static_cast<int>(remaining);
    }

    struct pollfd fds[2];
    int stdoutIndex = -1;
    int stderrIndex = -1;
    nfds_t count = 0;
    if (stdoutOpen) {
      fds[count].fd = stdoutPipe[0];
      fds[count].events = POLLIN;
      fds[count].revents = 0;
      stdoutIndex = static_cast<int>(count);
      ++count;
    }
    if (stderrOpen) {
      fds[count].fd = stderrPipe[0];
      fds[count].events = POLLIN;
      fds[count].revents = 0;
      stderrIndex = static_cast<int>(count);
      ++count;
    }

    const int polled = poll(fds, count, pollTimeout);
    if (polled == 0) {
      result.timedOut = true;
      break;
    }
    if (polled < 0) {
      if (errno == EINTR) {
        continue;
      }
      break;
    }

    if (stdoutIndex >= 0 && (fds[stdoutIndex].revents & (POLLIN | POLLHUP))) {
      const ssize_t bytesRead = read(stdoutPipe[0], buffer, sizeof(buffer));
      if (bytesRead > 0) {
        appendBoundedCapture(
            result.stdoutText, result.stdoutTruncated, buffer,
            static_cast<std::size_t>(bytesRead));
      } else if (bytesRead == 0) {
        stdoutOpen = false;
      } else if (errno != EINTR && errno != EAGAIN) {
        stdoutOpen = false;
      }
    }
    if (stderrIndex >= 0 && (fds[stderrIndex].revents & (POLLIN | POLLHUP))) {
      const ssize_t bytesRead = read(stderrPipe[0], buffer, sizeof(buffer));
      if (bytesRead > 0) {
        appendBoundedCapture(
            result.stderrText, result.stderrTruncated, buffer,
            static_cast<std::size_t>(bytesRead));
      } else if (bytesRead == 0) {
        stderrOpen = false;
      } else if (errno != EINTR && errno != EAGAIN) {
        stderrOpen = false;
      }
    }
  }

  if (result.timedOut) {
    kill(pid, SIGKILL);
  }

  int status = 0;
  waitpid(pid, &status, 0);
  if (!result.timedOut && WIFEXITED(status)) {
    result.exitCode = WEXITSTATUS(status);
  } else if (!result.timedOut) {
    result.exitCode = -1;  // terminated by signal
  }

  close(stdoutPipe[0]);
  close(stderrPipe[0]);

  return result;
}

}  // namespace lvk::tracker

#endif
