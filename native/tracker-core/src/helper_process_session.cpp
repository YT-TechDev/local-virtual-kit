#include "helper_process_session.h"

#include "helper_frame_packet.h"
#include "helper_message.h"
#include "helper_process_cleanup_registry.h"

#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <new>
#include <set>
#include <string>
#include <utility>
#include <vector>

// v0.13.0 reusable Native Core helper session (#533), extended with a bounded
// private frame transport (#534).
//
// Owns one synthetic helper child and its private pipes: stdin/stdout/stderr
// (always), plus a second anonymous frame pipe when
// HelperSessionConfig::enableFrameTransport is set. Helper stdout/stderr stay
// private to Native Core; child stderr is drained and validated (safe
// "[helper] " prefix + bounded line size) but never forwarded. Every JSON
// message line is bounded to kHelperMaxLineBytes, enforced while accumulating
// a partial line. The frame pipe carries exactly one bounded binary packet
// (see helper_frame_packet.h) per trackWithFrame() call -- never pixels on
// any other stream. No temp files, sockets, shared memory, or network
// behavior.

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

// Internal outcome of a bounded child-process termination/reap attempt
// (POSIX kill+waitpid; Windows TerminateProcess+wait). Finer than a plain
// released/timed-out bool so ownership logic can decide correctly, while
// public diagnostics stay generic. Each value's ownership meaning is
// captured by childOwnershipReleased() below -- ownership is released ONLY
// on affirmative confirmation, never merely because a termination request
// was issued.
enum class ChildCleanupOutcome {
  Released,         // confirmed reaped / ECHILD (POSIX) or signaled-exited
                    // (Windows): the OS-level resource is released
  NoChild,          // there was nothing to own (already released / never set)
  StillRunning,     // still alive at the deadline
  TerminateFailed,  // the kill / TerminateProcess request itself failed
  WaitFailed,       // the reap/wait failed ambiguously (e.g. WAIT_FAILED)
};

// True iff the child's OS resource was conclusively released and the caller
// no longer owns it. Every other outcome retains ownership with the caller,
// which must then either retry or transfer to the durable registry.
inline bool childOwnershipReleased(ChildCleanupOutcome outcome) {
  return outcome == ChildCleanupOutcome::Released ||
         outcome == ChildCleanupOutcome::NoChild;
}

// True iff the terminate/kill request was CONFIRMED accepted by the OS. Only
// StillRunning proves delivery (the child was signalled and is merely not yet
// reaped); TerminateFailed (request failed) and WaitFailed (ambiguous) both
// leave delivery unconfirmed, so a durable entry taking over such a child must
// retry the termination rather than only wait. Passed into the durable
// PidCleanup / ProcessHandleCleanup at transfer time so their retry phase is
// correct. (Not meaningful for Released/NoChild, which never transfer.)
inline bool terminationConfirmedDelivered(ChildCleanupOutcome outcome) {
  return outcome == ChildCleanupOutcome::StillRunning;
}

// Default bounded deadline for child termination/reap, used by every
// production path except the frame-write cancellation sequence (which uses
// the caller-configurable HelperSessionConfig::frameCancelTimeoutMs so it
// can be driven deterministically in tests). Matches the value every one of
// these call sites already used before being unified behind one primitive.
constexpr int kDefaultChildCleanupDeadlineMs = 2000;

// Structured result of platformLaunch: a plain bool cannot represent whether
// the caller still owns a child. Every value except Launched is a failure;
// start() maps them all to the generic public LaunchFailure diagnostic and a
// terminal non-reusable state, but the ownership distinction here governs
// whether any cleanup remains and who owns it.
//
// v0.13.0 (#534 final-ownership hardening): there is no longer an
// "ambiguous" outcome. The durable-registry capacity and the platform
// cleanup entry are both reserved/allocated BEFORE any child is created (see
// platformLaunch), so an unresolved child after launch failure can always be
// committed to the durable registry -- no allocation, cannot fail. Every
// post-child-creation failure is therefore always exactly one of
// FailedChildReleased or FailedOwnershipTransferred; there is no third,
// session-retained outcome.
enum class LaunchResult {
  Launched,                    // child running; handles populated
  FailedBeforeChild,           // failed before fork()/CreateProcess: no child
  FailedChildReleased,         // failed after child creation; child was
                               // conclusively reaped/released
  FailedOwnershipTransferred,  // failed after child creation; the unresolved
                               // child was committed to the durable registry
};

// True iff `result` is any failure (i.e. the child is not running).
inline bool launchFailed(LaunchResult result) {
  return result != LaunchResult::Launched;
}

// v0.13.0 (#534 final-ownership hardening): exception/early-return-safe
// rollback guard for a session's pre-launch-prepared child-cleanup fallback
// (registry capacity + platform cleanup entry -- POSIX PidCleanup / Windows
// ProcessHandleCleanup -- both reserved/allocated before any child exists;
// see platformLaunch). Armed from the moment the reservation succeeds until
// EITHER the launch succeeds (the fallback must then live for the whole
// session lifetime, resolved later by platformReleaseChildProcess or
// transferChildProcessToRegistry) OR an already-adopted, unresolved child is
// committed to the registry (which itself resolves the reservation). On any
// earlier return -- including the entry's own allocation throwing -- the
// destructor drops the still-unadopted entry and releases the reservation
// exactly once; disarm() hands that responsibility elsewhere. Shared,
// platform-independent template: instantiated separately in each platform
// section below with its own concrete cleanup-entry type.
template <typename ChildFallbackEntry>
class ChildFallbackReservationGuard {
 public:
  ChildFallbackReservationGuard(
      HelperProcessCleanupRegistry& registry,
      std::unique_ptr<ChildFallbackEntry>& fallback)
      : registry_(registry), fallback_(fallback) {}

  ChildFallbackReservationGuard(const ChildFallbackReservationGuard&) = delete;
  ChildFallbackReservationGuard& operator=(
      const ChildFallbackReservationGuard&) = delete;

  ~ChildFallbackReservationGuard() noexcept {
    if (armed_) {
      fallback_.reset();
      registry_.releaseChildFallbackReservation();
    }
  }

  void disarm() noexcept { armed_ = false; }

 private:
  HelperProcessCleanupRegistry& registry_;
  std::unique_ptr<ChildFallbackEntry>& fallback_;
  bool armed_ = true;
};

}  // namespace
}  // namespace lvk::tracker

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
namespace lvk::tracker {
namespace {
// Test-only lifecycle fault-injection flags. Declared before the platform
// sections (same TU) so they are visible to platformLaunch /
// platformForceTerminate / platformWriteFrame. Compiled out of production.
std::atomic<bool> g_forceFrameWriteUnresolvedTransfer{false};
std::atomic<bool> g_forceNextChildCleanupTimeout{false};
// 0=None, 1=Timeout, 2=PartialEof, 3=HardError (mirrors ExecStatusInjection).
std::atomic<int> g_nextExecStatusInjection{0};
// 0=None, 1=StateAllocation, 2=BufferAllocation, 3=ThreadConstruction
// (mirrors test_seam::FrameWriterSetupFailure). Windows-only in effect; the
// POSIX writer has no throwing setup step, so its test_seam stub ignores it.
std::atomic<int> g_nextFrameWriterSetupFailure{0};
// Windows-only in effect (see frameWriterDuplicatedHandleCountForTest());
// stays 0 on POSIX, which never duplicates a frame-write HANDLE.
std::atomic<long long> g_duplicatedFrameWriterHandleCount{0};
// Windows-only: count of writer thread HANDLEs currently adopted by a
// durable ThreadOwnedWriterCleanup entry, incremented immediately after a
// successful adoptThreadHandle() call and decremented at the exact point
// each is released (poll() on confirmed exit, or the destructor at process
// teardown).
std::atomic<long long> g_durableWriterThreadHandleCount{0};
// v0.13.0 (#534 repaired further): one-shot, Windows-only fault injection
// overriding ONLY ThreadOwnedWriterCleanup's destructor's single bounded
// teardown wait (never a global WaitForSingleObject hook), so its
// unconfirmed-outcome branch can be exercised deterministically without ever
// leaving a genuinely-blocked thread running past a test. See
// test_seam::setForceNextWriterTeardownWaitUnconfirmed.
std::atomic<bool> g_forceNextWriterTeardownWaitUnconfirmed{false};
// v0.13.0 (#534 final-ownership hardening): count of Windows child
// process/thread HANDLE pairs currently adopted by a durable
// ProcessHandleCleanup entry, incremented the instant adopt() is called and
// decremented at the exact point both handles are finally closed (poll() on
// confirmed exit, or the destructor at process teardown).
std::atomic<long long> g_durableChildProcessHandleCount{0};
// v0.13.0 (#534 allocation-free final cleanup): one-shot, POSIX-only in
// effect. Forces PidCleanup::prepareClaim()'s pre-fork node preallocation to
// fail, so the "claim preparation fails strictly before child creation" path
// is exercised deterministically. Consumed by the next prepareClaim(). No-op
// on Windows (no pid claim there). Declared here (shared) so the flag has one
// definition; only the POSIX prepareClaim consults it.
std::atomic<bool> g_forceNextPidClaimPrepFailure{false};
// v0.13.0 (#534 allocation-free final cleanup): one-shot. Forces the graceful
// part of stop() to throw (modelling a std::bad_alloc from its string/buffer
// work) BEFORE child ownership is resolved, so the destructor's separate
// bounded, noexcept emergency ownership-resolution path can be exercised
// deterministically. Consumed by the next stop(). Shared across platforms.
std::atomic<bool> g_forceNextGracefulStopThrow{false};
}  // namespace
}  // namespace lvk::tracker
#endif

// ===========================================================================
// Platform layer: process launch, bounded pipe I/O, and cleanup. Each stream is
// read non-blocking in a single bounded poll loop so neither the child nor
// Native Core can block indefinitely. Child handle/fd inheritance is restricted
// to exactly the intended stdio (+ frame, when enabled) channels.
// ===========================================================================

#ifdef _WIN32

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <process.h>  // _beginthreadex: CRT-aware thread start for a writer
                       // body that uses C++/CRT constructs (std::vector,
                       // shared_ptr) -- preferred over raw CreateThread.

#include <atomic>
#include <memory>

namespace lvk::tracker {

// v0.13.0 (#534 hardened): completion/outcome state shared between a frame
// writer thread and, when the write cannot be confirmed complete within the
// bounded cancellation sequence, its durable registry owner. Holds no OS
// handle itself; the durable owner (see ThreadOwnedWriterCleanup) separately
// adopts the writer's own real waitable thread HANDLE so it can re-cancel and
// re-wait, not merely observe a flag.
struct FrameWriteOperationState {
  std::atomic<bool> finished{false};
  std::atomic<bool> success{false};
};

namespace {

void closeHandleOnce(HANDLE& handle) {
  if (handle != nullptr && handle != INVALID_HANDLE_VALUE) {
    CloseHandle(handle);
  }
  handle = nullptr;
}

// Durable registry entry that owns a Windows child process whose bounded
// TerminateProcess + exit-wait timed out during shutdown. It retains a phase:
// when the transferring TerminateProcess request was NOT confirmed delivered,
// poll() re-issues TerminateProcess (a wait alone can never resolve a child
// that was never successfully asked to die); when it was delivered, poll()
// only waits. Either way the exit is confirmed before the handles are closed.
// Never a partial close: both handles are released together, exactly once,
// only on confirmed exit. WAIT_FAILED never releases ownership.
//
// v0.13.0 (#534 final-ownership hardening): allocated and fully constructed
// BEFORE any child exists (see platformLaunch) -- it begins owning no live
// HANDLEs and adopts the real process/thread pair, noexcept, the instant
// CreateProcess succeeds. This is what removes the historical contradiction:
// there is no window, after the child has been created, where forming this
// entry could still fail -- an unresolved shutdown can ALWAYS commit this
// already-fully-formed entry with no further allocation.
class ProcessHandleCleanup : public PendingCleanup {
 public:
  ProcessHandleCleanup() = default;

  ProcessHandleCleanup(const ProcessHandleCleanup&) = delete;
  ProcessHandleCleanup& operator=(const ProcessHandleCleanup&) = delete;

  // Adopts the real process/thread HANDLE pair. Never throws (plain
  // assignments plus an atomic increment): must be safely callable the
  // instant CreateProcess succeeds, whether or not this entry ever ends up
  // committed to the registry.
  void adopt(
      HANDLE processHandle, HANDLE threadHandle,
      bool terminationDelivered) noexcept {
    processHandle_ = processHandle;
    threadHandle_ = threadHandle;
    terminationDelivered_ = terminationDelivered;
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    g_durableChildProcessHandleCount.fetch_add(1, std::memory_order_acq_rel);
#endif
  }

  ~ProcessHandleCleanup() override {
    if (processHandle_ != nullptr) {
      if (!terminationDelivered_) {
        TerminateProcess(processHandle_, 1);  // teardown last resort
      }
      WaitForSingleObject(processHandle_, 2000);
      closeHandleOnce(processHandle_);
      closeHandleOnce(threadHandle_);
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
      g_durableChildProcessHandleCount.fetch_sub(
          1, std::memory_order_acq_rel);
#endif
    }
  }

