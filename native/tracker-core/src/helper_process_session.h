#pragma once

#include "helper_message.h"
#include "helper_tracking_result.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace lvk::tracker {

// v0.13.0 reusable, opt-in, Native Core-owned helper session (#533), extended
// with an opt-in bounded private frame transport (#534).
//
// Owns a single synthetic helper child process, a bounded private control
// channel (parent->child stdin, child->parent stdout, child->parent stderr),
// and, only when HelperSessionConfig::enableFrameTransport is set, a second
// private anonymous pipe carrying exactly one bounded BGR24 frame packet per
// track() exchange (see helper_frame_packet.h for the packet format). It
// drives the existing lvk-synthetic-helper in its interactive "--session"
// mode: one bounded request/(frame)/result exchange per track()/
// trackWithFrame() call, mapped to a TrackingSample by the caller through the
// existing createTrackingSampleFromHelperResult boundary.
//
// #533's track() sends NO camera frame pixels and is completely unchanged
// when enableFrameTransport is false (the default). All helper stdout/stderr
// stay private to Native Core; only generic parent diagnostic categories are
// ever exposed. The session state is Native Core-internal and is never added
// to MotionFrame. This layer adds no socket, shared-memory, temp-file, or
// network behavior; the frame pipe is a second private anonymous pipe, not a
// named pipe, socket, or file.

// Native Core-internal session lifecycle. Never serialized into MotionFrame.
enum class HelperSessionState {
  NotStarted,
  Starting,
  Ready,
  Running,
  Stopping,
  Stopped,
  Failed,
};

// Generic, safe parent diagnostic categories. The raw child stdout/stderr are
// never surfaced; only these categories may be reported by the parent.
enum class HelperDiagnosticCategory {
  None,
  LaunchFailure,
  ReadyTimeout,
  MalformedMessage,
  ResultTimeout,
  ChildExit,
  ShutdownTimeout,
  // v0.13.0 (#534): frame-transport-specific failures. Both fail the session
  // closed exactly like the existing categories above; no raw frame bytes are
  // ever included in any diagnostic.
  FrameWriteTimeout,
  FrameAckMismatch,
};

const char* helperDiagnosticCategoryLabel(HelperDiagnosticCategory category);

// Opaque per-platform process/pipe handles, defined in helper_process_session.cpp.
struct HelperSessionHandles;

// v0.13.0 (#534): OpenCV-independent raw BGR24 pixel view supplied by a
// caller after normalization (see normalizeBgr24Rows in
// helper_frame_packet.h). Always tightly packed: the outgoing packet's row
// stride is implicitly width*3. This header never includes OpenCV and never
// touches cv::Mat -- HelperProcessSession only ever sees this raw view.
struct FramePixelView {
  const std::uint8_t* data = nullptr;
  std::uint32_t width = 0;
  std::uint32_t height = 0;
};

struct HelperSessionConfig {
  std::string executablePath;
  // Extra helper arguments appended after "--session" (and after
  // "--session-frame-mode" when enableFrameTransport is set). Empty in normal
  // use; a development-only pass-through used to exercise the synthetic
  // helper's deterministic session fault modes in automated tests. No camera
  // frame data is ever passed here.
  std::vector<std::string> extraArgs;
  // v0.13.0 (#556): the exact ready source start() requires from the child's
  // "ready" line. Defaults to the existing synthetic route so every current
  // caller is unchanged. Must be one of the two approved identities in
  // helper_message.h; start() validates this before launching the child and
  // fails closed (Failed / MalformedMessage, no launch) if it is not.
  std::string expectedReadySource = kSyntheticHelperReadySource;
  // Bounded waits. Kept small so failures surface quickly and deterministically
  // without ever blocking Native Core's frame loop indefinitely.
  int readyTimeoutMs = 2000;
  int resultTimeoutMs = 2000;
  int stopTimeoutMs = 1000;
  // v0.13.0 (#534): opt-in bounded private frame transport. Off by default so
  // #533 result-only sessions are byte-for-byte unchanged. When true, start()
  // additionally establishes a private parent->child frame pipe and passes
  // "--session-frame-mode" to the helper; trackWithFrame() becomes usable.
  bool enableFrameTransport = false;
  // Bounded deadline for one frame packet write (header + payload together,
  // one ceiling). Distinct from resultTimeoutMs because a large payload write
  // is a different bound than waiting for the (always small) result line.
  int frameTimeoutMs = 2000;
  // Bounded deadline used, on Windows only, to confirm that a cancelled
  // frame write has actually completed: both the child-process-exit
  // confirmation inside force-termination and the writer thread's own
  // post-cancellation completion check use this value. Ignored on POSIX
  // (there is no writer thread or cancellation stage there -- a single
  // non-blocking, poll-bounded write already covers the whole deadline via
  // frameTimeoutMs). Exists as a genuine operational parameter, but also
  // lets tests deterministically drive the bounded-cancellation-exhausted
  // path by supplying an artificially small value; production callers
  // should leave this at the default.
  int frameCancelTimeoutMs = 2000;
  // Bounded deadline for the POSIX launch exec-status read: the parent waits
  // at most this long (via poll) to learn whether the forked child exec'd
  // successfully (clean EOF) or reported a setup/exec failure, before
  // treating the outcome as ambiguous and failing closed. Bounds launch so a
  // child that stalls before exec cannot hang start() indefinitely ahead of
  // readyTimeoutMs. Ignored on Windows (CreateProcess reports launch
  // synchronously).
  int launchTimeoutMs = 2000;
};

struct HelperTrackOutcome {
  bool ok = false;                // false -> caller must emit safe lost tracking
  HelperTrackingResult result;    // valid only when ok == true
};

class HelperProcessSession {
 public:
  explicit HelperProcessSession(HelperSessionConfig config);
  ~HelperProcessSession();

  HelperProcessSession(const HelperProcessSession&) = delete;
  HelperProcessSession& operator=(const HelperProcessSession&) = delete;

  // Launches the child and performs the bounded ready handshake. Returns true
  // only on a clean ready boundary; on any launch/ready failure it transitions
  // to Failed, records a diagnostic category, and returns false (the caller
  // should fail before opening the camera). Safe to call once.
  bool start();

  // Runs one bounded request/result exchange with NO frame packet. If the
  // session is already Failed or Stopped it returns a not-ok outcome
  // immediately without waiting. On any write/timeout/exit/malformed/stale-
  // correlation failure it transitions to Failed and returns a not-ok outcome
  // (caller emits safe lost tracking). Behavior is unchanged from #533.
  HelperTrackOutcome track(long long frameTimestampMs);

  // v0.13.0 (#534): runs one bounded request/frame/result exchange. Only
  // valid when the session was constructed with enableFrameTransport = true;
  // otherwise returns a not-ok outcome immediately without touching the
  // child. Writes exactly one frame packet (see helper_frame_packet.h) whose
  // transport sequence equals the outstanding requestId, then requires and
  // cross-validates a frameAck in the result envelope (sequence, payload
  // length, and an FNV-1a32 checksum computed by Native Core before sending).
  // Any write/timeout/mismatch failure transitions the session to Failed and
  // returns a not-ok outcome without ever retrying or reusing stale tracking.
  HelperTrackOutcome trackWithFrame(
      long long frameTimestampMs, const FramePixelView& frame);

  // Requests a graceful stop, waits a bounded time, then force-terminates if the
  // child has not exited. Idempotent and safe to call in any state.
  void stop();

  HelperSessionState state() const { return state_; }
  HelperDiagnosticCategory lastDiagnostic() const { return lastDiagnostic_; }