  bool poll() override {
    if (processHandle_ == nullptr) {
      return true;
    }
    if (!terminationDelivered_) {
      // The transferring TerminateProcess request failed / was unconfirmed:
      // retry it so this entry is actionable. Harmless if the process is
      // already gone; the wait below is the actual release confirmation.
      if (TerminateProcess(processHandle_, 1)) {
        terminationDelivered_ = true;
      }
    }
    const DWORD waitResult = WaitForSingleObject(processHandle_, 0);
    if (waitResult == WAIT_OBJECT_0) {
      closeHandleOnce(processHandle_);
      closeHandleOnce(threadHandle_);
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
      g_durableChildProcessHandleCount.fetch_sub(
          1, std::memory_order_acq_rel);
#endif
      return true;
    }
    // WAIT_TIMEOUT (still running) or WAIT_FAILED (ambiguous): retain
    // ownership and retry on a later poll. WAIT_FAILED must never release.
    return false;
  }

 private:
  HANDLE processHandle_ = nullptr;
  HANDLE threadHandle_ = nullptr;
  bool terminationDelivered_ = false;
};

}  // namespace

struct HelperSessionHandles {
  HANDLE childStdinWrite = nullptr;
  HANDLE childStdoutRead = nullptr;
  HANDLE childStderrRead = nullptr;
  // v0.13.0 (#534): parent's write end of the private frame pipe. Only
  // non-null when the session was launched with enableFrameTransport = true.
  HANDLE frameWrite = nullptr;
  HANDLE process = nullptr;
  HANDLE thread = nullptr;
  bool launched = false;
  // v0.13.0 (#534 final-ownership hardening): this session's pre-launch-
  // prepared child-cleanup fallback (see ChildFallbackReservationGuard /
  // platformLaunch). Non-null and unadopted (no live HANDLEs) for the whole
  // span between successful pre-launch preparation and either a confirmed
  // clean release (platformReleaseChildProcess resets it) or an unresolved
  // commit (transferChildProcessToRegistry moves it into the registry).
  std::unique_ptr<ProcessHandleCleanup> childFallback;
};

namespace {

std::string quoteArgument(const std::string& value) {
  return "\"" + value + "\"";
}

// Durable registry entry that owns a Windows frame-writer operation whose
// completion could not be confirmed within platformWriteFrame's bounded
// cancellation sequence. Unlike the writer thread's own execution context
// (see FrameWriterThreadContext below, which the running thread owns
// independently and frees itself), this entry is allocated and fully
// constructed BEFORE the writer thread is even started (see
// platformWriteFrame) -- it begins with no live thread HANDLE
// (threadHandle_ == nullptr) and adopts one, noexcept, the instant
// _beginthreadex succeeds. This removes the historical contradiction: there
// is no window, after the thread has started, where forming this entry could
// still fail -- so an unconfirmed write can ALWAYS commit this
// already-fully-formed entry with no further allocation and no further
// HANDLE duplication. It never owns a std::thread and never calls join(): it
// only ever waits on, and closes, a plain adopted HANDLE, so there is
// nothing for it to detach either. It holds its OWN shared_ptr copies of the
// shared completion state and packet buffer (separate from the writer's own
// independent copies), released only when this entry itself resolves or is
// destroyed -- never touching session-owned memory.
class ThreadOwnedWriterCleanup : public PendingCleanup {
 public:
  ThreadOwnedWriterCleanup(
      std::shared_ptr<FrameWriteOperationState> state,
      std::shared_ptr<std::vector<std::uint8_t>> buffer)
      : state_(std::move(state)), buffer_(std::move(buffer)) {}

  ThreadOwnedWriterCleanup(const ThreadOwnedWriterCleanup&) = delete;
  ThreadOwnedWriterCleanup& operator=(const ThreadOwnedWriterCleanup&) =
      delete;

  // Adopts the just-started writer thread's owned HANDLE. Never throws (a
  // plain assignment plus an atomic increment): must be safely callable the
  // instant _beginthreadex succeeds, whether or not this entry ever ends up
  // committed to the registry.
  void adoptThreadHandle(HANDLE handle) noexcept {
    threadHandle_ = handle;
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    g_durableWriterThreadHandleCount.fetch_add(1, std::memory_order_acq_rel);
#endif
  }

  ~ThreadOwnedWriterCleanup() override {
    if (threadHandle_ == nullptr) {
      return;  // never adopted (setup failed before/without a thread start)
    }
    // Process-teardown-only last resort: NEVER reached from
    // platformWriteFrame's own return path (poll(), invoked only after an
    // externally-confirmed WAIT_OBJECT_0, is what that path depends on --
    // see finalizeConfirmedCompletion / registry.commit() there). No
    // std::thread is ever involved here, so there is no join() to call and
    // nothing to detach; CloseHandle() never blocks regardless of whether
    // the writer has actually exited.
    CancelSynchronousIo(threadHandle_);
    DWORD waitResult = WaitForSingleObject(threadHandle_, 2000);
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    // Test-only, one-shot: overrides ONLY this exact teardown wait's
    // observed result, so the "otherwise" branch below is exercisable
    // deterministically without a real timing race and without ever leaving
    // a genuinely-blocked thread running past a test.
    if (g_forceNextWriterTeardownWaitUnconfirmed.exchange(
            false, std::memory_order_acq_rel)) {
      waitResult = WAIT_TIMEOUT;
    }
#endif
    if (waitResult == WAIT_OBJECT_0) {
      // Confirmed: the writer thread has conclusively exited (and already
      // freed its own independent FrameWriterThreadContext). Ordinary
      // confirmed release.
      CloseHandle(threadHandle_);
    } else {
      // Unconfirmed (still running, WAIT_FAILED, or the injected test
      // override): do not join (there is none), do not wait a second time.
      // CloseHandle only drops OUR reference to the thread -- it never
      // blocks and never affects the writer's continued execution. The
      // writer owns its own independent FrameWriterThreadContext and will
      // free it itself whenever it eventually finishes, entirely
      // independent of this entry's lifetime, so releasing ONLY this
      // entry's own state_/buffer_ references below never frees memory the
      // writer might still be touching. Process teardown is relied on for
      // any execution that outlives this point.
      CloseHandle(threadHandle_);
    }
    threadHandle_ = nullptr;
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    g_durableWriterThreadHandleCount.fetch_sub(1, std::memory_order_acq_rel);
#endif
    state_.reset();
    buffer_.reset();
  }

  bool poll() override {
    if (threadHandle_ == nullptr) {
      return true;  // already resolved (defensive; entry is dropped on resolve)
    }
    if (WaitForSingleObject(threadHandle_, 0) == WAIT_OBJECT_0) {
      // Confirmed exited: CloseHandle is bounded/instantaneous (it never
      // blocks), dominated by the WAIT_OBJECT_0 result just observed for
      // this exact thread. The writer already closed its own duplicated
      // pipe handle and released its own independent context before
      // terminating.
      CloseHandle(threadHandle_);
      threadHandle_ = nullptr;
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
      g_durableWriterThreadHandleCount.fetch_sub(
          1, std::memory_order_acq_rel);
#endif
      state_.reset();
      buffer_.reset();
      return true;
    }
    // Still running: actively re-cancel the writer's pending synchronous
    // write so this entry is ACTIONABLE, not merely observational. (The
    // writer is also unblocked whenever the session terminates the child,
    // which closes the pipe's only reader; either way it will exit.) Return
    // false without re-checking, so a poll that issues a fresh cancel never
    // also reports resolution in the same call -- keeping the cross-session
    // reservation rejection deterministic. A later poll observes the exited
    // thread and reaps it.
    CancelSynchronousIo(threadHandle_);
    return false;
  }

 private:
  HANDLE threadHandle_ = nullptr;
  std::shared_ptr<FrameWriteOperationState> state_;
  std::shared_ptr<std::vector<std::uint8_t>> buffer_;
};

// Builds a private, per-launch child environment block: a copy of the
// parent's current environment with LVK_FRAME_PIPE_HANDLE appended. The
// parent process's own environment (SetEnvironmentVariable) is never
// touched, and the numeric handle value is never printed to any log/stderr
// string -- it only ever exists in this one-shot CreateProcessA argument.
std::vector<char> buildChildEnvironmentWithFrameHandle(HANDLE frameReadHandle) {
  std::vector<char> block;
  LPCH environmentStrings = GetEnvironmentStringsA();
  if (environmentStrings != nullptr) {
    const char* cursor = environmentStrings;
    while (*cursor != '\0') {
      const std::size_t length = std::strlen(cursor);
      block.insert(block.end(), cursor, cursor + length + 1);
      cursor += length + 1;
    }
    FreeEnvironmentStringsA(environmentStrings);
  }
  const std::string frameVariable =
      "LVK_FRAME_PIPE_HANDLE=" +
      std::to_string(reinterpret_cast<std::intptr_t>(frameReadHandle));
  block.insert(block.end(), frameVariable.begin(), frameVariable.end());
  block.push_back('\0');
  block.push_back('\0');  // final double-null terminator
  return block;
}

// Launches the child with STARTUPINFOEX + PROC_THREAD_ATTRIBUTE_HANDLE_LIST so
// ONLY the intended stdio (+ frame, when enabled) handles are inheritable.
// Every setup call is checked and every partial-failure path closes exactly
// what it created.
LaunchResult platformLaunch(
    HelperSessionHandles& handles,
    const std::string& executablePath,
    const std::vector<std::string>& arguments,
    bool enableFrameTransport,
    int launchTimeoutMs) {
  (void)launchTimeoutMs;  // CreateProcess reports launch synchronously.

  // v0.13.0 (#534 final-ownership hardening): reserve durable-registry
  // capacity and pre-allocate the platform cleanup entry BEFORE any child
  // exists, so an unresolved shutdown can always commit it (adopt + commit,
  // both noexcept/non-throwing -- see transferChildProcessToRegistry) with no
  // allocation-failure corner left at destruction time. Failure here means
  // launch fails closed before any pipe/CreateProcess activity: no child, no
  // reservation left outstanding.
  auto& registry = HelperProcessCleanupRegistry::instance();
  if (!registry.reserveChildFallback()) {
    return LaunchResult::FailedBeforeChild;
  }
  ChildFallbackReservationGuard<ProcessHandleCleanup> fallbackGuard(
      registry, handles.childFallback);
  try {
    handles.childFallback = std::make_unique<ProcessHandleCleanup>();
  } catch (...) {
    return LaunchResult::FailedBeforeChild;  // guard releases the reservation
  }

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
  HANDLE frameRead = nullptr;
  HANDLE frameWrite = nullptr;

  const auto closeAllPipes = [&]() {
    closeHandleOnce(stdinRead);
    closeHandleOnce(stdinWrite);
    closeHandleOnce(stdoutRead);
    closeHandleOnce(stdoutWrite);
    closeHandleOnce(stderrRead);
    closeHandleOnce(stderrWrite);
    closeHandleOnce(frameRead);
    closeHandleOnce(frameWrite);
  };

  if (!CreatePipe(&stdinRead, &stdinWrite, &securityAttributes, 0)) {
    return LaunchResult::FailedBeforeChild;
  }
  if (!CreatePipe(&stdoutRead, &stdoutWrite, &securityAttributes, 0)) {
    closeAllPipes();
    return LaunchResult::FailedBeforeChild;
  }
  if (!CreatePipe(&stderrRead, &stderrWrite, &securityAttributes, 0)) {
    closeAllPipes();
    return LaunchResult::FailedBeforeChild;
  }
  if (enableFrameTransport &&
      !CreatePipe(&frameRead, &frameWrite, &securityAttributes, 0)) {
    closeAllPipes();
    return LaunchResult::FailedBeforeChild;
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
    return LaunchResult::FailedBeforeChild;
  }
  if (enableFrameTransport &&
      (!SetHandleInformation(frameWrite, HANDLE_FLAG_INHERIT, 0) ||
       !SetHandleInformation(
           frameRead, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT))) {
    closeAllPipes();
    return LaunchResult::FailedBeforeChild;
  }

  // Build a proc-thread attribute list restricting inheritance to exactly the
  // intended child handles (three stdio, plus the frame-read end when frame
  // transport is enabled).
  SIZE_T attributeListSize = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeListSize);
  std::vector<char> attributeListBuffer(attributeListSize);
  auto* attributeList =
      reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributeListBuffer.data());
  if (!InitializeProcThreadAttributeList(
          attributeList, 1, 0, &attributeListSize)) {
    closeAllPipes();
    return LaunchResult::FailedBeforeChild;
  }