  // Set by stop() when a session that reached Ready/Running did not shut down
  // cleanly (no strictly-valid stopped line and/or the child did not exit within
  // the bounded wait). None means either a clean graceful stop or a session that
  // never became healthy. Only a generic category is exposed.
  HelperDiagnosticCategory shutdownDiagnostic() const {
    return shutdownDiagnostic_;
  }

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  // Test-only observability for the POSIX pid this session currently directly
  // owns (before any transfer to the durable registry), or -1 if none (either
  // never launched, already resolved, or already transferred -- including on
  // Windows, which owns a process/thread HANDLE pair rather than a pid, so
  // this always returns -1 there; see testOnlyDirectlyOwnsChild() for the
  // cross-platform equivalent). Compiled out of production; never part of the
  // public runtime API.
  long long testOnlyRetainedChildPid() const;
  // True while this session directly owns a live child (POSIX pid >= 0 /
  // Windows process HANDLE != nullptr) that has not yet been either
  // confirmed-released or committed to the durable registry. Cross-platform;
  // exposes no raw pid/HANDLE value.
  bool testOnlyDirectlyOwnsChild() const;
  // True while this session holds its own pre-launch-prepared child-cleanup
  // fallback (registry capacity reserved and a platform cleanup entry
  // allocated before the child was ever created -- see platformLaunch),
  // whether or not it has since adopted a real pid/HANDLE pair. False once
  // the fallback has been released (confirmed clean shutdown) or committed
  // (unresolved shutdown).
  bool testOnlyHasPreparedChildFallback() const;
  // Test-only: runs the destructor's bounded, noexcept emergency
  // ownership-resolution path directly (the exact path ~HelperProcessSession()
  // takes when stop() throws), so its correctness AND idempotence can be
  // asserted deterministically without provoking a real throw. Exposes no raw
  // pid/HANDLE value; compiled out of production.
  void testOnlyRunEmergencyResolveChildOwnership();
#endif

 private:
  // Structured outcome of the bounded graceful-stop drain.
  enum class ShutdownOutcome {
    StoppedCleanly,  // a strictly valid "stopped" line was observed
    Malformed,       // malformed/oversized lifecycle line or unsafe stderr
    ChildExit,       // stdout EOF before any valid "stopped" line
    Timeout,         // bounded drain elapsed without a valid "stopped" line
  };

  bool nextStdoutLine(
      std::string& lineOut,
      int timeoutMs,
      HelperDiagnosticCategory timeoutCategory);
  bool drainStderr();
  ShutdownOutcome drainUntilStopped(int timeoutMs);
  bool writeControlLine(const std::string& line);
  // v0.13.0 (#534): shared request/(frame)/result exchange. `frame` is null
  // for the #533 result-only path (track()) and non-null for trackWithFrame().
  HelperTrackOutcome trackInternal(
      long long frameTimestampMs, const FramePixelView* frame);
  // v0.13.0 (#534 allocation-free final cleanup): the minimal, bounded,
  // noexcept, allocation-free child-ownership resolution the destructor runs
  // when stop() throws before resolving ownership. Performs NO graceful
  // protocol and no parsing: closes local pipe endpoints, makes one bounded
  // force-terminate/reap attempt, then either releases the confirmed-dead
  // child or commits the already-prepared durable fallback (no allocation --
  // the entry, registry capacity, and POSIX pid-claim node were all reserved
  // pre-launch). Idempotent and safe after any partial progress inside stop(),
  // after an already-released child, and after an already-committed child.
  void emergencyResolveChildOwnership() noexcept;
  // Encodes and writes exactly one bounded frame packet whose transport
  // sequence is `sequence`. Returns false on any timeout/write failure
  // (session is left for the caller to transition to Failed). On success,
  // `checksumOut` holds the FNV-1a32 checksum of the exact payload bytes
  // sent, for later cross-validation against the helper's frameAck.
  bool writeFramePacket(
      std::uint64_t sequence,
      long long frameTimestampMs,
      const FramePixelView& frame,
      std::uint32_t& checksumOut,
      std::uint64_t& payloadBytesOut);