  std::vector<HANDLE> inheritedHandles = {stdinRead, stdoutWrite, stderrWrite};
  if (enableFrameTransport) {
    inheritedHandles.push_back(frameRead);
  }
  if (!UpdateProcThreadAttribute(
          attributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
          inheritedHandles.data(),
          inheritedHandles.size() * sizeof(HANDLE), nullptr, nullptr)) {
    DeleteProcThreadAttributeList(attributeList);
    closeAllPipes();
    return LaunchResult::FailedBeforeChild;
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

  // The frame handle (when present) is communicated only through a private,
  // per-launch child environment block -- never argv, never a log/diagnostic
  // string. lpEnvironment stays nullptr (child inherits the parent's
  // environment as-is) when frame transport is off, exactly like #533.
  std::vector<char> childEnvironment;
  LPVOID environmentBlock = nullptr;
  if (enableFrameTransport) {
    childEnvironment = buildChildEnvironmentWithFrameHandle(frameRead);
    environmentBlock = childEnvironment.data();
  }

  PROCESS_INFORMATION processInfo{};
  const BOOL launched = CreateProcessA(
      nullptr, commandLineBuffer.data(), nullptr, nullptr, TRUE,
      EXTENDED_STARTUPINFO_PRESENT, environmentBlock, nullptr,
      &startupInfo.StartupInfo, &processInfo);

  DeleteProcThreadAttributeList(attributeList);

  // The child now owns its ends; the parent closes the child-side handles.
  closeHandleOnce(stdinRead);
  closeHandleOnce(stdoutWrite);
  closeHandleOnce(stderrWrite);
  if (enableFrameTransport) {
    closeHandleOnce(frameRead);
  }

  if (!launched) {
    // CreateProcess failed: no child process was created, so there is no
    // child ownership to release or transfer.
    closeHandleOnce(stdinWrite);
    closeHandleOnce(stdoutRead);
    closeHandleOnce(stderrRead);
    closeHandleOnce(frameWrite);
    return LaunchResult::FailedBeforeChild;
  }

  handles.childStdinWrite = stdinWrite;
  handles.childStdoutRead = stdoutRead;
  handles.childStderrRead = stderrRead;
  handles.frameWrite = frameWrite;
  handles.process = processInfo.hProcess;
  handles.thread = processInfo.hThread;
  handles.launched = true;
  // The prepared, still-unadopted fallback now lives for this session's
  // whole lifetime -- resolved later by platformReleaseChildProcess
  // (confirmed release) or transferChildProcessToRegistry (unresolved
  // commit), never by this guard.
  fallbackGuard.disarm();
  return LaunchResult::Launched;
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

// Bounded, checked force termination, returning a finer outcome so callers
// can decide ownership correctly. Both TerminateProcess and the confirmation
// wait are checked: Released is only ever returned when WaitForSingleObject
// actually reported WAIT_OBJECT_0 -- termination is never assumed to have
// succeeded (or to have closed anything the child held, such as an inherited
// pipe handle) merely because TerminateProcess returned. `deadlineMs` is
// caller-supplied so the frame-write cancellation path can use
// HelperSessionConfig::frameCancelTimeoutMs, distinct from every other
// caller's fixed kDefaultChildCleanupDeadlineMs.
ChildCleanupOutcome platformForceTerminate(
    HelperSessionHandles& handles, int deadlineMs) {
  if (handles.process == nullptr) {
    return ChildCleanupOutcome::NoChild;  // nothing left to own
  }
  const BOOL terminateResult = TerminateProcess(handles.process, 1);
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  // Test-only: model an unconfirmed termination without an actually-stuck
  // process, so the durable-ownership transfer path runs deterministically.
  // The TerminateProcess request above still fired, so the process does die
  // and a later registry poll confirms + closes it.
  if (g_forceNextChildCleanupTimeout.exchange(false)) {
    return ChildCleanupOutcome::StillRunning;
  }
#endif
  const DWORD waitMs =
      deadlineMs < 0 ? INFINITE : static_cast<DWORD>(deadlineMs);
  const DWORD waitResult = WaitForSingleObject(handles.process, waitMs);
  if (waitResult == WAIT_OBJECT_0) {
    return ChildCleanupOutcome::Released;
  }
  if (waitResult == WAIT_TIMEOUT) {
    // Still alive at the deadline. If the terminate request itself failed,
    // report that distinctly (a subsequent retry may still succeed).
    return terminateResult ? ChildCleanupOutcome::StillRunning
                           : ChildCleanupOutcome::TerminateFailed;
  }
  return ChildCleanupOutcome::WaitFailed;  // WAIT_FAILED / WAIT_ABANDONED
}

// Closes the process/thread handles and, on confirmed release, retires the
// session's now-unused pre-launch child-cleanup fallback: releases its
// durable-registry reservation and drops the still-unadopted entry. Only
// safe to call once resolution is confirmed (childOwnershipReleased()) --
// see HelperProcessSession::stop().
void platformReleaseChildProcess(HelperSessionHandles& handles) {
  closeHandleOnce(handles.process);
  closeHandleOnce(handles.thread);
  if (handles.childFallback != nullptr) {
    handles.childFallback.reset();
    HelperProcessCleanupRegistry::instance().releaseChildFallbackReservation();
  }
}

// Transfers an unresolved child process (TerminateProcess requested but exit
// not confirmed within the bound) to the durable cleanup registry, which
// outlives this session and confirms exit + closes both handles later.
//
// v0.13.0 (#534 final-ownership hardening): infallible. The durable-registry
// capacity and the ProcessHandleCleanup entry itself were both already
// reserved/allocated before this child ever existed (see platformLaunch), so
// this is now just adopt() (noexcept) + commitChildFallback() (non-throwing,
// capacity pre-grown at reserve) -- no allocation, cannot fail. Defensive
// no-op only if there is genuinely nothing to transfer (handles.process is
// null) or the fallback was somehow never prepared (unreachable for any
// session that reached Launched).
void transferChildProcessToRegistry(
    HelperSessionHandles& handles, bool terminationDelivered) {
  if (handles.process == nullptr || handles.childFallback == nullptr) {
    return;  // nothing to transfer
  }
  handles.childFallback->adopt(
      handles.process, handles.thread, terminationDelivered);
  HelperProcessCleanupRegistry::instance().commitChildFallback(
      std::move(handles.childFallback));
  handles.process = nullptr;
  handles.thread = nullptr;
}

// v0.13.0 (#534 hardening): exception-safe rollback guard for the process-
// wide unresolved-operation reservation. Armed for the span between a
// successful tryReserve() and a successfully-constructed writer thread: if a
// throwing setup step in between unwinds the stack, the destructor releases
// the reservation exactly once. disarm() hands rollback responsibility back
// to the existing (unchanged) post-thread release()/commit() call sites.
class FrameWriterReservationGuard {
 public:
  explicit FrameWriterReservationGuard(HelperProcessCleanupRegistry& registry)
      : registry_(registry) {}

  FrameWriterReservationGuard(const FrameWriterReservationGuard&) = delete;
  FrameWriterReservationGuard& operator=(const FrameWriterReservationGuard&) =
      delete;

  ~FrameWriterReservationGuard() noexcept {
    if (armed_) {
      registry_.releaseReservation();
    }
  }

  void disarm() noexcept { armed_ = false; }

 private:
  HelperProcessCleanupRegistry& registry_;
  bool armed_ = true;
};

// v0.13.0 (#534 hardening): exception-safe rollback guard for the just-
// duplicated frame-write pipe HANDLE (ownHandle). Armed from the moment
// DuplicateHandle succeeds until the writer thread that captures ownHandle by
// value (and closes it on every one of its own exit paths) is successfully
// constructed. On a setup exception the destructor closes the handle exactly
// once; disarm() transfers closing responsibility to the running thread.
class FrameWriterHandleGuard {
 public:
  explicit FrameWriterHandleGuard(HANDLE handle) : handle_(handle) {}

  FrameWriterHandleGuard(const FrameWriterHandleGuard&) = delete;
  FrameWriterHandleGuard& operator=(const FrameWriterHandleGuard&) = delete;

  ~FrameWriterHandleGuard() noexcept {
    if (armed_) {
      closeHandleOnce(handle_);
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
      g_duplicatedFrameWriterHandleCount.fetch_sub(
          1, std::memory_order_acq_rel);
#endif
    }
  }

  void disarm() noexcept { armed_ = false; }

 private:
  HANDLE handle_;
  bool armed_ = true;
};

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
// One-shot: throws lvk::tracker::FrameWriterSetupFailureInjectedForTest iff
// the currently-armed stage matches `stage`, consuming the armed stage first
// so it can never fire twice. Exercises platformWriteFrame's exception-safe
// rollback deterministically without OOM or global operator new overrides.
struct FrameWriterSetupFailureInjectedForTest {};

void maybeInjectFrameWriterSetupFailure(test_seam::FrameWriterSetupFailure stage) {
  const int armed =
      g_nextFrameWriterSetupFailure.load(std::memory_order_acquire);
  if (armed == static_cast<int>(stage) &&
      armed != static_cast<int>(test_seam::FrameWriterSetupFailure::None)) {
    g_nextFrameWriterSetupFailure.store(
        static_cast<int>(test_seam::FrameWriterSetupFailure::None),
        std::memory_order_release);
    throw FrameWriterSetupFailureInjectedForTest{};
  }
}
#endif

// v0.13.0 (#534, ownership-hardened; repaired further to remove the
// post-start-allocation contradiction): heap-allocated context the writer
// thread exclusively owns from the moment _beginthreadex hands it off (see
// platformWriteFrame) until the thread frees it itself on every exit path.
// Holds its OWN shared_ptr copies of state/buffer -- independent of whatever
// a ThreadOwnedWriterCleanup durable entry also holds -- so that entry's
// teardown-time release of ITS OWN references can never free memory this
// still-running thread might still be touching.
struct FrameWriterThreadContext {
  std::shared_ptr<std::vector<std::uint8_t>> buffer;
  std::shared_ptr<FrameWriteOperationState> state;
  HANDLE ownHandle = nullptr;
};

// _beginthreadex start routine. _beginthreadex (not raw CreateThread) is
// used because this writer body executes C++/CRT constructs (std::vector,
// shared_ptr), which requires CRT-aware thread initialization. Takes
// exclusive ownership of `rawContext` (heap-allocated by platformWriteFrame,
// handed off via context.release() the instant this thread is confirmed
// started) and frees it itself, independent of platformWriteFrame's own
// stack frame or any durable registry entry's lifetime.
unsigned __stdcall runFrameWriterThread(void* rawContext) {
  std::unique_ptr<FrameWriterThreadContext> context(
      static_cast<FrameWriterThreadContext*>(rawContext));
  std::size_t written = 0;
  bool ok = true;
  while (written < context->buffer->size()) {
    DWORD chunk = 0;
    const DWORD toWrite =
        static_cast<DWORD>(context->buffer->size() - written);
    if (!WriteFile(
            context->ownHandle, context->buffer->data() + written, toWrite,
            &chunk, nullptr) ||
        chunk == 0) {
      ok = false;
      break;
    }
    written += chunk;
  }
  context->state->success.store(ok, std::memory_order_release);
  // Exclusively owned by this thread (never handles.frameWrite, never
  // touched by ThreadOwnedWriterCleanup): always closed here, on every path,
  // so this writer never leaks a handle and never touches session-owned
  // state.
  CloseHandle(context->ownHandle);
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  g_duplicatedFrameWriterHandleCount.fetch_sub(1, std::memory_order_acq_rel);
#endif
  // Set last: once a reader observes finished == true, this thread will
  // never touch context (or anything reachable through it) again.
  context->state->finished.store(true, std::memory_order_release);
  return 0;
  // `context` (unique_ptr) is destroyed here, releasing this thread's OWN
  // state/buffer shared_ptr references -- independent of whatever a durable
  // ThreadOwnedWriterCleanup entry still holds.
}

// v0.13.0 (#534, ownership-hardened; repaired further): bounded frame packet
// write with provably-bounded cancellation and DURABLE writer-operation
// ownership.
//
// Ownership: the writer thread never touches handles.frameWrite, handles.*,
// HelperProcessSession, or any stack/session-owned data. Before spawning it,
// this function DuplicateHandle()s a private HANDLE (ownHandle) that is
// handed, via the writer's own FrameWriterThreadContext, exclusively to the
// writer thread, which closes it itself on every exit path.
//
// Process-wide accumulation bound: at most one unresolved cleanup operation
// may exist process-wide. This function ATOMICALLY reserves the single
// registry slot up front (tryReserve, which drains resolved entries then fails
// closed if anything is pending or reserved from ANY session -- no pump-then-
// count race), holds it for the whole operation, and either releases it on a
// resolved outcome or commits it into a durable ThreadOwnedWriterCleanup on
// an unresolved one. So writers never stack across sessions.
//
// Sequence (every durable-ownership allocation happens BEFORE the writer
// thread starts, removing the historical post-start-allocation-failure
// corner where neither join() nor detach() nor a leaked joinable thread was
// safe):
//   1. Allocate, in order, inside one exception-safe try block: the shared
//      completion state, the packet buffer copy, the writer's own
//      FrameWriterThreadContext, and the durable ThreadOwnedWriterCleanup
//      entry (still holding no live thread HANDLE). Any failure here means
//      no writer thread is ever started -- ordinary pre-thread rollback via
//      the existing reservation/pipe-handle guards, exactly like Slice 2.
//   2. Start the writer via _beginthreadex, handing it the already-allocated
//      context (context.release()). If this fails, again no writer thread
//      exists -- the same pre-thread rollback applies; the pre-allocated
//      `entry` and `context` are destroyed harmlessly (neither owns
//      ownHandle itself; the pipe-handle guard does).
//   3. On success, adopt the returned HANDLE into `entry` via
//      adoptThreadHandle() -- noexcept, cannot fail -- so `entry` is now a
//      fully-formed durable owner, ready to commit with no further
//      allocation, for the remainder of this call.
//   4. First wait up to `timeoutMs` against the returned thread HANDLE.
//      WAIT_OBJECT_0: confirmed done -- finalize synchronously (entry->poll(),
//      which closes the HANDLE and releases entry's own state/buffer
//      references -- never a join(), since no std::thread is involved),
//      release the reservation, return the outcome.
//   5. WAIT_TIMEOUT / WAIT_FAILED: CancelSynchronousIo, then
//      platformForceTerminate the child, then a second wait bounded by
//      cancelTimeoutMs. WAIT_OBJECT_0: finalize synchronously as above,
//      release the reservation, return false.
//   6. Still unconfirmed: commit the ALREADY fully-formed `entry` into the
//      durable registry (non-throwing, no allocation). The registry -- never
//      a bare detached or joinable thread -- becomes the sole owner.
// Exactly one of (4/5 confirmed) or (6 unresolved) is ever reached; there is
// no third fallback and no path returns with a joinable local thread.
bool platformWriteFrame(
    HelperSessionHandles& handles,
    const std::vector<std::uint8_t>& packetBytes,
    int timeoutMs,
    int cancelTimeoutMs) {
  if (handles.frameWrite == nullptr) {
    return false;
  }

  // Process-wide unresolved-operation bound, enforced ATOMICALLY: reserve the
  // single slot up front (this drains already-resolved entries first, then
  // fails closed if anything is pending or already reserved -- no pump-then-
  // count race where two sessions both observe zero). The reservation is held
  // for the whole operation; every path below either releaseReservation()s it
  // (write resolved / setup failed) or commit()s it into a durable
  // ThreadOwnedWriterCleanup (unresolved transfer). Bounds total unresolved
  // writers/handles/buffers to at most one across all sessions.
  auto& registry = HelperProcessCleanupRegistry::instance();
  if (!registry.tryReserve()) {
    return false;  // fail closed rather than accumulate a second operation
  }
  // Armed until the writer thread below is successfully started; see
  // FrameWriterReservationGuard.
  FrameWriterReservationGuard reservationGuard(registry);

  HANDLE ownHandle = nullptr;
  if (!DuplicateHandle(
          GetCurrentProcess(), handles.frameWrite, GetCurrentProcess(),
          &ownHandle, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
    return false;  // reservationGuard releases the reservation on unwind
  }
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  g_duplicatedFrameWriterHandleCount.fetch_add(1, std::memory_order_acq_rel);
#endif
  // Armed until the writer thread below is successfully started; see
  // FrameWriterHandleGuard.
  FrameWriterHandleGuard handleGuard(ownHandle);

  // Every allocation the durable-ownership path could ever need is prepared
  // HERE, before the writer thread exists, so starting the thread below can
  // never encounter a fallible allocation or HANDLE duplication again.
  std::shared_ptr<FrameWriteOperationState> state;
  std::shared_ptr<std::vector<std::uint8_t>> bufferCopy;
  std::unique_ptr<FrameWriterThreadContext> context;
  std::unique_ptr<ThreadOwnedWriterCleanup> entry;
  try {
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    maybeInjectFrameWriterSetupFailure(
        test_seam::FrameWriterSetupFailure::StateAllocation);
#endif
    state = std::make_shared<FrameWriteOperationState>();
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    maybeInjectFrameWriterSetupFailure(
        test_seam::FrameWriterSetupFailure::BufferAllocation);
#endif
    bufferCopy = std::make_shared<std::vector<std::uint8_t>>(packetBytes);

    context = std::make_unique<FrameWriterThreadContext>();
    context->buffer = bufferCopy;
    context->state = state;
    context->ownHandle = ownHandle;

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    maybeInjectFrameWriterSetupFailure(
        test_seam::FrameWriterSetupFailure::DurableEntryAllocation);
#endif
    entry = std::make_unique<ThreadOwnedWriterCleanup>(state, bufferCopy);

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    maybeInjectFrameWriterSetupFailure(
        test_seam::FrameWriterSetupFailure::ThreadConstruction);
#endif
  } catch (...) {
    // Every allocation above (state, buffer, context, entry) happens before
    // any writer thread exists: handleGuard closes ownHandle and
    // reservationGuard releases the reservation as this scope unwinds (both
    // still armed). context/entry, if partially constructed, are destroyed
    // harmlessly by their own RAII -- neither owns ownHandle itself
    // (handleGuard does), and entry's thread HANDLE was never adopted. Fail
    // closed exactly like every other setup failure.
    return false;
  }

  // All durable-ownership allocation is now complete. Starting the writer
  // thread from here on can therefore never need another allocation or
  // another HANDLE duplication.
  unsigned threadId = 0;
  FrameWriterThreadContext* rawContext = context.get();
  const HANDLE threadHandle = reinterpret_cast<HANDLE>(_beginthreadex(
      nullptr, 0, runFrameWriterThread, rawContext, 0, &threadId));
  if (threadHandle == nullptr) {
    // The writer never started: handleGuard/reservationGuard (still armed)
    // roll back exactly as above. context/entry are destroyed harmlessly.
    return false;
  }

  // The thread now exclusively owns its own FrameWriterThreadContext
  // (released here), independent of `entry` -- so process-teardown
  // destruction of `entry` can never free memory the running writer still
  // touches (see ThreadOwnedWriterCleanup).
  context.release();
  // Adopts threadHandle into `entry`, noexcept: cannot fail, so `entry` is
  // now a fully-formed durable owner, ready to commit with no further
  // allocation, for the remainder of this call.
  entry->adoptThreadHandle(threadHandle);

  handleGuard.disarm();       // ownHandle is now exclusively the (released)
                               // context's, owned by the running thread.
  reservationGuard.disarm();  // the reservation's fate is decided below,
                               // either by releaseReservation() or commit().

  // Resolves a CONFIRMED-complete writer synchronously. This is the only
  // finalization path platformWriteFrame ever takes: it is called only after
  // threadHandle has reported WAIT_OBJECT_0, so entry->poll()'s own internal
  // re-check on the identical HANDLE resolves immediately (never a join(),
  // since no std::thread is involved anywhere in this design).
  const auto finalizeConfirmedCompletion = [&]() { entry->poll(); };

  const DWORD firstWaitMs =
      timeoutMs < 0 ? INFINITE : static_cast<DWORD>(timeoutMs);
  const DWORD firstWait = WaitForSingleObject(threadHandle, firstWaitMs);
  if (firstWait == WAIT_OBJECT_0) {
    finalizeConfirmedCompletion();
    registry.releaseReservation();  // resolved: no durable entry committed
    return state->success.load(std::memory_order_acquire);
  }
  // WAIT_TIMEOUT / WAIT_FAILED: not confirmed done -- run the bounded
  // cancellation sequence below.

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  const bool forceTransfer =
      g_forceFrameWriteUnresolvedTransfer.load(std::memory_order_acquire);
#else
  constexpr bool forceTransfer = false;
#endif

  if (!forceTransfer) {
    const BOOL cancelResult = CancelSynchronousIo(threadHandle);
    // Best-effort: platformForceTerminate's checked outcome (and, ultimately,
    // the second wait) is the real confirmation, not this return value.
    (void)cancelResult;
    const ChildCleanupOutcome terminateOutcome =
        platformForceTerminate(handles, cancelTimeoutMs);
    (void)terminateOutcome;  // informational; second wait is the write's signal

    const DWORD secondWaitMs =
        cancelTimeoutMs < 0 ? INFINITE : static_cast<DWORD>(cancelTimeoutMs);
    const DWORD secondWait = WaitForSingleObject(threadHandle, secondWaitMs);
    if (secondWait == WAIT_OBJECT_0) {
      finalizeConfirmedCompletion();
      registry.releaseReservation();  // resolved: no durable entry committed
      return false;
    }
  }
  // (forceTransfer: skip cancel+terminate so the writer stays genuinely
  // blocked, deterministically reaching the commit branch below. The
  // caller's later stop() -- or the registry entry's own re-cancellation --
  // performs the termination that finally unblocks it.)

  // Unconfirmed: `entry` is already a fully-formed durable owner (state,
  // buffer, and the adopted thread HANDLE), so committing it requires no
  // further allocation and cannot fail. The registry -- never a bare
  // detached or joinable thread -- becomes the sole owner from here. This is
  // the ONLY other outcome besides the confirmed-synchronous one above: no
  // third fallback exists.
  registry.commit(std::move(entry));
  return false;
}

void platformClose(HelperSessionHandles& handles) {
  closeHandleOnce(handles.childStdinWrite);
  closeHandleOnce(handles.childStdoutRead);
  closeHandleOnce(handles.childStderrRead);
  closeHandleOnce(handles.frameWrite);
  // handles.process/handles.thread and handles.launched are resolved
  // separately (see platformReleaseChildProcess / transferChildProcessToRegistry
  // and HelperProcessSession::stop()) so unresolved child-process ownership is
  // never silently discarded merely because these descriptors were closed.
}

}  // namespace

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
namespace {
// _beginthreadex start routine used ONLY by
// test_seam::exerciseWriterTeardownForTest() below to exercise
// ThreadOwnedWriterCleanup's destructor in isolation from
// platformWriteFrame/the durable registry. Does no I/O and returns
// immediately, so it can never be left genuinely blocked past that call.
unsigned __stdcall teardownProbeThreadMain(void* /*unused*/) { return 0; }
}  // namespace

namespace test_seam {
void setForceFrameWriteUnresolvedTransfer(bool enabled) {
  g_forceFrameWriteUnresolvedTransfer.store(enabled, std::memory_order_release);
}
void setForceNextChildCleanupTimeout(bool enabled) {
  g_forceNextChildCleanupTimeout.store(enabled, std::memory_order_release);
}
// Windows has no POSIX exec-status pipe; these are inert on this platform.
void setNextExecStatusInjection(ExecStatusInjection) {}
bool claimPidOwnershipForTest(long long) { return true; }
void releasePidOwnershipForTest(long long) {}
// Windows owns a HANDLE pair (unique by construction), not a pid claimed from
// a shared set, so there is no pre-fork claim preparation to fail here, and no
// pid-reuse serialization to exercise.
void setForceNextPidClaimPreparationFailure(bool) {}
bool exercisePidClaimReuseForTest(long long) { return true; }
long long durableChildProcessHandleCountForTest() {
  return g_durableChildProcessHandleCount.load(std::memory_order_acquire);
}
void setNextFrameWriterSetupFailure(FrameWriterSetupFailure stage) {
  g_nextFrameWriterSetupFailure.store(
      static_cast<int>(stage), std::memory_order_release);
}
long long frameWriterDuplicatedHandleCountForTest() {
  return g_duplicatedFrameWriterHandleCount.load(std::memory_order_acquire);
}
long long durableWriterThreadHandleCountForTest() {
  return g_durableWriterThreadHandleCount.load(std::memory_order_acquire);
}
void setForceNextWriterTeardownWaitUnconfirmed(bool enabled) {
  g_forceNextWriterTeardownWaitUnconfirmed.store(
      enabled, std::memory_order_release);
}
bool exerciseWriterTeardownForTest() {
  auto state = std::make_shared<FrameWriteOperationState>();
  auto buffer = std::make_shared<std::vector<std::uint8_t>>();
  auto entry = std::make_unique<ThreadOwnedWriterCleanup>(state, buffer);

  unsigned threadId = 0;
  const HANDLE threadHandle = reinterpret_cast<HANDLE>(_beginthreadex(
      nullptr, 0, teardownProbeThreadMain, nullptr, 0, &threadId));
  if (threadHandle == nullptr) {
    return false;
  }
  entry->adoptThreadHandle(threadHandle);
  const long long adoptedCount =
      g_durableWriterThreadHandleCount.load(std::memory_order_acquire);

  // Real, bounded wait so the trivial probe thread has genuinely exited
  // BEFORE the unconfirmed-teardown injection is armed below -- this call
  // never leaves a real thread running past its own return.
  WaitForSingleObject(threadHandle, 2000);

  g_forceNextWriterTeardownWaitUnconfirmed.store(
      true, std::memory_order_release);
  entry.reset();  // destructor runs now, under the forced-unconfirmed branch

  const long long afterCount =
      g_durableWriterThreadHandleCount.load(std::memory_order_acquire);
  return adoptedCount == 1 && afterCount == 0;
}
}  // namespace test_seam
#endif

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

namespace {
// Forward declaration only: PidCleanup's full definition sits below, after
// its dependencies (tryReap, the pid-ownership dedup guard). Unnamed
// namespaces in the same translation unit all refer to the one TU-local
// namespace, so this and the later definition name the same type.
class PidCleanup;
}  // namespace

struct HelperSessionHandles {
  int stdinWrite = -1;
  int stdoutRead = -1;
  int stderrRead = -1;
  // v0.13.0 (#534): parent's non-blocking write end of the private frame
  // pipe. Only valid when the session was launched with
  // enableFrameTransport = true.
  int frameWrite = -1;
  pid_t pid = -1;
  bool launched = false;
  // v0.13.0 (#534 final-ownership hardening): this session's pre-launch-
  // prepared child-cleanup fallback (see ChildFallbackReservationGuard /
  // platformLaunch). Non-null and unadopted (pid_ == -1) for the whole span
  // between successful pre-launch preparation and either a confirmed clean
  // release (platformReleaseChildProcess resets it) or an unresolved commit
  // (transferChildProcessToRegistry moves it into the registry).
  std::unique_ptr<PidCleanup> childFallback;
};

namespace {

// Fixed child fd for the private frame pipe (v0.13.0, #534), established via
// dup2 before exec. Only meaningful when the child was also launched with
// "--session-frame-mode". No value needs to be communicated to the child --
// POSIX fd numbers are stable across exec via dup2, unlike Windows handles.
constexpr int kFrameTransportChildFd = 3;

void sleepMs(int milliseconds) {
  struct timespec request{};
  request.tv_sec = milliseconds / 1000;
  request.tv_nsec = static_cast<long>(milliseconds % 1000) * 1000000L;
  nanosleep(&request, nullptr);
}

// Checked close-on-exec setup. Returns false on any F_GETFD/F_SETFD failure
// so the caller can abort launch before fork() rather than continue with a
// partially-configured (and possibly exec-leaked) descriptor.
bool setCloexecChecked(int fd) {
  const int flags = fcntl(fd, F_GETFD, 0);
  if (flags < 0) {
    return false;
  }
  if ((flags & FD_CLOEXEC) != 0) {
    return true;
  }
  return fcntl(fd, F_SETFD, flags | FD_CLOEXEC) == 0;
}

void closeFdOnce(int& fd) {
  if (fd >= 0) {
    close(fd);
    fd = -1;
  }
}

// Checked, EINTR-safe dup2. On success, also explicitly clears FD_CLOEXEC on
// the destination: POSIX leaves FD_CLOEXEC untouched (a real dup2 would
// clear it) when oldFd == newFd, which can otherwise leave a low-numbered
// stdio/frame fd incorrectly closed across exec if a source pipe fd ever
// aliases its destination.
bool dup2Checked(int oldFd, int newFd) {
  while (true) {
    if (dup2(oldFd, newFd) == newFd) {
      const int flags = fcntl(newFd, F_GETFD, 0);
      if (flags < 0) {
        return false;
      }
      if ((flags & FD_CLOEXEC) != 0 &&
          fcntl(newFd, F_SETFD, flags & ~FD_CLOEXEC) != 0) {
        return false;
      }
      return true;
    }
    if (errno == EINTR) {
      continue;
    }
    return false;
  }
}

// Reads exactly `length` bytes from `fd`, accumulating across multiple
// read() calls (a single read() is not guaranteed to deliver the full count
// even for one atomic writer-side write). Returns the total byte count:
// 0 means clean EOF before any byte arrived (the expected "exec succeeded"
// signal on the exec-error pipe); `length` means a complete value was read;
// any other non-negative value means EOF arrived mid-value (an ambiguous,
// not-fully-readable outcome the caller must fail closed on); -1 means a
// hard read error. EINTR is retried without affecting the result.
// Deadline-bounded exec-status read: waits at most `deadlineMs` (one absolute
// deadline, via poll) to accumulate up to `length` bytes. Returns:
//   0                  -> clean EOF before any byte (exec succeeded: the
//                         CLOEXEC exec-error pipe closed on a successful exec)
//   length             -> full payload (child reported a setup/exec failure)
//   1..length-1        -> partial EOF (ambiguous)
//   -1                 -> deadline expired, hard poll/read error, or EOF
//                         with an ambiguous state (all ambiguous)
// The caller treats anything other than 0 or length as an ambiguous failure
// that must fail closed. EINTR is retried against the SAME deadline, so a
// stalled child before exec cannot hang launch ahead of readyTimeoutMs.
ssize_t readExactBounded(
    int fd, void* buffer, std::size_t length, int deadlineMs) {
  const long long deadline = nowMs() + deadlineMs;
  std::size_t totalRead = 0;
  while (totalRead < length) {
    const long long remaining = deadline - nowMs();
    if (remaining <= 0) {
      return -1;  // deadline expired -> ambiguous
    }
    struct pollfd pfd{};
    pfd.fd = fd;
    pfd.events = POLLIN;
    const int polled = poll(&pfd, 1, static_cast<int>(remaining));
    if (polled < 0) {
      if (errno == EINTR) {
        continue;  // retry against the same deadline
      }
      return -1;  // hard poll error -> ambiguous
    }
    if (polled == 0) {
      return -1;  // slice/deadline timeout -> ambiguous
    }
    if ((pfd.revents & (POLLIN | POLLHUP | POLLERR)) == 0) {
      continue;
    }
    const ssize_t result =
        read(fd, static_cast<char*>(buffer) + totalRead, length - totalRead);
    if (result < 0) {
      if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) {
        continue;
      }
      return -1;  // hard read error -> ambiguous
    }
    if (result == 0) {
      // EOF: 0 total is the success signal; a partial total is ambiguous.
      return static_cast<ssize_t>(totalRead);
    }
    totalRead += static_cast<std::size_t>(result);
  }
  return static_cast<ssize_t>(totalRead);  // == length: child-reported failure
}

// Reaps the child if it has exited, using WNOHANG only -- never a blocking
// waitpid. Returns true when the child was successfully reaped or is
// already gone (ECHILD); false while still running or on a
// transient/unknown error (pid ownership is NOT cleared on such errors).
bool tryReap(pid_t& pid) {
  if (pid < 0) {
    return true;
  }
  while (true) {
    int status = 0;
    const pid_t result = waitpid(pid, &status, WNOHANG);
    if (result == pid) {
      pid = -1;
      return true;
    }
    if (result == 0) {
      return false;  // still running
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

// The single kill+reap primitive used by every production termination path
// (launch failure after an ambiguous/reported exec outcome, O_NONBLOCK setup
// failure, and forced shutdown via platformForceTerminate) so there is
// exactly one bounded-cleanup implementation to reason about. Never calls a
// blocking waitpid: kill() is checked (EINTR-retried), then the child is
// reaped via a deadline-bounded waitpid(WNOHANG) loop. Returns Released only
// on a confirmed reap or confirmed ECHILD; otherwise a finer unresolved
// outcome, with pid left untouched so the caller can honestly represent
// unresolved ownership rather than silently discarding it.
ChildCleanupOutcome killAndReapBounded(pid_t& pid, int deadlineMs) {
  if (pid < 0) {
    return ChildCleanupOutcome::NoChild;
  }

  bool killDelivered = false;
  while (true) {
    if (kill(pid, SIGKILL) == 0) {
      killDelivered = true;  // signal delivered (also true for a zombie)
      break;
    }
    if (errno == EINTR) {
      continue;
    }
    // ESRCH/EPERM/other: a signal-delivery failure alone doesn't prove the
    // child's fate, so still attempt the bounded reap below.
    break;
  }

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  // Test-only: model an unconfirmed reap without an actually-stuck process,
  // so the durable-ownership transfer path runs deterministically. SIGKILL
  // was issued above, so the child dies and a later registry reap collects
  // it; we just skip the reap loop here and report it still-running.
  if (g_forceNextChildCleanupTimeout.exchange(false)) {
    return ChildCleanupOutcome::StillRunning;
  }
#endif

  const long long deadline = nowMs() + deadlineMs;
  while (true) {
    if (tryReap(pid)) {
      return ChildCleanupOutcome::Released;  // reaped, or confirmed ECHILD
    }
    if (nowMs() >= deadline) {
      // pid left as-is: unresolved. Distinguish "still alive at deadline"
      // from "the terminate request itself failed" for the caller.
      return killDelivered ? ChildCleanupOutcome::StillRunning
                           : ChildCleanupOutcome::TerminateFailed;
    }
    sleepMs(2);
  }
}

// Process-wide guard preventing two durable cleanup owners from ever
// waitpid()-ing the same pid: after one owner reaps it and the slot is
// recycled by the OS, a second owner could otherwise reap an unrelated (or
// a newly-launched) child. A pid's ownership is claimed exactly once at
// transfer and released when its PidCleanup entry is destroyed.
std::mutex& ownedPidMutex() {
  static std::mutex m;
  return m;
}
std::set<pid_t>& ownedPidSet() {
  static std::set<pid_t> s;
  return s;
}
// Transient placeholder key used only to force one std::set node allocation
// inside prepareClaim(): inserted and immediately extracted under the lock so
// the resulting node's memory can be reused, post-fork, for the real pid
// WITHOUT a second allocation (see PidCleanup::activateClaim). Never a real
// child pid: fork() only ever yields pids > 0, so this negative sentinel can
// never collide with an actual owned pid.
constexpr pid_t kPidClaimSentinel = -1;
void releasePidOwnership(pid_t pid) {
  std::lock_guard<std::mutex> lock(ownedPidMutex());
  ownedPidSet().erase(pid);
}
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
// Test-only direct probe of the process-wide pid-ownership set's uniqueness --
// the exact invariant PidCleanup::activateClaim() relies on for exact-once
// waitpid ownership (both operate on the one ownedPidSet()). Production no
// longer inserts through this path (it inserts a preallocated node via
// activateClaim so the post-fork commit never allocates), so it is compiled
// out of production binaries.
bool claimPidOwnership(pid_t pid) {
  std::lock_guard<std::mutex> lock(ownedPidMutex());
  return ownedPidSet().insert(pid).second;  // false if already owned
}
#endif

// Bounded number of EINTR retries for the WNOHANG reap performed inside the
// pid-claim critical section (reapAndReleaseLocked). WNOHANG never blocks, so a
// single syscall is the norm; this small cap keeps the critical section bounded
// even under a pathological signal storm without an unbounded loop while
// holding ownedPidMutex(). If still interrupted after this many tries, the reap
// is simply deferred to a later poll() (the claim is retained).
constexpr int kPidReapEintrRetries = 8;

// Outcome of PidCleanup::activateClaim, so the caller can tell the ONLY safe-
// to-drop failure (an active durable owner already holds this exact pid's claim)
// apart from a genuine contradiction (no node was ever prepared), and never
// discards a live direct pid on the latter.
enum class PidClaimResult {
  Claimed,          // the preallocated node was reinserted with pid; this entry
                    // now owns the process-wide claim for it
  DuplicateActive,  // pid is already present in ownedPidSet(); by the claim-
                    // aware reap contract (see reapAndReleaseLocked) that means
                    // an ACTIVE durable owner still holds its UNREAPED claim --
                    // never a reaped-but-not-yet-erased stale remnant
  NoPreparedNode,   // defensive/unreachable: prepareClaim() never ran, so no
                    // node exists to claim with (a launched session always
                    // prepared one pre-fork)
};

// Durable registry entry that owns an unresolved POSIX child pid whose bounded
// reap timed out. It retains a phase: when the transferring kill(SIGKILL) was
// CONFIRMED delivered, poll() only reaps via a non-blocking waitpid(WNOHANG)
// (never re-signalling -- avoiding any pid-reuse hazard); when delivery was
// NOT confirmed (the kill request itself failed), poll() first RETRIES
// kill(SIGKILL) so the child is actually asked to die, because a WNOHANG reap
// alone can never resolve a still-running child that was never signalled.
// ESRCH from kill is NOT treated as reap confirmation; only the waitpid
// confirms release. On resolve (or destruction) it releases the process-wide
// ownership claim (if one was ever made -- see adopt()).
//
// v0.13.0 (#534 final-ownership hardening): allocated BEFORE any child
// exists (see platformLaunch) -- it begins owning no pid and adopts the real
// one, noexcept, the instant the caller decides to commit it. This is what
// removes the historical contradiction: there is no window, after the child
// has been created, where forming this entry could still fail -- an
// unresolved shutdown can ALWAYS commit this already-allocated entry with no
// further allocation (process-wide pid-ownership claiming still happens at
// the caller, immediately before adopt(), exactly as before).
class PidCleanup : public PendingCleanup {
 public:
  PidCleanup() = default;

  PidCleanup(const PidCleanup&) = delete;
  PidCleanup& operator=(const PidCleanup&) = delete;

  // v0.13.0 (#534 allocation-free final cleanup): preallocates the single
  // std::set node this entry will use to claim process-wide pid ownership,
  // BEFORE any child exists. Inserting a transient sentinel forces exactly one
  // node allocation, which extract() then hands to us to keep -- so the
  // real-pid insert done post-fork (activateClaim) never allocates. Returns
  // false on allocation failure (caller fails launch closed before fork; the
  // ChildFallbackReservationGuard drops this entry). Called at most once per
  // entry, strictly pre-fork -- the only place this may allocate.
  bool prepareClaim() {
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
    if (g_forceNextPidClaimPrepFailure.exchange(false)) {
      return false;  // simulate the pre-fork node allocation failing
    }
#endif
    try {
      std::lock_guard<std::mutex> lock(ownedPidMutex());
      auto& set = ownedPidSet();
      const auto inserted = set.insert(kPidClaimSentinel);
      if (!inserted.second) {
        return false;  // sentinel unexpectedly present (never in correct code)
      }
      claimNode_ = set.extract(inserted.first);  // keep the node; no dealloc
    } catch (...) {
      return false;  // out of memory: nothing retained, caller fails closed
    }
    return static_cast<bool>(claimNode_);
  }

  // Claims process-wide ownership of the real `pid` by reinserting the
  // preallocated node (its key overwritten) into ownedPidSet(), under
  // ownedPidMutex() -- the SAME lock the claim-aware reap (reapAndReleaseLocked)
  // holds across its confirming waitpid + erase. Never allocates (the node was
  // allocated in prepareClaim) and never throws (std::less<pid_t> is noexcept,
  // and insert(node_type&&) does no allocation), so it is safe on the
  // destructor emergency path. On an insert collision the recovered node is
  // retained for release and NO second owner is created, preserving exact-once
  // waitpid ownership (see PidClaimResult for how the caller must treat each
  // outcome).
  PidClaimResult activateClaim(pid_t pid) noexcept {
    std::lock_guard<std::mutex> lock(ownedPidMutex());
    if (!claimNode_) {
      return PidClaimResult::NoPreparedNode;
    }
    claimNode_.value() = pid;
    auto result = ownedPidSet().insert(std::move(claimNode_));
    if (!result.inserted) {
      claimNode_ = std::move(result.node);  // recover node so it is freed
      return PidClaimResult::DuplicateActive;
    }
    return PidClaimResult::Claimed;
  }

  // Adopts the real pid. Never throws (plain assignments): must be safely
  // callable the instant the caller has claimed process-wide pid ownership
  // (via activateClaim), whether or not this entry ever ends up committed to
  // the registry.
  void adopt(pid_t pid, bool killDelivered) noexcept {
    pid_ = pid;
    killDelivered_ = killDelivered;
  }

  ~PidCleanup() override {
    if (pid_ >= 0) {
      releasePidOwnership(pid_);
    }
    // If prepared but never activated (pid_ still -1), claimNode_ holds the
    // still-owned preallocated node; ~node_type frees it here exactly once. A
    // successfully activated claim moved the node into the set, so claimNode_
    // is already empty and the erase above is the sole release.
  }

  bool poll() override {
    if (pid_ < 0) {
      return true;
    }
    if (!killDelivered_) {
      // Prior kill was unconfirmed: retry it (non-blocking). kill()==0 (also
      // true for a zombie) confirms delivery; ESRCH/EPERM leave it unconfirmed
      // for a later retry, and are never treated as a reap. The claim-aware
      // reap below is the sole release confirmation. Issued OUTSIDE
      // ownedPidMutex(): the child is still owned (unreaped, so the OS cannot
      // have recycled its pid), so signalling it needs no set serialization.
      if (kill(pid_, SIGKILL) == 0) {
        killDelivered_ = true;
      }
    }
    return reapAndReleaseLocked();
  }

 private:
  // Claim-aware reap: performs the confirming WNOHANG waitpid AND the matching
  // ownedPidSet() erase atomically inside ONE ownedPidMutex() critical section,
  // so no concurrent activateClaim() can ever observe this pid reaped-but-still-
  // claimed (the pid-reuse race). Non-blocking (WNOHANG) and bounded (EINTR
  // retried a small fixed number of times, then deferred to a later poll). On a
  // confirmed reap or ECHILD it erases the pid and clears pid_ (resolved -> the
  // entry may be dropped); otherwise it retains both the claim and pid_. Erases
  // the set entry DIRECTLY rather than via releasePidOwnership(), which would
  // re-lock ownedPidMutex() and self-deadlock.
  bool reapAndReleaseLocked() {
    std::lock_guard<std::mutex> lock(ownedPidMutex());
    if (pid_ < 0) {
      return true;  // already resolved
    }
    for (int attempt = 0; attempt < kPidReapEintrRetries; ++attempt) {
      int status = 0;
      const pid_t result = waitpid(pid_, &status, WNOHANG);
      if (result == pid_) {
        ownedPidSet().erase(pid_);  // erase THIS pid, atomic with the reap
        pid_ = -1;
        return true;
      }
      if (result == 0) {
        return false;  // still running: retain claim + pid_
      }
      // result < 0
      if (errno == EINTR) {
        continue;  // bounded retry within the same critical section
      }
      if (errno == ECHILD) {
        ownedPidSet().erase(pid_);  // already reaped/gone: erase the claim now
        pid_ = -1;
        return true;
      }
      return false;  // other error: retain; a later poll() retries
    }
    return false;  // persistent EINTR: defer to a later poll(), still claimed
  }

  pid_t pid_ = -1;
  bool killDelivered_ = false;
  // Preallocated (pre-fork) std::set node reused to claim pid ownership
  // without a post-fork allocation. Non-empty from prepareClaim() until either
  // activateClaim() moves it into ownedPidSet() or this entry is destroyed.
  std::set<pid_t>::node_type claimNode_;
};

// Adopts `pid` into the session's already-prepared PidCleanup fallback
// (handles.childFallback) and commits it to the durable registry (which
// outlives the session and reaps it later via bounded WNOHANG).
//
// v0.13.0 (#534 final-ownership hardening; allocation-free): infallible AND
// allocation-free. The fallback object, its registry capacity, AND the
// std::set node used to claim pid ownership were all reserved/preallocated
// before this child ever existed (see platformLaunch / PidCleanup::
// prepareClaim), so this is now just activateClaim() (noexcept, reuses the
// preallocated node) + adopt() (noexcept) + commitChildFallback()
// (non-throwing, capacity pre-grown at reserve) -- no allocation anywhere,
// cannot throw. This is what makes the destructor emergency path (see
// HelperProcessSession::emergencyResolveChildOwnership) genuinely noexcept.
// activateClaim() now reports WHY it failed (see PidClaimResult), so a live
// direct pid is dropped ONLY when the drop is provably safe. Clears `pid` and
// handles.childFallback on a successful transfer.
void transferPidToRegistry(
    HelperSessionHandles& handles, pid_t& pid, bool terminationDelivered) {
  if (pid < 0 || handles.childFallback == nullptr) {
    return;  // nothing to transfer
  }
  auto& registry = HelperProcessCleanupRegistry::instance();
  switch (handles.childFallback->activateClaim(pid)) {
    case PidClaimResult::Claimed:
      break;  // sole owner established; adopt + commit below
    case PidClaimResult::DuplicateActive:
      // The pid is present in ownedPidSet(). Because the claim-aware reap now
      // erases a pid atomically with its confirming waitpid (see
      // reapAndReleaseLocked), a present pid means an ACTIVE durable owner
      // still holds this exact child's UNREAPED claim -- there is no reaped-
      // but-not-yet-erased stale window. A live NEW child can never share an
      // unreaped pid (the zombie holds the number), so this is only reachable
      // when `pid` already IS that durable owner's child. Drop our duplicate
      // tracking and release the now-unused reservation; never create a second
      // waitpid owner. (Unreachable in correct code, since a transferred pid is
      // always cleared, but now provably safe if it ever occurs.)
      pid = -1;
      handles.childFallback.reset();
      registry.releaseChildFallbackReservation();
      return;
    case PidClaimResult::NoPreparedNode:
      // Contradiction: a launched session always prepared its claim node
      // pre-fork, so this is unreachable. Do NOT drop the pid on this non-
      // duplicate failure -- retain direct ownership (leave `pid` and the
      // fallback with the caller) rather than misattribute or silently discard
      // the child. The caller's platformReleaseChildProcess path releases the
      // still-held reservation.
      return;
  }
  handles.childFallback->adopt(pid, terminationDelivered);
  registry.commitChildFallback(std::move(handles.childFallback));
  pid = -1;  // ownership moved to the registry entry
}

// Uniform (platform-parallel) transfer entry used by stop(): moves an
// unresolved child (POSIX pid) to the durable registry.
void transferChildProcessToRegistry(
    HelperSessionHandles& handles, bool terminationDelivered) {
  transferPidToRegistry(handles, handles.pid, terminationDelivered);
}

LaunchResult platformLaunch(
    HelperSessionHandles& handles,
    const std::string& executablePath,
    const std::vector<std::string>& arguments,
    bool enableFrameTransport,
    int launchTimeoutMs) {
  // Writing to a helper that has closed its stdin must yield EPIPE, never a
  // process-terminating SIGPIPE. Set once, process-wide; idempotent.
  static const bool ignoredSigpipe = []() {
    signal(SIGPIPE, SIG_IGN);
    return true;
  }();
  (void)ignoredSigpipe;

  // v0.13.0 (#534 final-ownership hardening): reserve durable-registry
  // capacity and pre-allocate the platform cleanup entry BEFORE any child
  // exists, so an unresolved shutdown (or launch failure after fork()) can
  // always commit it (adopt + commit, both noexcept/non-throwing -- see
  // transferPidToRegistry) with no allocation-failure corner left at
  // destruction time. Failure here means launch fails closed before any
  // pipe/fork() activity: no child, no reservation left outstanding.
  auto& registry = HelperProcessCleanupRegistry::instance();
  if (!registry.reserveChildFallback()) {
    return LaunchResult::FailedBeforeChild;
  }
  ChildFallbackReservationGuard<PidCleanup> fallbackGuard(
      registry, handles.childFallback);
  try {
    handles.childFallback = std::make_unique<PidCleanup>();
  } catch (...) {
    return LaunchResult::FailedBeforeChild;  // guard releases the reservation
  }
  // Preallocate (pre-fork) the std::set node this session's fallback will use
  // to claim pid ownership, so an unresolved shutdown's transfer never
  // allocates after the child exists. Any allocation failure here is still
  // strictly before fork() -- fail closed with no child, guard rolls back.
  if (!handles.childFallback->prepareClaim()) {
    return LaunchResult::FailedBeforeChild;  // guard releases the reservation
  }

  int stdinPipe[2] = {-1, -1};
  int stdoutPipe[2] = {-1, -1};
  int stderrPipe[2] = {-1, -1};
  int execErrPipe[2] = {-1, -1};
  int framePipe[2] = {-1, -1};

  const auto closeAll = [&]() {
    closeFdOnce(stdinPipe[0]);
    closeFdOnce(stdinPipe[1]);
    closeFdOnce(stdoutPipe[0]);
    closeFdOnce(stdoutPipe[1]);
    closeFdOnce(stderrPipe[0]);
    closeFdOnce(stderrPipe[1]);
    closeFdOnce(execErrPipe[0]);
    closeFdOnce(execErrPipe[1]);
    closeFdOnce(framePipe[0]);
    closeFdOnce(framePipe[1]);
  };

  if (pipe(stdinPipe) != 0) {
    return LaunchResult::FailedBeforeChild;
  }
  if (pipe(stdoutPipe) != 0 || pipe(stderrPipe) != 0 ||
      pipe(execErrPipe) != 0) {
    closeAll();
    return LaunchResult::FailedBeforeChild;
  }
  if (enableFrameTransport && pipe(framePipe) != 0) {
    closeAll();
    return LaunchResult::FailedBeforeChild;
  }

  // All pipe fds must be CLOEXEC so none leak across exec except the three
  // stdio descriptors (and the fixed frame fd, when enabled), which are
  // re-established via dup2Checked. This is checked and aborts launch before
  // fork() on any failure: the exec-error pipe's write end is especially
  // important here -- if it were not reliably close-on-exec, a successful
  // exec would leave it open in the child and the parent would wait
  // indefinitely for EOF instead of observing it promptly.
  bool cloexecOk = true;
  for (int fd : {stdinPipe[0], stdinPipe[1], stdoutPipe[0], stdoutPipe[1],
                 stderrPipe[0], stderrPipe[1], execErrPipe[0], execErrPipe[1]}) {
    if (!setCloexecChecked(fd)) {
      cloexecOk = false;
      break;
    }
  }
  if (cloexecOk && enableFrameTransport) {
    cloexecOk =
        setCloexecChecked(framePipe[0]) && setCloexecChecked(framePipe[1]);
  }
  if (!cloexecOk) {
    closeAll();
    return LaunchResult::FailedBeforeChild;
  }

  const pid_t pid = fork();
  if (pid < 0) {
    closeAll();
    return LaunchResult::FailedBeforeChild;
  }

  if (pid == 0) {
    // Child: wire the three stdio ends (and the fixed frame fd, when
    // enabled), then exec. Every dup2 is checked; on any failure, report the
    // failure through the existing private exec-error pipe (mirroring the
    // exec-failure path below) and terminate without ever calling execv or
    // writing raw diagnostics to a public stream.
    bool dupOk = dup2Checked(stdinPipe[0], STDIN_FILENO) &&
                 dup2Checked(stdoutPipe[1], STDOUT_FILENO) &&
                 dup2Checked(stderrPipe[1], STDERR_FILENO);
    if (dupOk && enableFrameTransport) {
      dupOk = dup2Checked(framePipe[0], kFrameTransportChildFd);
    }
    if (!dupOk) {
      const int dupErrno = errno;
      ssize_t ignored = write(execErrPipe[1], &dupErrno, sizeof(dupErrno));
      (void)ignored;
      _exit(127);
    }

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
  if (enableFrameTransport) {
    closeFdOnce(framePipe[0]);
  }

  // Determine whether exec (and the child's dup2 setup) succeeded, bounded by
  // launchTimeoutMs. Clean EOF (readExactBounded == 0) => success. A full
  // errno payload (== sizeof) => child-reported failure. Anything else --
  // partial EOF, poll/read error, or deadline expiry (all return -1 or a
  // partial count) -- leaves launch success unproven and is an ambiguous
  // failure that fails closed, never assumed to be success.
  enum class ExecOutcome { Success, ChildReportedFailure, Ambiguous };
  int childErrno = 0;
  const ssize_t reported = readExactBounded(
      execErrPipe[0], &childErrno, sizeof(childErrno), launchTimeoutMs);
  closeFdOnce(execErrPipe[0]);

  ExecOutcome execOutcome;
  if (reported == 0) {
    execOutcome = ExecOutcome::Success;
  } else if (reported == static_cast<ssize_t>(sizeof(childErrno))) {
    execOutcome = ExecOutcome::ChildReportedFailure;
  } else {
    execOutcome = ExecOutcome::Ambiguous;  // -1 (timeout/error) or partial
  }

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  // Test-only: override the classification for the next launch so the
  // ambiguous-exec-status handling (fail closed + bounded child cleanup) can
  // be exercised deterministically. Consumed once.
  switch (g_nextExecStatusInjection.exchange(0)) {
    case 1:  // Timeout
    case 2:  // PartialEof
    case 3:  // HardError
      execOutcome = ExecOutcome::Ambiguous;
      break;
    default:
      break;
  }
#endif

  // Shared post-fork failure cleanup: never begin the ready handshake unless
  // exec success was proven. The child was created, so ownership must be
  // conclusively released or committed to the durable registry -- never
  // dropped from a local variable. `pid` here was never published into
  // handles.pid.
  //
  // v0.13.0 (#534 final-ownership hardening): commit is now infallible (the
  // fallback and its registry capacity were reserved before this child ever
  // existed -- see the top of this function), so there is no third,
  // session-retained outcome left to represent: every path here is either
  // FailedChildReleased or FailedOwnershipTransferred.
  const auto failAfterChild = [&]() -> LaunchResult {
    pid_t deadChild = pid;
    const ChildCleanupOutcome outcome =
        killAndReapBounded(deadChild, kDefaultChildCleanupDeadlineMs);
    closeFdOnce(stdinPipe[1]);
    closeFdOnce(stdoutPipe[0]);
    closeFdOnce(stderrPipe[0]);
    closeFdOnce(framePipe[1]);
    if (childOwnershipReleased(outcome)) {
      return LaunchResult::FailedChildReleased;  // fallbackGuard releases
                                                  // the reservation on unwind
    }
    transferPidToRegistry(
        handles, deadChild, terminationConfirmedDelivered(outcome));
    fallbackGuard.disarm();  // reservation resolved by the commit above
    return LaunchResult::FailedOwnershipTransferred;
  };

  if (execOutcome != ExecOutcome::Success) {
    return failAfterChild();
  }

  if (enableFrameTransport) {
    // The frame-write descriptor must only be published once O_NONBLOCK is
    // proven established; platformWriteFrame relies on this unconditionally.
    // If either fcntl fails, the descriptor cannot be trusted non-blocking:
    // fail closed and release/transfer the already-launched child.
    const int flags = fcntl(framePipe[1], F_GETFL, 0);
    const bool nonBlockOk =
        flags >= 0 && fcntl(framePipe[1], F_SETFL, flags | O_NONBLOCK) == 0;
    if (!nonBlockOk) {
      return failAfterChild();
    }
  }

  handles.stdinWrite = stdinPipe[1];
  handles.stdoutRead = stdoutPipe[0];
  handles.stderrRead = stderrPipe[0];
  handles.frameWrite = framePipe[1];
  handles.pid = pid;
  handles.launched = true;
  // The prepared, still-unadopted fallback now lives for this session's
  // whole lifetime -- resolved later by platformReleaseChildProcess
  // (confirmed release) or transferChildProcessToRegistry (unresolved
  // commit), never by this guard.
  fallbackGuard.disarm();
  return LaunchResult::Launched;
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

// Bounded, non-blocking read pump for both stdout and stderr. Polls with a
// short slice (capped at 5ms) so the caller's own deadline loop remains in
// control of total elapsed time; a poll() timeout or EINTR simply returns
// with no data read, and the caller re-loops against its own deadline. Only
// reads a stream once poll() has reported it ready (POLLIN/POLLHUP/POLLERR),
// so this never issues a blocking read without readiness.
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

// v0.13.0 (#534): bounded, non-blocking frame packet write. The parent's
// frame-write fd is O_NONBLOCK (set at launch), so this function's own
// thread never blocks in a syscall: EAGAIN drives a poll(POLLOUT) wait
// against one overall deadline for header+payload together. A helper that
// never reads exhausts the deadline and this returns false (fail closed);
// there is no thread to cancel because nothing was ever blocked.
// `cancelTimeoutMs` is accepted for signature parity with the Windows
// implementation (which uses it for its writer-thread cancellation
// confirmation) but is unused here: POSIX has no writer thread or
// cancellation stage, so timeoutMs alone already bounds the whole write.
bool platformWriteFrame(
    HelperSessionHandles& handles,
    const std::vector<std::uint8_t>& packetBytes,
    int timeoutMs,
    int cancelTimeoutMs) {
  (void)cancelTimeoutMs;
  if (handles.frameWrite < 0) {
    return false;
  }

  const long long deadline = nowMs() + timeoutMs;
  std::size_t written = 0;
  while (written < packetBytes.size()) {
    const ssize_t chunk = write(
        handles.frameWrite, packetBytes.data() + written,
        packetBytes.size() - written);
    if (chunk > 0) {
      written += static_cast<std::size_t>(chunk);
      continue;
    }
    if (chunk < 0 && errno == EINTR) {
      continue;
    }
    if (chunk < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
      const long long remaining = deadline - nowMs();
      if (remaining <= 0) {
        return false;
      }
      struct pollfd pollFd{};
      pollFd.fd = handles.frameWrite;
      pollFd.events = POLLOUT;
      const int polled = poll(&pollFd, 1, static_cast<int>(remaining));
      if (polled < 0) {
        if (errno == EINTR) {
          continue;  // re-loop against the same overall deadline
        }
        return false;
      }
      if (polled == 0) {
        return false;  // deadline exhausted
      }
      if ((pollFd.revents & (POLLERR | POLLHUP)) != 0) {
        return false;  // reader gone / broken pipe
      }
      continue;  // POLLOUT ready: retry the write
    }
    // EPIPE or any other hard error.
    return false;
  }
  return true;
}

bool platformWaitExit(HelperSessionHandles& handles, int timeoutMs) {
  if (handles.pid < 0) {
    return true;
  }
  long long waited = 0;
  while (true) {
    if (tryReap(handles.pid)) {
      return handles.pid < 0;  // true only if actually reaped / ECHILD
    }
    if (timeoutMs >= 0 && waited >= timeoutMs) {
      return false;
    }
    sleepMs(2);
    waited += 2;
  }
}

// Bounded, ownership-safe force termination: delegates to the single shared
// killAndReapBounded primitive (see its comment for the exact EINTR/ESRCH/
// ECHILD/timeout handling). handles.pid is cleared only on a confirmed
// Released outcome; on TimedOut, ownership is preserved rather than
// silently discarded, so this never claims a child was reaped when it was
// not. `deadlineMs` lets the frame-write cancellation path in
// platformWriteFrame use a distinct, caller-configurable bound; every other
// caller uses kDefaultChildCleanupDeadlineMs.
ChildCleanupOutcome platformForceTerminate(
    HelperSessionHandles& handles, int deadlineMs) {
  return killAndReapBounded(handles.pid, deadlineMs);
}

// No OS handle to release beyond handles.pid itself, which
// killAndReapBounded/tryReap already clear exactly when resolved. On
// confirmed release, retires the session's now-unused pre-launch child-
// cleanup fallback: releases its durable-registry reservation and drops the
// still-unadopted entry. Otherwise exists only so HelperProcessSession::
// stop() has a uniform, platform-independent call site (see the Windows
// implementation, which also closes real HANDLEs).
void platformReleaseChildProcess(HelperSessionHandles& handles) {
  if (handles.childFallback != nullptr) {
    handles.childFallback.reset();
    HelperProcessCleanupRegistry::instance().releaseChildFallbackReservation();
  }
}

void platformClose(HelperSessionHandles& handles) {
  closeFdOnce(handles.stdinWrite);
  closeFdOnce(handles.stdoutRead);
  closeFdOnce(handles.stderrRead);
  closeFdOnce(handles.frameWrite);
  // handles.pid and handles.launched are resolved separately (see
  // platformReleaseChildProcess / transferChildProcessToRegistry and
  // HelperProcessSession::stop()) so unresolved child ownership is never
  // silently discarded merely because these descriptors were closed.
}

}  // namespace

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
namespace test_seam {
// No writer thread exists on POSIX (a single non-blocking poll-bounded write
// covers the whole deadline), so this is inert on this platform.
void setForceFrameWriteUnresolvedTransfer(bool) {}
void setForceNextChildCleanupTimeout(bool enabled) {
  g_forceNextChildCleanupTimeout.store(enabled, std::memory_order_release);
}
void setNextExecStatusInjection(ExecStatusInjection injection) {
  g_nextExecStatusInjection.store(
      static_cast<int>(injection), std::memory_order_release);
}
bool claimPidOwnershipForTest(long long pid) {
  return claimPidOwnership(static_cast<pid_t>(pid));
}
void releasePidOwnershipForTest(long long pid) {
  releasePidOwnership(static_cast<pid_t>(pid));
}
void setForceNextPidClaimPreparationFailure(bool enabled) {
  g_forceNextPidClaimPrepFailure.store(enabled, std::memory_order_release);
}
// Models the OS pid-reuse hazard WITHOUT relying on real reuse timing, using a
// fake pid that is never a child of this process (chosen above the OS pid_max
// so waitpid() yields ECHILD -- treated as a confirmed reap -- and kill()
// yields ESRCH). Proves the claim-aware reap serializes claim release against
// new activation: (1) a prepared claim activates pid N; (2) while N is active/
// unresolved, a second claim of N is DuplicateActive; (3) the claim-aware reap
// removes N under ownedPidMutex() atomically with the confirming wait; (4) a
// freshly prepared claim can then activate the SAME numeric N; (5) a redundant
// resolve is an idempotent no-op (no double erase); and the process-wide set
// returns to its baseline size (no stale owner, second owner, or node leak).
// Runs entirely on stack-local PidCleanup entries -- never touches the durable
// registry, its reservations, or any real child.
bool exercisePidClaimReuseForTest(long long pidValue) {
  const pid_t pid = static_cast<pid_t>(pidValue);
  std::size_t baseline = 0;
  {
    std::lock_guard<std::mutex> lock(ownedPidMutex());
    baseline = ownedPidSet().size();
  }
  bool ok = true;
  {
    // Mirror production's activate -> adopt sequence (transferPidToRegistry):
    // activateClaim() inserts the claim; adopt() sets pid_ so the entry's
    // claim-aware poll() will actually reap and erase it.
    auto a = std::make_unique<PidCleanup>();
    ok = ok && a->prepareClaim();
    if (ok && a->activateClaim(pid) == PidClaimResult::Claimed) {
      a->adopt(pid, /*killDelivered=*/false);
    } else {
      ok = false;
    }

    // While A holds the unresolved claim, a second claim of the SAME pid is
    // rejected as an active duplicate (B never adopts, never becomes a second
    // owner).
    auto b = std::make_unique<PidCleanup>();
    ok = ok && b->prepareClaim();
    ok = ok && b->activateClaim(pid) == PidClaimResult::DuplicateActive;

    // Claim-aware reap (fake pid -> ECHILD) erases N and clears A atomically.
    ok = ok && a->poll();

    // N is free again: a freshly prepared claim reuses the SAME numeric pid.
    auto c = std::make_unique<PidCleanup>();
    ok = ok && c->prepareClaim();
    if (ok && c->activateClaim(pid) == PidClaimResult::Claimed) {
      c->adopt(pid, /*killDelivered=*/false);
    } else {
      ok = false;
    }
    ok = ok && c->poll();  // resolve
    ok = ok && c->poll();  // idempotent: already resolved, no double erase
    // a/c destroyed with pid_ == -1 (no erase); b frees its recovered node
    // without erasing any claim.
  }
  std::lock_guard<std::mutex> lock(ownedPidMutex());
  return ok && ownedPidSet().size() == baseline;
}
// No Windows process/thread HANDLE pair exists on POSIX (the durable pid
// entry is proven via testOnlyRetainedChildPid()/waitpid ECHILD evidence
// instead) -- inert on this platform.
long long durableChildProcessHandleCountForTest() { return 0; }
// POSIX's platformWriteFrame has no writer thread and no throwing setup step
// (no make_shared, no _beginthreadex/thread-start), so this is inert here.
void setNextFrameWriterSetupFailure(FrameWriterSetupFailure) {}
// No duplicated frame-write HANDLE exists on POSIX.
long long frameWriterDuplicatedHandleCountForTest() { return 0; }
// No writer thread, and therefore no durable writer-ownership entry, exists
// on POSIX -- these are inert on this platform.
long long durableWriterThreadHandleCountForTest() { return 0; }
void setForceNextWriterTeardownWaitUnconfirmed(bool) {}
bool exerciseWriterTeardownForTest() { return true; }
}  // namespace test_seam
#endif

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
    case HelperDiagnosticCategory::FrameWriteTimeout:
      return "frame-write-timeout";
    case HelperDiagnosticCategory::FrameAckMismatch:
      return "frame-ack-mismatch";
  }
  return "none";
}

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
long long HelperProcessSession::testOnlyRetainedChildPid() const {
#ifdef _WIN32
  // Windows owns a process/thread HANDLE pair, never a pid; no-op here (see
  // testOnlyDirectlyOwnsChild() for the cross-platform equivalent).
  return -1;
#else
  return handles_ ? static_cast<long long>(handles_->pid) : -1;
#endif
}

bool HelperProcessSession::testOnlyDirectlyOwnsChild() const {
  if (!handles_) {
    return false;
  }
#ifdef _WIN32
  return handles_->process != nullptr;
#else
  return handles_->pid >= 0;
#endif
}

bool HelperProcessSession::testOnlyHasPreparedChildFallback() const {
  return handles_ && handles_->childFallback != nullptr;
}

void HelperProcessSession::testOnlyRunEmergencyResolveChildOwnership() {
  emergencyResolveChildOwnership();
}

namespace test_seam {
// Shared (platform-independent) flag and throw site both live in this TU, so a
// single definition here covers both platforms.
void setForceNextGracefulStopThrow(bool enabled) {
  g_forceNextGracefulStopThrow.store(enabled, std::memory_order_release);
}
}  // namespace test_seam
#endif

HelperProcessSession::HelperProcessSession(HelperSessionConfig config)
    : config_(std::move(config)),
      handles_(std::make_unique<HelperSessionHandles>()) {}

HelperProcessSession::~HelperProcessSession() {
  // No-throw, bounded cleanup backstop for early returns / signals. stop() is
  // idempotent; the normal path fully resolves child ownership.
  try {
    stop();
  } catch (...) {
    // stop() threw (e.g. a std::bad_alloc from its string/buffer work) before
    // it could resolve child ownership. A blanket catch must NOT silently
    // discard a directly-owned pid/HANDLE pair: run the separate, bounded,
    // noexcept, allocation-free emergency path so every directly-owned child
    // ends in either confirmed OS release or a durable-registry commit. It is
    // idempotent and safe after whatever partial progress stop() made.
    emergencyResolveChildOwnership();
  }
}

// See the header for the full contract. Every operation below is bounded,
// noexcept, and allocation-free: platformClose (handle/fd closes only),
// platformForceTerminate (kill/Terminate + bounded wait), the infallible
// transfer (activateClaim reuses the pre-fork node; adopt + commitChildFallback
// never allocate), and platformReleaseChildProcess (closes/reset + reservation
// release). No graceful protocol, no parsing, no string growth -- so nothing
// here can throw, which is what lets this be a genuine noexcept last resort.
void HelperProcessSession::emergencyResolveChildOwnership() noexcept {
  if (cleaned_) {
    return;  // stop() already fully resolved and closed everything
  }
  if (handles_ && handles_->launched) {
    // 1. Close local pipe endpoints (independent OS resources; idempotent).
    platformClose(*handles_);
    // 2/3. One bounded force-terminate/reap attempt on any still-owned child.
    const ChildCleanupOutcome outcome = platformForceTerminate(
        *handles_, kDefaultChildCleanupDeadlineMs);
    // 4/5. Resolve to exactly one durable outcome: confirmed release, or a
    // commit of the already-prepared fallback (no allocation, cannot fail;
    // a no-op if the child was already released or already committed).
    if (!childOwnershipReleased(outcome)) {
      transferChildProcessToRegistry(
          *handles_, terminationConfirmedDelivered(outcome));
    }
    // Release the still-unused fallback reservation and close any still-held
    // HANDLEs (each a no-op if the transfer above already consumed them).
    platformReleaseChildProcess(*handles_);
    handles_->launched = false;
  }
  // 6. Mark local cleanup complete so a later stop()/destructor is inert.
  cleaned_ = true;
  if (state_ != HelperSessionState::Failed) {
    state_ = HelperSessionState::Stopped;
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

bool HelperProcessSession::writeFramePacket(
    std::uint64_t sequence,
    long long frameTimestampMs,
    const FramePixelView& frame,
    std::uint32_t& checksumOut,
    std::uint64_t& payloadBytesOut) {
  FramePacketHeader header;
  header.sequence = sequence;
  header.frameTimestampMs = frameTimestampMs;
  header.width = frame.width;
  header.height = frame.height;
  header.rowStrideBytes = frame.width * 3u;
  header.pixelFormat = kFramePacketFormatBgr24;
  header.payloadBytes =
      static_cast<std::uint64_t>(header.rowStrideBytes) * frame.height;

  std::uint8_t headerBytes[kFramePacketHeaderBytes];
  encodeFramePacketHeader(header, headerBytes);

  // Defensive re-validation through the same bounds the wire format enforces
  // (the caller must already have produced a normalized, in-bounds payload
  // via normalizeBgr24Rows; this catches a caller-side contract violation
  // before anything is written, rather than trusting the caller silently).
  FramePacketHeader revalidated;
  if (frame.data == nullptr ||
      decodeFramePacketHeader(
          headerBytes, kFramePacketHeaderBytes, revalidated) !=
          FramePacketDecodeStatus::Ok) {
    lastDiagnostic_ = HelperDiagnosticCategory::FrameWriteTimeout;
    return false;
  }

  std::vector<std::uint8_t> packetBytes;
  packetBytes.reserve(
      kFramePacketHeaderBytes + static_cast<std::size_t>(header.payloadBytes));
  packetBytes.insert(
      packetBytes.end(), headerBytes, headerBytes + kFramePacketHeaderBytes);
  packetBytes.insert(
      packetBytes.end(), frame.data,
      frame.data + static_cast<std::size_t>(header.payloadBytes));

  if (!platformWriteFrame(
          *handles_, packetBytes, config_.frameTimeoutMs,
          config_.frameCancelTimeoutMs)) {
    lastDiagnostic_ = HelperDiagnosticCategory::FrameWriteTimeout;
    return false;
  }

  checksumOut =
      fnv1a32(frame.data, static_cast<std::size_t>(header.payloadBytes));
  payloadBytesOut = header.payloadBytes;
  return true;
}

bool HelperProcessSession::start() {
  if (state_ != HelperSessionState::NotStarted) {
    return state_ == HelperSessionState::Ready ||
           state_ == HelperSessionState::Running;
  }

  state_ = HelperSessionState::Starting;

  // v0.13.0 (#556): validate the configured expected ready source BEFORE
  // launching a child. An unsupported value fails closed with no launch
  // attempt at all (MalformedMessage, not LaunchFailure).
  if (!isSupportedHelperReadySource(config_.expectedReadySource)) {
    lastDiagnostic_ = HelperDiagnosticCategory::MalformedMessage;
    state_ = HelperSessionState::Failed;
    return false;
  }

  std::vector<std::string> arguments;
  arguments.reserve(2 + config_.extraArgs.size());
  arguments.push_back("--session");
  if (config_.enableFrameTransport) {
    arguments.push_back("--session-frame-mode");
  }
  for (const std::string& extra : config_.extraArgs) {
    arguments.push_back(extra);
  }
  // Structured launch result: every failure has already conclusively
  // released or committed the child to the durable registry inside
  // platformLaunch (see LaunchResult) -- the durable-registry capacity and
  // the platform cleanup entry were both reserved/allocated before this
  // child ever existed, so commit there is infallible. There is no
  // session-retained "ambiguous" outcome left to adopt. The public
  // diagnostic stays generic regardless of which internal failure occurred;
  // the state becomes terminal and non-reusable either way.
  const LaunchResult launchResult = platformLaunch(
      *handles_, config_.executablePath, arguments,
      config_.enableFrameTransport, config_.launchTimeoutMs);
  if (launchFailed(launchResult)) {
    lastDiagnostic_ = HelperDiagnosticCategory::LaunchFailure;
    state_ = HelperSessionState::Failed;
    return false;
  }
  // Only reached on LaunchResult::Launched -- exec success was proven, so it
  // is now safe to begin the ready handshake.

  std::string line;
  if (!nextStdoutLine(
          line, config_.readyTimeoutMs,
          HelperDiagnosticCategory::ReadyTimeout)) {
    state_ = HelperSessionState::Failed;
    return false;
  }

  std::string reason;
  if (classifyHelperLine(line) != HelperLineType::Ready ||
      !parseHelperReadyLine(line, config_.expectedReadySource, reason)) {
    lastDiagnostic_ = HelperDiagnosticCategory::MalformedMessage;
    state_ = HelperSessionState::Failed;
    return false;
  }

  state_ = HelperSessionState::Ready;
  return true;
}

HelperTrackOutcome HelperProcessSession::track(long long frameTimestampMs) {
  return trackInternal(frameTimestampMs, nullptr);
}

HelperTrackOutcome HelperProcessSession::trackWithFrame(
    long long frameTimestampMs, const FramePixelView& frame) {
  if (!config_.enableFrameTransport) {
    // Programming-contract violation (caller must gate on the config it
    // supplied); fail closed without touching child state.
    return HelperTrackOutcome{};
  }
  return trackInternal(frameTimestampMs, &frame);
}

HelperTrackOutcome HelperProcessSession::trackInternal(
    long long frameTimestampMs, const FramePixelView* frame) {
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

  std::uint32_t expectedChecksum = 0;
  std::uint64_t expectedPayloadBytes = 0;
  if (frame != nullptr) {
    if (!writeFramePacket(
            requestId, frameTimestampMs, *frame, expectedChecksum,
            expectedPayloadBytes)) {
      // lastDiagnostic_ is already set by writeFramePacket. A frame write
      // failure fails the session immediately without waiting for a result.
      state_ = HelperSessionState::Failed;
      return outcome;
    }
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

  if (frame != nullptr) {
    ParsedFrameAck ack;
    if (!parseHelperFrameAck(line, ack, reason)) {
      lastDiagnostic_ = HelperDiagnosticCategory::MalformedMessage;
      state_ = HelperSessionState::Failed;
      return outcome;
    }
    if (ack.sequence != requestId ||
        ack.payloadBytes != expectedPayloadBytes ||
        ack.checksum != expectedChecksum) {
      lastDiagnostic_ = HelperDiagnosticCategory::FrameAckMismatch;
      state_ = HelperSessionState::Failed;
      return outcome;
    }
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
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
      // Test-only: model an OOM thrown by the graceful drain's string/buffer
      // work, strictly before any child-ownership resolution below, so the
      // destructor's emergency path is exercised. The child is still directly
      // owned and the prepared fallback intact at this point.
      if (g_forceNextGracefulStopThrow.exchange(false)) {
        throw std::bad_alloc();
      }
#endif
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
    // v0.13.0 (#534 final-ownership hardening): ownership is now ALWAYS
    // resolved by the time platformClose() runs below -- either the child's
    // OS resource is confirmed released here, or it is committed to the
    // durable registry (infallible: the fallback and its registry capacity
    // were both reserved/allocated before this child ever existed -- see
    // platformLaunch). There is no third, session-retained outcome.
    if (!exited) {
      const ChildCleanupOutcome outcome = platformForceTerminate(
          *handles_, kDefaultChildCleanupDeadlineMs);
      shutdownCategory = HelperDiagnosticCategory::ShutdownTimeout;
      if (!childOwnershipReleased(outcome)) {
        // Unresolved within the bound: commit the already-prepared durable
        // fallback so the child is never lost, even across this session's
        // destruction. No allocation, cannot fail.
        transferChildProcessToRegistry(
            *handles_, terminationConfirmedDelivered(outcome));
      }
    }

    // Stdio/frame descriptors are independent OS resources from the child
    // process itself; always safe to close regardless of the child's fate.
    platformClose(*handles_);

    // Closes Windows process/thread handles if still directly held (a no-op
    // if they were just committed to the registry, which nulled them), and
    // releases the fallback's registry reservation if it is still unused (a
    // no-op if it was just consumed by the commit above).
    platformReleaseChildProcess(*handles_);
    handles_->launched = false;

    // A clean graceful stop requires a strictly valid "stopped" line AND a
    // confirmed-released child (not merely committed). Anything else on a
    // session that reached Ready/Running is a generic incomplete-shutdown.
    if (enteredStopping) {
      if (validStopped && exited) {
        shutdownCategory = HelperDiagnosticCategory::None;
      } else if (shutdownCategory == HelperDiagnosticCategory::None) {
        shutdownCategory = HelperDiagnosticCategory::ShutdownTimeout;
      }
    }
  }

  shutdownDiagnostic_ =
      enteredStopping ? shutdownCategory : HelperDiagnosticCategory::None;

  cleaned_ = true;
  if (state_ != HelperSessionState::Failed) {
    state_ = HelperSessionState::Stopped;
  }
}

}  // namespace lvk::tracker