  HelperSessionConfig config_;
  std::unique_ptr<HelperSessionHandles> handles_;
  HelperSessionState state_ = HelperSessionState::NotStarted;
  HelperDiagnosticCategory lastDiagnostic_ = HelperDiagnosticCategory::None;
  HelperDiagnosticCategory shutdownDiagnostic_ = HelperDiagnosticCategory::None;
  std::string stdoutBuffer_;
  std::string stderrBuffer_;
  bool stdoutEof_ = false;
  bool stderrEof_ = false;
  bool cleaned_ = false;
  // Durability for an unresolved child lives in the process-local
  // HelperProcessCleanupRegistry: on a reap/terminate timeout, stop()
  // commits the child (POSIX pid / Windows process+thread handles) to that
  // registry, which outlives this session and eventually releases it. The
  // commit is infallible -- the durable-registry capacity and the platform
  // cleanup entry were both reserved/allocated before this session's child
  // was ever created (see platformLaunch) -- so there is no allocation-
  // failure corner left at shutdown/destruction time requiring a retry flag.
  std::uint64_t nextRequestId_ = 0;
  unsigned long long stderrDiagnosticCount_ = 0;  // count only; no raw history
};

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
// Native Core-internal, test-target-only lifecycle fault injection. These
// symbols are declared and defined ONLY when LVK_HELPER_LIFECYCLE_TEST_SEAM
// is defined, which the build sets solely on the frame-transport smoke
// target -- never on lvk-tracker-core -- so production binaries contain no
// fault-injection surface. They inject only local process/thread/exec
// lifecycle syscall outcomes; they never touch the packet protocol,
// MotionFrame, or any public API, and expose no handle/pid/errno/path.
namespace test_seam {

// Force the Windows frame-write cancellation sequence to skip its real
// CancelSynchronousIo + child termination and take the "transfer the writer
// to the durable registry" branch deterministically (the writer is left
// genuinely blocked; the caller's later stop() performs the real
// termination that finally unblocks it). No-op on POSIX (no writer thread).
void setForceFrameWriteUnresolvedTransfer(bool enabled);

// Force the next bounded child termination (POSIX kill+reap / Windows
// terminate+wait) to report a timeout WITHOUT actually reaping/closing, so
// the durable-ownership transfer path runs deterministically. The kill /
// TerminateProcess request is still issued, so the child does die and the
// registry entry can later reap/close it. One-shot: consumed by the next
// termination attempt.
void setForceNextChildCleanupTimeout(bool enabled);

// Force the classification of the next POSIX launch's exec-status read.
// One-shot. No-op on Windows.
enum class ExecStatusInjection { None, Timeout, PartialEof, HardError };
void setNextExecStatusInjection(ExecStatusInjection injection);

// Directly exercise the POSIX pid-ownership dedup guard (the same
// ownedPidSet() uniqueness PidCleanup::activateClaim relies on for exact-once
// waitpid ownership; worker-independent, so a duplicate-rejection test is
// deterministic). claim returns false if the pid is already owned. No-op stubs
// on Windows (claim always returns true).
bool claimPidOwnershipForTest(long long pid);
void releasePidOwnershipForTest(long long pid);

// v0.13.0 (#534 allocation-free final cleanup): force the next POSIX
// PidCleanup::prepareClaim() (the pre-fork pid-claim node preallocation) to
// fail, so start() failing closed strictly BEFORE child creation -- with no
// child, no retained pid, no pending registry entry, and no outstanding
// child-fallback reservation -- can be asserted deterministically. One-shot;
// consumed by the next launch's prepareClaim(). No-op on Windows (no pid
// claim there).
void setForceNextPidClaimPreparationFailure(bool enabled);

// v0.13.0 (#534 allocation-free final cleanup): force the graceful part of the
// next stop() to throw (modelling an OOM from its string/buffer work) before
// child ownership is resolved, so ~HelperProcessSession()'s separate bounded,
// noexcept emergency ownership-resolution path can be exercised
// deterministically. One-shot; consumed by the next stop(). Cross-platform.
void setForceNextGracefulStopThrow(bool enabled);

// v0.13.0 (#534 pid-reuse serialization): exercises the POSIX claim-aware reap
// transition entirely on stack-local durable-owner entries over a fake pid
// (never a real child), proving that confirmed reap/ECHILD removes a pid claim
// atomically with respect to new claim activation -- so a reused numeric pid is
// never attributed to a stale owner. Returns true iff every step of the
// activate -> duplicate-reject -> claim-aware-reap -> reactivate-same-pid ->
// idempotent-resolve sequence holds and the process-wide claim set returns to
// baseline. Models pid reuse WITHOUT relying on OS timing; touches no real
// child, registry entry, or reservation. Always returns true on Windows (no
// pid claim there). Exposes no raw pid value; compiled out of production.
bool exercisePidClaimReuseForTest(long long pidValue);

// v0.13.0 (#534 final-ownership hardening): count of Windows child
// process/thread HANDLE pairs currently adopted by a durable
// ProcessHandleCleanup registry entry (i.e. committed via
// transferChildProcessToRegistry and not yet resolved): incremented the
// instant adopt() is called (noexcept, right after a successful commit),
// decremented at the exact point both handles are finally closed (a
// confirmed poll(), or the destructor at process teardown). Always 0 on
// POSIX (no such entry exists there; use testOnlyRetainedChildPid()/exact
// waitpid ECHILD evidence instead).
long long durableChildProcessHandleCountForTest();

// v0.13.0 (#534 hardening; repaired further): force the Windows frame-
// writer's pre-thread setup (registry reservation -> DuplicateHandle ->
// FrameWriteOperationState alloc -> packet-buffer alloc -> durable
// ThreadOwnedWriterCleanup entry alloc -> writer-thread start) to throw
// immediately before the named boundary, so platformWriteFrame's exception-
// safe rollback path can be exercised deterministically. Every one of these
// allocations happens BEFORE the writer thread is started, so injecting a
// failure at any stage -- including DurableEntryAllocation -- always means
// no writer thread was ever started; there is no post-start allocation
// failure mode left to exercise. One-shot: consumed the next time the
// matching boundary is reached, then reset to None. No-op on POSIX (there is
// no writer thread or throwing setup step there).
enum class FrameWriterSetupFailure {
  None,
  StateAllocation,
  BufferAllocation,
  DurableEntryAllocation,
  ThreadConstruction,
};
void setNextFrameWriterSetupFailure(FrameWriterSetupFailure stage);

// Count of the Windows frame-writer's duplicated pipe HANDLE
// (platformWriteFrame's ownHandle) currently open: incremented immediately
// after a successful DuplicateHandle, decremented at the exact point it is
// closed (either the pre-thread rollback guard on a setup failure, or the
// writer thread's own close on every post-thread-construction exit path).
// Always 0 on POSIX (no such handle exists there).
long long frameWriterDuplicatedHandleCountForTest();

// Count of writer thread HANDLEs currently adopted by a durable
// ThreadOwnedWriterCleanup entry (see platformWriteFrame): incremented the
// instant a just-started writer thread's HANDLE is adopted (noexcept, right
// after a successful thread start), decremented at the exact point it is
// released (a confirmed poll(), or the destructor at process teardown).
// Always 0 on POSIX (no such entry exists there).
long long durableWriterThreadHandleCountForTest();

// v0.13.0 (#534 repaired further): overrides ONLY the single bounded wait
// inside ThreadOwnedWriterCleanup's destructor (the process-teardown-only
// last resort -- never reached from platformWriteFrame's own return path)
// with a deterministic unconfirmed outcome, so its "otherwise" branch (no
// join, no second wait, HANDLE closed exactly once, entry-owned references
// released) can be exercised without a real timing race or ever leaving a
// genuinely-blocked thread running past a test. Never hooks
// WaitForSingleObject globally: only that one destructor call site consults
// it. One-shot: consumed the next time that exact wait completes, then reset
// to false. No-op on POSIX.
void setForceNextWriterTeardownWaitUnconfirmed(bool enabled);

// Test-only harness that exercises ThreadOwnedWriterCleanup's destructor in
// isolation from platformWriteFrame and the durable registry (whose own
// destructor only ever runs at real process exit, which a live test cannot
// safely trigger): constructs an entry exactly as platformWriteFrame does,
// starts a trivial, immediately-self-terminating writer thread, adopts its
// HANDLE, waits (a real, bounded wait) for it to actually finish so nothing
// is ever left running past this call, then destroys the entry -- honoring
// whatever setForceNextWriterTeardownWaitUnconfirmed was armed with. Returns
// true iff the probe thread started and the entry's HANDLE-owning count
// round-tripped back to its pre-call baseline. No-op (returns true
// trivially) on POSIX.
bool exerciseWriterTeardownForTest();

}  // namespace test_seam
#endif

}  // namespace lvk::tracker
