// Bounded frame transport smoke (v0.13.0, #534).
//
// Pure, no-OpenCV executable that drives HelperProcessSession's private
// frame-transport machinery directly against lvk-synthetic-helper
// (--session --session-frame-mode), using in-process synthetic BGR24
// buffers -- including a deliberately non-contiguous strided view
// normalized through the exact same normalizeBgr24Rows function the OpenCV
// backend uses. No OpenCV, no camera, no webcam; deterministic and CI-safe.
// This exists specifically because native-ci.yml never installs OpenCV, so
// the real synthetic-frame-helper runtime backend cannot be exercised
// end-to-end there; this smoke proves the transport itself instead, by
// talking to HelperProcessSession directly.
//
// HelperProcessSession's public API is meant to be driven from a single
// calling thread (its internal Windows writer thread is always joined, or
// provably exited, before a call returns); every test here is therefore
// single-threaded and sequential, never calling the session concurrently
// from two threads.

#include "helper_frame_packet.h"
#include "helper_message.h"
#include "helper_process_cleanup_registry.h"
#include "helper_process_session.h"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#ifndef _WIN32
#include <cerrno>
#include <sys/types.h>
#include <sys/wait.h>
#endif

namespace {

int gFailures = 0;

void expect(bool condition, const std::string& what) {
  if (!condition) {
    ++gFailures;
    std::cerr << "[helper-frame-transport-smoke] FAILED: " << what << "\n";
  }
}

using lvk::tracker::FramePixelView;
using lvk::tracker::HelperDiagnosticCategory;
using lvk::tracker::HelperInvocationMode;
using lvk::tracker::HelperProcessCleanupRegistry;
using lvk::tracker::HelperProcessSession;
using lvk::tracker::HelperSessionConfig;
using lvk::tracker::HelperSessionState;
using lvk::tracker::HelperTrackOutcome;
namespace test_seam = lvk::tracker::test_seam;

// Durable-registry observability helpers (deterministic because the smoke
// disables the registry's background worker at startup; entries resolve only
// via explicit pump() calls here).
std::size_t registryCount() {
  return HelperProcessCleanupRegistry::instance().pendingCount();
}

// Pumps the registry until it drains or the bounded deadline elapses,
// returning the final pending count. A WriterCleanup resolves only after its
// writer thread has actually exited (which the driving test triggers by
// terminating the child), so a short poll loop is used rather than assuming
// instantaneous resolution; a PidCleanup resolves on the first pump once its
// SIGKILL'd child is reapable.
std::size_t pumpUntilEmptyOrDeadline(int deadlineMs) {
  auto& registry = HelperProcessCleanupRegistry::instance();
  const auto start = std::chrono::steady_clock::now();
  std::size_t remaining = registry.pump();
  while (remaining > 0) {
    const auto elapsed =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - start)
            .count();
    if (elapsed >= deadlineMs) {
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
    remaining = registry.pump();
  }
  return remaining;
}

std::vector<std::uint8_t> makeDeterministicBgr24(
    std::uint32_t width, std::uint32_t height) {
  std::vector<std::uint8_t> buffer(
      static_cast<std::size_t>(width) * height * 3);
  for (std::size_t index = 0; index < buffer.size(); ++index) {
    buffer[index] = static_cast<std::uint8_t>((index * 37 + 13) % 256);
  }
  return buffer;
}

HelperSessionConfig baseConfig(const std::string& helperPath) {
  HelperSessionConfig config;
  config.executablePath = helperPath;
  config.enableFrameTransport = true;
  return config;
}

void testValidRoundTripAndAck(const std::string& helperPath) {
  HelperProcessSession session(baseConfig(helperPath));
  expect(session.start(), "valid round trip: session starts");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }

  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(4, 3);
  const FramePixelView view{frame.data(), 4, 3};
  const HelperTrackOutcome outcome = session.trackWithFrame(1000, view);
  expect(
      outcome.ok,
      "valid round trip: trackWithFrame succeeds (sequence/timestamp/"
      "payload/checksum acknowledgement all cross-validate)");
  expect(
      session.state() == HelperSessionState::Running,
      "valid round trip: session stays Running after a successful exchange");
  session.stop();
}

void testSequenceCorrelationOneFrameInFlight(const std::string& helperPath) {
  HelperProcessSession session(baseConfig(helperPath));
  expect(session.start(), "one-frame-in-flight: session starts");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }

  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(2, 2);
  const FramePixelView view{frame.data(), 2, 2};
  for (long long index = 0; index < 3; ++index) {
    const HelperTrackOutcome outcome =
        session.trackWithFrame(2000 + index, view);
    expect(
        outcome.ok,
        "one-frame-in-flight: sequential synchronous exchange " +
            std::to_string(index) +
            " succeeds (no queue, no second frame in flight)");
  }
  session.stop();
}

void testNonContiguousNormalization(const std::string& helperPath) {
  // A deliberately strided source (2 bytes of padding per row, sentinel
  // 0xEE) must normalize identically to a tightly-packed source through the
  // exact same normalizeBgr24Rows function the OpenCV backend uses, then
  // transport and ack successfully.
  const std::uint32_t width = 2;
  const std::uint32_t height = 2;
  const std::uint32_t srcStride = width * 3 + 2;
  std::vector<std::uint8_t> strided(
      static_cast<std::size_t>(srcStride) * height, 0xEE);
  for (std::uint32_t row = 0; row < height; ++row) {
    for (std::uint32_t col = 0; col < width * 3; ++col) {
      strided[row * srcStride + col] =
          static_cast<std::uint8_t>((row * 10 + col) % 256);
    }
  }

  std::vector<std::uint8_t> normalized;
  const lvk::tracker::FrameNormalizeStatus status =
      lvk::tracker::normalizeBgr24Rows(
          strided.data(), width, height, srcStride, normalized);
  expect(
      status == lvk::tracker::FrameNormalizeStatus::Ok,
      "non-contiguous normalization: strided source normalizes Ok");
  expect(
      normalized.size() == static_cast<std::size_t>(width) * height * 3,
      "non-contiguous normalization: output is tightly packed (padding "
      "stripped)");

  HelperProcessSession session(baseConfig(helperPath));
  expect(session.start(), "non-contiguous normalization: session starts");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const FramePixelView view{normalized.data(), width, height};
  const HelperTrackOutcome outcome = session.trackWithFrame(3000, view);
  expect(
      outcome.ok,
      "non-contiguous normalization: normalized payload transports and "
      "acks successfully");
  session.stop();
}

void testHelperExitDuringTransfer(const std::string& helperPath) {
  HelperSessionConfig config = baseConfig(helperPath);
  config.extraArgs = {"--session-frame-exit-during-transfer"};
  HelperProcessSession session(config);
  expect(session.start(), "helper-exit-during-transfer: session starts");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(2, 2);
  const FramePixelView view{frame.data(), 2, 2};
  const HelperTrackOutcome outcome = session.trackWithFrame(4000, view);
  expect(
      !outcome.ok,
      "helper-exit-during-transfer: outcome is not-ok (safe lost tracking)");
  expect(
      session.state() == HelperSessionState::Failed,
      "helper-exit-during-transfer: session transitions to Failed");
  session.stop();
}

// Covers both "helper ignores frame pipe causing bounded parent timeout"
// and "shutdown unblocks pending transfer": the helper never reads a large
// (> typical OS pipe buffer) payload, so the write genuinely blocks and must
// be cancelled within frameTimeoutMs (exercising the Windows
// CancelSynchronousIo + force-terminate sequence / the POSIX poll deadline),
// and the immediately following stop() call must also complete within a
// generous bound rather than hang because a transfer had been pending.
void testHelperIgnoresFramePipeParentTimeoutAndShutdownUnblocks(
    const std::string& helperPath) {
  HelperSessionConfig config = baseConfig(helperPath);
  config.extraArgs = {"--session-frame-ignore"};
  config.frameTimeoutMs = 300;  // keep the smoke fast
  config.stopTimeoutMs = 1000;
  HelperProcessSession session(config);
  expect(session.start(), "helper-ignores-frame-pipe: session starts");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }

  // Large enough to exceed the OS anonymous pipe buffer (commonly 64 KiB)
  // so a helper that never reads genuinely blocks the write, rather than
  // completing instantly into a buffer.
  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(256, 300);
  const FramePixelView view{frame.data(), 256, 300};

  const auto trackStartedAt = std::chrono::steady_clock::now();
  const HelperTrackOutcome outcome = session.trackWithFrame(5000, view);
  const auto trackElapsedMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - trackStartedAt)
          .count();

  expect(
      !outcome.ok,
      "helper-ignores-frame-pipe: outcome is not-ok (parent write timeout)");
  expect(
      session.state() == HelperSessionState::Failed,
      "helper-ignores-frame-pipe: session transitions to Failed");
  expect(
      session.lastDiagnostic() == HelperDiagnosticCategory::FrameWriteTimeout,
      "helper-ignores-frame-pipe: diagnostic is FrameWriteTimeout");
  expect(
      trackElapsedMs < 10000,
      "helper-ignores-frame-pipe: trackWithFrame returns within a generous "
      "ceiling (no unbounded hang)");

  const auto stopStartedAt = std::chrono::steady_clock::now();
  session.stop();
  const auto stopElapsedMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - stopStartedAt)
          .count();
  expect(
      stopElapsedMs < 10000,
      "shutdown-unblocks-pending-transfer: stop() after a timed-out pending "
      "transfer still completes within a generous ceiling");
}

#ifdef _WIN32
// A successful frame write completes in the first wait: no durable writer
// operation is ever created, so the registry stays empty.
void testWindowsNormalCompletionLeavesRegistryEmpty(
    const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "win normal-completion: registry drained before test");
  HelperProcessSession session(baseConfig(helperPath));
  expect(session.start(), "win normal-completion: session starts");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(4, 3);
  const FramePixelView view{frame.data(), 4, 3};
  const HelperTrackOutcome outcome = session.trackWithFrame(20000, view);
  expect(outcome.ok, "win normal-completion: small write completes");
  expect(registryCount() == 0,
         "win normal-completion: no durable operation created "
         "(registry stays empty)");
  session.stop();
  expect(registryCount() == 0,
         "win normal-completion: registry empty after clean stop");
}

// Test B -- unconfirmed recovery commits the already-prepared durable owner.
//
// Deterministically drives platformWriteFrame's unconfirmed-completion
// branch via a test seam that skips cancellation + child termination,
// leaving the writer genuinely blocked so the write can never resolve
// synchronously. Because the durable ThreadOwnedWriterCleanup entry is now
// fully prepared BEFORE the writer thread ever starts (see
// platformWriteFrame), committing it here requires no allocation and no
// HANDLE duplication -- there is no unsafe wait-then-blind-join path left to
// exercise; this proves the commit happens promptly instead. Verifies: (a)
// trackWithFrame() returns within a bounded ceiling with a not-ok/
// FrameWriteTimeout outcome; (b) the operation is durably owned by the
// registry (count == 1) rather than a bare detached/joinable thread; (c)
// exactly one durable writer thread HANDLE is adopted; (d) a different
// session's frame write is rejected at the process-wide unresolved-operation
// bound while it is pending; (e) the operation survives the owning session's
// destruction; (f) it is finally released (thread HANDLE, duplicated pipe
// HANDLE, and packet buffer) so all counts return to 0 and the reservation
// becomes available; (g) a fresh session then writes normally.
void testWindowsWriterTransferBoundReleaseAndDestruction(
    const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "win transfer: registry drained before test");
  expect(test_seam::durableWriterThreadHandleCountForTest() == 0,
         "win transfer: durable writer thread count is 0 before test");
  expect(test_seam::frameWriterDuplicatedHandleCountForTest() == 0,
         "win transfer: duplicated writer pipe HANDLE count is 0 before "
         "test");

  {
    HelperSessionConfig config = baseConfig(helperPath);
    config.extraArgs = {"--session-frame-ignore"};
    config.frameTimeoutMs = 50;  // first wait times out fast
    HelperProcessSession session(config);
    expect(session.start(), "win transfer: session starts");
    if (session.state() != HelperSessionState::Ready) {
      return;
    }

    // Large enough to exceed the OS anonymous pipe buffer so the write
    // genuinely blocks against a helper that never reads.
    const std::vector<std::uint8_t> frame = makeDeterministicBgr24(256, 300);
    const FramePixelView view{frame.data(), 256, 300};

    const auto writeStartedAt = std::chrono::steady_clock::now();
    test_seam::setForceFrameWriteUnresolvedTransfer(true);
    const HelperTrackOutcome outcome = session.trackWithFrame(21000, view);
    test_seam::setForceFrameWriteUnresolvedTransfer(false);
    const auto writeElapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - writeStartedAt)
            .count();

    expect(!outcome.ok, "win transfer: forced-unresolved write is not-ok");
    expect(
        session.lastDiagnostic() == HelperDiagnosticCategory::FrameWriteTimeout,
        "win transfer: diagnostic is FrameWriteTimeout");
    expect(writeElapsedMs < 10000,
           "win transfer: trackWithFrame returns within a bounded ceiling "
           "even though the writer is genuinely still blocked (no join was "
           "attempted -- the already-prepared entry was committed instead)");
    expect(registryCount() == 1,
           "win transfer: the unresolved writer operation is durably owned by "
           "the registry (count == 1), not a bare detached thread");
    expect(test_seam::durableWriterThreadHandleCountForTest() == 1,
           "win transfer: exactly one durable writer thread HANDLE is "
           "adopted by the registry entry");

    // Process-wide bound: a DIFFERENT session's frame write is rejected while
    // the operation is pending (the writer is still blocked; poll cannot
    // resolve it until the child is terminated, so the count stays 1).
    {
      HelperProcessSession otherSession(baseConfig(helperPath));
      expect(otherSession.start(), "win transfer: second session starts");
      if (otherSession.state() == HelperSessionState::Ready) {
        const std::vector<std::uint8_t> f2 = makeDeterministicBgr24(2, 2);
        const FramePixelView v2{f2.data(), 2, 2};
        const HelperTrackOutcome o2 = otherSession.trackWithFrame(21500, v2);
        expect(!o2.ok,
               "win transfer: a second session's frame write is rejected at "
               "the process-wide unresolved-operation bound");
      }
      otherSession.stop();
    }
    expect(registryCount() == 1,
           "win transfer: the pending writer is still owned after the bound "
           "rejection (a rejected write starts no new operation)");

    // Leaving this scope destroys the owning session: its destructor stop()
    // terminates the child, which unblocks the writer. The registry -- not
    // the session -- owns the operation, so it is not discarded.
  }

  // The durable operation is still owned by the registry after session
  // destruction; drive its resolution and confirm full release.
  const std::size_t remaining = pumpUntilEmptyOrDeadline(5000);
  expect(remaining == 0,
         "win transfer: after the owning session is destroyed, the registry "
         "finally releases the writer (thread HANDLE, duplicated pipe "
         "HANDLE, and packet buffer) -- count returns to 0");
  expect(test_seam::durableWriterThreadHandleCountForTest() == 0,
         "win transfer: durable writer thread count returns to 0 (released "
         "exactly once)");
  expect(test_seam::frameWriterDuplicatedHandleCountForTest() == 0,
         "win transfer: duplicated writer pipe HANDLE count returns to 0");

  // The process-wide reservation is available again: a fresh session writes
  // normally.
  HelperProcessSession followUpSession(baseConfig(helperPath));
  expect(followUpSession.start(),
         "win transfer: a fresh session starts after full resolution");
  if (followUpSession.state() == HelperSessionState::Ready) {
    const std::vector<std::uint8_t> frame = makeDeterministicBgr24(2, 2);
    const FramePixelView view{frame.data(), 2, 2};
    const HelperTrackOutcome followUp =
        followUpSession.trackWithFrame(21800, view);
    expect(followUp.ok,
           "win transfer: a fresh session's frame write succeeds normally "
           "(the process-wide reservation was fully released)");
  }
  followUpSession.stop();
  expect(registryCount() == 0,
         "win transfer: registry stays empty after the follow-up write "
         "completes normally (resolves synchronously in the first wait)");
}

// Test A -- pre-start durable-entry allocation failure. Injecting the new
// DurableEntryAllocation stage into testWindowsFrameWriterSetupFailureRollback
// below (which already asserts session-starts / not-ok / FrameWriteTimeout /
// prompt-return / registry-empty / duplicated-pipe-HANDLE-released /
// fresh-session-succeeds / one-shot) covers Test A in full: since durable-
// entry allocation now happens strictly BEFORE the writer thread starts, its
// failure is just another pre-thread setup failure with the exact same
// rollback contract as StateAllocation/BufferAllocation -- no writer thread
// ever starts, so no separate assertion helper is needed here.

// Test C -- teardown safety. Exercises ThreadOwnedWriterCleanup's destructor
// directly (via test_seam::exerciseWriterTeardownForTest(), which starts and
// waits out a trivial, immediately-self-terminating probe thread -- never a
// genuinely blocked one -- before destroying the entry under an injected
// unconfirmed teardown wait). Proves: (a) the harness itself never leaves a
// thread running past its own call (it real-waits for the probe to finish
// first); (b) the destructor's bounded teardown wait, when forced
// unconfirmed, still resolves promptly (no hang, no second wait, no join --
// there is no std::thread anywhere in this design to join or detach); (c)
// the entry-owned thread HANDLE count round-trips from 0 -> 1 (adopted) -> 0
// (released exactly once); (d) the one-shot seam is consumed, not left
// armed; (e) normal frame-write behavior is unaffected afterward.
void testWindowsWriterTeardownSafety(const std::string& helperPath) {
  expect(test_seam::durableWriterThreadHandleCountForTest() == 0,
         "win teardown: durable writer thread count is 0 before test");

  const auto probeStartedAt = std::chrono::steady_clock::now();
  const bool probeOk = test_seam::exerciseWriterTeardownForTest();
  const auto probeElapsedMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - probeStartedAt)
          .count();

  expect(probeOk,
         "win teardown: the probe thread started and its adopted HANDLE "
         "count round-tripped 0 -> 1 -> 0 across the forced-unconfirmed "
         "teardown destructor -- no double-close, no leak");
  expect(probeElapsedMs < 5000,
         "win teardown: the forced-unconfirmed teardown destructor resolves "
         "within a bounded ceiling (its single bounded wait, plus the "
         "harness's own real wait for the trivial probe thread, never "
         "hangs)");
  expect(test_seam::durableWriterThreadHandleCountForTest() == 0,
         "win teardown: durable writer thread count returns to 0 after the "
         "probe (seam and counters return to baseline, not left armed)");

  // Teardown-path testing must not disturb ordinary frame-write behavior: a
  // real session's normal write still succeeds and stays fully synchronous.
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "win teardown: registry drained before follow-up write");
  HelperProcessSession session(baseConfig(helperPath));
  expect(session.start(), "win teardown: follow-up session starts");
  if (session.state() == HelperSessionState::Ready) {
    const std::vector<std::uint8_t> frame = makeDeterministicBgr24(2, 2);
    const FramePixelView view{frame.data(), 2, 2};
    const HelperTrackOutcome outcome = session.trackWithFrame(22000, view);
    expect(outcome.ok,
           "win teardown: a normal frame write still succeeds after "
           "exercising the teardown path in isolation");
    expect(registryCount() == 0,
           "win teardown: registry stays empty after a normal write "
           "(resolves synchronously in the first wait)");
  }
  session.stop();
}
#else   // POSIX
// Exec-status classification is bounded: an ambiguous exec status (injected
// deterministically for timeout / partial / hard-error) fails start() closed
// and conclusively releases the child, leaving the registry empty.
void testPosixExecStatusInjectionFailsClosed(const std::string& helperPath) {
  using test_seam::ExecStatusInjection;
  const ExecStatusInjection cases[] = {
      ExecStatusInjection::Timeout,
      ExecStatusInjection::PartialEof,
      ExecStatusInjection::HardError,
  };
  const char* labels[] = {"timeout", "partial-eof", "hard-error"};
  for (int i = 0; i < 3; ++i) {
    expect(pumpUntilEmptyOrDeadline(2000) == 0,
           std::string("posix exec-status ") + labels[i] +
               ": registry drained before case");
    test_seam::setNextExecStatusInjection(cases[i]);
    HelperProcessSession session(baseConfig(helperPath));
    const bool started = session.start();
    expect(!started, std::string("posix exec-status ") + labels[i] +
                         ": ambiguous exec status fails start() closed");
    expect(session.state() == HelperSessionState::Failed,
           std::string("posix exec-status ") + labels[i] +
               ": session is terminal Failed");
    expect(registryCount() == 0,
           std::string("posix exec-status ") + labels[i] +
               ": the child was conclusively released (registry empty)");
    session.stop();
  }
}

// A launch against a non-existent executable: the child reports the exec
// failure and is reaped immediately; start() fails closed, registry empty.
void testPosixChildReportedFailureImmediateReap(const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "posix child-reported-failure: registry drained before test");
  HelperSessionConfig config = baseConfig(helperPath);
  config.executablePath = helperPath + ".does-not-exist-lvk534";
  HelperProcessSession session(config);
  expect(!session.start(),
         "posix child-reported-failure: bad exec path fails start() closed");
  expect(session.state() == HelperSessionState::Failed,
         "posix child-reported-failure: session is terminal Failed");
  expect(registryCount() == 0,
         "posix child-reported-failure: child reaped immediately "
         "(registry empty)");
  session.stop();
}

// Launch failure whose bounded reap times out: the pid must be transferred
// to the durable registry (never lost in a local variable), then later
// reaped by a bounded registry pump.
void testPosixLaunchFailureCleanupTimeoutTransfer(
    const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "posix launch-timeout: registry drained before test");
  HelperSessionConfig config = baseConfig(helperPath);
  config.executablePath = helperPath + ".does-not-exist-lvk534";
  test_seam::setForceNextChildCleanupTimeout(true);
  HelperProcessSession session(config);
  expect(!session.start(),
         "posix launch-timeout: start() fails closed");
  expect(session.state() == HelperSessionState::Failed,
         "posix launch-timeout: session is terminal Failed");
  expect(registryCount() == 1,
         "posix launch-timeout: the unresolved launch-failure pid is "
         "transferred to the durable registry (count == 1), not lost locally");
  session.stop();
  expect(registryCount() == 1,
         "posix launch-timeout: stop() on a launch-failed session does not "
         "disturb the transferred pid");
  expect(pumpUntilEmptyOrDeadline(3000) == 0,
         "posix launch-timeout: a bounded registry pump reaps the pid "
         "(count returns to 0)");
}

// Duplicate pid ownership is rejected by the process-wide guard.
void testPosixDuplicatePidRejected() {
  const long long fakePid = 999999123;  // not a child of this process
  expect(test_seam::claimPidOwnershipForTest(fakePid),
         "posix dup-pid: first claim of a pid succeeds");
  expect(!test_seam::claimPidOwnershipForTest(fakePid),
         "posix dup-pid: a duplicate claim of the same pid is rejected");
  test_seam::releasePidOwnershipForTest(fakePid);
  expect(test_seam::claimPidOwnershipForTest(fakePid),
         "posix dup-pid: the pid can be claimed again after release");
  test_seam::releasePidOwnershipForTest(fakePid);
}

// #534 allocation-free final cleanup, POSIX Test 1 -- pid-claim preparation
// fails strictly before child creation. PidCleanup::prepareClaim() preallocates
// (pre-fork) the std::set node later reused to claim pid ownership WITHOUT a
// post-fork allocation. Forcing that preallocation to fail must move the whole
// launch failure ahead of fork(): no child, no retained pid, no pending entry,
// no outstanding child-fallback reservation. The prepared claim node is a
// member of the fallback entry, so the entry's absence proves no claim node
// (and no leaked sentinel) remains.
void testPosixPidClaimPreparationFailure(const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "posix-claim-prep: registry drained before test");
  test_seam::setForceNextPidClaimPreparationFailure(true);

  HelperProcessSession session(baseConfig(helperPath));
  expect(!session.start(), "posix-claim-prep: start() fails closed");
  expect(session.state() == HelperSessionState::Failed,
         "posix-claim-prep: state is Failed");
  expect(session.lastDiagnostic() == HelperDiagnosticCategory::LaunchFailure,
         "posix-claim-prep: diagnostic is LaunchFailure");
  expect(!session.testOnlyDirectlyOwnsChild(),
         "posix-claim-prep: no child was created (no direct ownership)");
  expect(session.testOnlyRetainedChildPid() < 0,
         "posix-claim-prep: no raw pid is retained");
  expect(!session.testOnlyHasPreparedChildFallback(),
         "posix-claim-prep: no prepared fallback (hence no prepared pid claim "
         "node) remains");
  expect(registryCount() == 0,
         "posix-claim-prep: registry pending count is 0");
  expect(HelperProcessCleanupRegistry::instance()
                 .childFallbackReservationCountForTest() == 0,
         "posix-claim-prep: no child-fallback reservation remains outstanding");
  session.stop();  // idempotent no-op on a never-launched session

  // One-shot: a fresh session starts and operates normally afterward.
  HelperProcessSession fresh(baseConfig(helperPath));
  expect(fresh.start(),
         "posix-claim-prep: a fresh session starts normally (seam is "
         "one-shot)");
  fresh.stop();
}

// #534 pid-reuse serialization -- confirmed reap/ECHILD removes a durable pid
// claim atomically with respect to new claim activation, so an OS-reused
// numeric pid is never attributed to a stale owner (nor does a stale claim make
// a new child's transfer drop its pid). Driven over a fake pid so no OS reuse
// timing is required and no real child is touched (see
// exercisePidClaimReuseForTest).
void testPosixPidClaimReuseSerialization() {
  const long long fakePid = 999999123;  // above pid_max: waitpid ECHILD, not a
                                        // child of this process
  expect(test_seam::exercisePidClaimReuseForTest(fakePid),
         "posix-pid-reuse: claim release and new activation serialize under one "
         "mutex (activate -> duplicate-reject -> claim-aware reap -> reuse same "
         "pid -> idempotent resolve; set returns to baseline, no stale owner, "
         "second owner, double erase, or node leak)");
}
#endif  // _WIN32

// #534 final-ownership hardening, Test A -- pre-launch fallback preparation
// failure. Forces the child-cleanup registry reservation to fail via the
// SAME seam used for the writer bound (setForceNextReserveFailureForTest()):
// since platformLaunch now reserves durable-registry capacity and allocates
// the platform cleanup entry as the very FIRST operation -- strictly before
// any pipe/fork()/CreateProcess activity on either platform -- forcing that
// reservation to fail proves the failure moves before child creation (no
// child is ever created to release or transfer).
void testChildFallbackPreLaunchPreparationFailure(
    const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "child-fallback-prelaunch: registry drained before test");
  HelperProcessCleanupRegistry::instance().setForceNextReserveFailureForTest();

  HelperProcessSession session(baseConfig(helperPath));
  expect(!session.start(),
         "child-fallback-prelaunch: start() fails closed");
  expect(session.state() == HelperSessionState::Failed,
         "child-fallback-prelaunch: state is Failed");
  expect(session.lastDiagnostic() == HelperDiagnosticCategory::LaunchFailure,
         "child-fallback-prelaunch: diagnostic is LaunchFailure");
  expect(!session.testOnlyDirectlyOwnsChild(),
         "child-fallback-prelaunch: no raw pid/HANDLE is retained (no child "
         "was ever created)");
  expect(!session.testOnlyHasPreparedChildFallback(),
         "child-fallback-prelaunch: no prepared child fallback remains");
  expect(registryCount() == 0,
         "child-fallback-prelaunch: registry pending count is 0");
  expect(HelperProcessCleanupRegistry::instance()
                 .childFallbackReservationCountForTest() == 0,
         "child-fallback-prelaunch: no reservation remains outstanding");
  session.stop();  // idempotent no-op on a never-launched session

  // The seam is one-shot: a fresh session starts and operates normally.
  HelperProcessSession fresh(baseConfig(helperPath));
  expect(fresh.start(),
         "child-fallback-prelaunch: a fresh session starts normally "
         "(the seam is one-shot)");
  if (fresh.state() == HelperSessionState::Ready) {
    const std::vector<std::uint8_t> frame = makeDeterministicBgr24(2, 2);
    const FramePixelView view{frame.data(), 2, 2};
    const HelperTrackOutcome outcome = fresh.trackWithFrame(1000, view);
    expect(outcome.ok,
           "child-fallback-prelaunch: the fresh session operates normally");
  }
  fresh.stop();
}

// #534 final-ownership hardening, Test B -- unresolved shutdown always
// transfers. A session whose bounded shutdown cleanup cannot confirm release
// must ALWAYS commit the child to the durable registry -- never retain it
// locally -- on either platform. The child-cleanup fallback (registry
// capacity + platform entry) was already fully prepared before this child
// ever existed (see platformLaunch), so the commit here is infallible: no
// allocation, no reservation growth, cannot fail on resource exhaustion.
void testChildUnresolvedShutdownAlwaysTransfers(const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "child-transfer: registry drained before test");
#ifdef _WIN32
  expect(test_seam::durableChildProcessHandleCountForTest() == 0,
         "child-transfer: durable child process HANDLE count is 0 before "
         "test");
#endif

#ifndef _WIN32
  long long capturedPid = -1;
#endif
  {
    HelperSessionConfig config = baseConfig(helperPath);
    config.extraArgs = {"--session-ignore-stop"};  // child ignores stop
    config.stopTimeoutMs = 300;
    HelperProcessSession session(config);
    expect(session.start(), "child-transfer: session starts");
    if (session.state() != HelperSessionState::Ready) {
      return;
    }
#ifndef _WIN32
    capturedPid = session.testOnlyRetainedChildPid();
    expect(capturedPid > 0,
           "child-transfer: the real pid is captured while the session "
           "still directly owns it, before transfer");
#endif
    expect(session.testOnlyDirectlyOwnsChild(),
           "child-transfer: the session directly owns the child before "
           "shutdown");

    test_seam::setForceNextChildCleanupTimeout(true);
    session.stop();

    expect(!session.testOnlyDirectlyOwnsChild(),
           "child-transfer: the session no longer directly owns the child "
           "after stop()");
    expect(registryCount() == 1,
           "child-transfer: exactly one durable registry entry owns the "
           "child");
    expect(session.shutdownDiagnostic() ==
               HelperDiagnosticCategory::ShutdownTimeout,
           "child-transfer: incomplete shutdown reported");
#ifdef _WIN32
    expect(test_seam::durableChildProcessHandleCountForTest() == 1,
           "child-transfer: the process/thread HANDLE pair transferred "
           "exactly once");
#endif
    // Leaving scope destroys the session; cleaned_ is already set, so the
    // destructor must not disturb the registry-owned child.
  }

  expect(registryCount() == 1,
         "child-transfer: the transferred child survives the session's "
         "destruction (not discarded)");
  expect(pumpUntilEmptyOrDeadline(3000) == 0,
         "child-transfer: a later bounded pump resolves it (count -> 0)");
#ifdef _WIN32
  expect(test_seam::durableChildProcessHandleCountForTest() == 0,
         "child-transfer: durable child process HANDLE count returns to 0");
#else
  errno = 0;
  int status = 0;
  const pid_t waited =
      waitpid(static_cast<pid_t>(capturedPid), &status, WNOHANG);
  expect(waited < 0 && errno == ECHILD,
         "child-transfer: the exact real child pid is no longer waitable by "
         "this process (ECHILD -- actually reaped, not merely marked "
         "resolved)");
#endif
  expect(HelperProcessCleanupRegistry::instance()
                 .childFallbackReservationCountForTest() == 0,
         "child-transfer: the reservation is available again after full "
         "resolution");

  // A fresh session can start and operate normally afterward.
  HelperProcessSession fresh(baseConfig(helperPath));
  expect(fresh.start(), "child-transfer: a fresh session starts normally");
  fresh.stop();
}

// #534 final-ownership hardening, Test C -- destructor final ownership.
// Drives the exact historical failure shape: create a child, force the
// bounded synchronous cleanup unresolved, then destroy HelperProcessSession
// WITHOUT a prior explicit stop() call (the destructor must resolve
// ownership entirely on its own). Asserts explicit ownership/registry
// transitions, not only elapsed time.
void testChildDestructorFinalOwnership(const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "child-destructor: registry drained before test");

  HelperSessionConfig config = baseConfig(helperPath);
  config.extraArgs = {"--session-ignore-stop"};
  config.stopTimeoutMs = 300;
  auto session = std::make_unique<HelperProcessSession>(config);
  expect(session->start(), "child-destructor: session starts");
  if (session->state() != HelperSessionState::Ready) {
    return;
  }
  expect(session->testOnlyDirectlyOwnsChild(),
         "child-destructor: the session directly owns the child before "
         "destruction");
  test_seam::setForceNextChildCleanupTimeout(true);

  const auto destroyStartedAt = std::chrono::steady_clock::now();
  session.reset();  // destructor runs now, with no prior explicit stop()
  const auto destroyElapsedMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now() - destroyStartedAt)
          .count();

  expect(destroyElapsedMs < 10000,
         "child-destructor: destruction returns within a bounded ceiling");
  expect(registryCount() == 1,
         "child-destructor: the registry owns exactly one entry after "
         "destruction (no direct ownership was lost)");
  expect(pumpUntilEmptyOrDeadline(5000) == 0,
         "child-destructor: a later bounded pump resolves it (count -> 0)");
  expect(HelperProcessCleanupRegistry::instance()
                 .childFallbackReservationCountForTest() == 0,
         "child-destructor: no reservation remains after resolution");

  HelperProcessSession fresh(baseConfig(helperPath));
  expect(fresh.start(),
         "child-destructor: a fresh session starts normally afterward");
  fresh.stop();
}

// #534 final-ownership hardening, Test D -- frame-writer reservation remains
// usable. A healthy frame-enabled session holds its own pre-reserved child-
// cleanup fallback capacity for its entire lifetime (see platformLaunch),
// which must never be conflated with the separate, bounded frame-writer
// reservation counter -- otherwise every running session would perpetually
// block the process-wide one-unresolved-writer bound merely by existing.
void testFrameWriterReservationUnaffectedByChildFallback(
    const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "child-fallback-vs-writer: registry drained before test");

  HelperProcessSession session(baseConfig(helperPath));
  expect(session.start(),
         "child-fallback-vs-writer: session starts (holding its own "
         "pre-reserved child fallback capacity)");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  expect(session.testOnlyHasPreparedChildFallback(),
         "child-fallback-vs-writer: the session holds a prepared child "
         "fallback while healthy");

  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(4, 3);
  const FramePixelView view{frame.data(), 4, 3};
  const HelperTrackOutcome outcome = session.trackWithFrame(26000, view);
  expect(outcome.ok,
         "child-fallback-vs-writer: a normal frame write completes even "
         "while the child fallback reservation is held (no false "
         "process-wide-bound rejection)");
  expect(registryCount() == 0,
         "child-fallback-vs-writer: the registry stays empty (the write "
         "resolved synchronously; the child fallback is a reservation, not "
         "a pending entry)");
  session.stop();
}

// #534 allocation-free final cleanup, Test 3 -- destructor emergency path. When
// stop() throws (modelled here as an OOM from its graceful string/buffer work)
// BEFORE child ownership is resolved, ~HelperProcessSession() must run a
// separate bounded, noexcept emergency path that still resolves the child. Here
// the bounded cleanup is also forced unresolved, so the emergency path must
// commit the already-prepared durable fallback rather than discard the child.
// Destroys the session WITHOUT an explicit stop().
void testDestructorEmergencyResolvesOwnership(const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "destructor-emergency: registry drained before test");
#ifdef _WIN32
  expect(test_seam::durableChildProcessHandleCountForTest() == 0,
         "destructor-emergency: durable child HANDLE count is 0 before test");
#endif

#ifndef _WIN32
  long long capturedPid = -1;
#endif
  {
    HelperSessionConfig config = baseConfig(helperPath);
    config.extraArgs = {"--session-ignore-stop"};  // child ignores stop
    config.stopTimeoutMs = 300;
    auto session = std::make_unique<HelperProcessSession>(config);
    expect(session->start(), "destructor-emergency: session starts");
    if (session->state() != HelperSessionState::Ready) {
      return;
    }
#ifndef _WIN32
    capturedPid = session->testOnlyRetainedChildPid();
    expect(capturedPid > 0,
           "destructor-emergency: the real pid is captured before "
           "destruction");
#endif
    expect(session->testOnlyDirectlyOwnsChild(),
           "destructor-emergency: the session directly owns the child before "
           "destruction");

    // Arm BOTH: stop()'s graceful part throws before resolving ownership, and
    // the bounded cleanup the emergency path then runs is forced unresolved so
    // it MUST commit the prepared fallback (never discard the child).
    test_seam::setForceNextGracefulStopThrow(true);
    test_seam::setForceNextChildCleanupTimeout(true);

    const auto destroyStartedAt = std::chrono::steady_clock::now();
    session.reset();  // destructor: stop() throws -> emergency path resolves
    const auto destroyElapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - destroyStartedAt)
            .count();
    expect(destroyElapsedMs < 10000,
           "destructor-emergency: destruction returns within a bounded ceiling "
           "(no exception escaped the destructor)");
  }

  expect(registryCount() == 1,
         "destructor-emergency: the emergency path committed exactly one "
         "durable entry (direct child ownership was not discarded)");
#ifdef _WIN32
  expect(test_seam::durableChildProcessHandleCountForTest() == 1,
         "destructor-emergency: the process/thread HANDLE pair transferred "
         "0 -> 1");
#endif
  expect(pumpUntilEmptyOrDeadline(5000) == 0,
         "destructor-emergency: a later bounded pump resolves it (count -> 0)");
#ifdef _WIN32
  expect(test_seam::durableChildProcessHandleCountForTest() == 0,
         "destructor-emergency: durable child HANDLE count returns 1 -> 0");
#else
  errno = 0;
  int status = 0;
  const pid_t waited =
      waitpid(static_cast<pid_t>(capturedPid), &status, WNOHANG);
  expect(waited < 0 && errno == ECHILD,
         "destructor-emergency: the exact real child pid was actually reaped "
         "(ECHILD), not merely marked resolved");
#endif
  expect(HelperProcessCleanupRegistry::instance()
                 .childFallbackReservationCountForTest() == 0,
         "destructor-emergency: the reservation returns to baseline after "
         "resolution");

  HelperProcessSession fresh(baseConfig(helperPath));
  expect(fresh.start(),
         "destructor-emergency: a fresh session starts normally afterward");
  fresh.stop();
}

// #534 allocation-free final cleanup, Test 4 -- emergency-path idempotence /
// partial-progress safety. Runs the exact emergency helper the destructor uses,
// then runs it AGAIN, proving re-entry after it (or a partial stop()) already
// resolved and closed things causes no double-close, no double-commit, no
// reservation underflow, and no second owner.
void testEmergencyResolveIdempotent(const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "emergency-idempotent: registry drained before test");
#ifdef _WIN32
  expect(test_seam::durableChildProcessHandleCountForTest() == 0,
         "emergency-idempotent: durable child HANDLE count is 0 before test");
#endif

#ifndef _WIN32
  long long capturedPid = -1;
#endif
  {
    HelperSessionConfig config = baseConfig(helperPath);
    config.extraArgs = {"--session-ignore-stop"};
    config.stopTimeoutMs = 300;
    HelperProcessSession session(config);
    expect(session.start(), "emergency-idempotent: session starts");
    if (session.state() != HelperSessionState::Ready) {
      return;
    }
#ifndef _WIN32
    capturedPid = session.testOnlyRetainedChildPid();
#endif
    expect(session.testOnlyDirectlyOwnsChild(),
           "emergency-idempotent: the session directly owns the child");

    // First run: forced unresolved, so it commits the prepared fallback.
    test_seam::setForceNextChildCleanupTimeout(true);
    session.testOnlyRunEmergencyResolveChildOwnership();
    expect(!session.testOnlyDirectlyOwnsChild(),
           "emergency-idempotent: after the first run the session no longer "
           "directly owns the child");
    expect(registryCount() == 1,
           "emergency-idempotent: the first run committed exactly one entry");
    expect(HelperProcessCleanupRegistry::instance()
                   .childFallbackReservationCountForTest() == 0,
           "emergency-idempotent: the reservation was consumed by the commit");
#ifdef _WIN32
    expect(test_seam::durableChildProcessHandleCountForTest() == 1,
           "emergency-idempotent: exactly one HANDLE pair committed");
#endif

    // Second run must be a pure no-op (cleaned_ guard + null-checked
    // transfer/release): no second owner, no double-commit, no underflow.
    session.testOnlyRunEmergencyResolveChildOwnership();
    expect(registryCount() == 1,
           "emergency-idempotent: the second run creates no second owner "
           "(count stays 1)");
    expect(HelperProcessCleanupRegistry::instance()
                   .childFallbackReservationCountForTest() == 0,
           "emergency-idempotent: the second run causes no reservation "
           "underflow (stays 0)");
#ifdef _WIN32
    expect(test_seam::durableChildProcessHandleCountForTest() == 1,
           "emergency-idempotent: the second run does not double-commit "
           "(HANDLE count stays 1)");
#endif
    // Destroyed here: cleaned_ is set, so ~/stop() is inert and must not
    // disturb the registry-owned child.
  }

  expect(registryCount() == 1,
         "emergency-idempotent: the committed child survives destruction");
  expect(pumpUntilEmptyOrDeadline(3000) == 0,
         "emergency-idempotent: a later bounded pump resolves it (count -> 0)");
#ifndef _WIN32
  errno = 0;
  int status = 0;
  const pid_t waited =
      waitpid(static_cast<pid_t>(capturedPid), &status, WNOHANG);
  expect(waited < 0 && errno == ECHILD,
         "emergency-idempotent: the exact child pid was actually reaped "
         "(ECHILD)");
#endif
  expect(HelperProcessCleanupRegistry::instance()
                 .childFallbackReservationCountForTest() == 0,
         "emergency-idempotent: reservation baseline restored");
}

void testTruncatedHelperReadPath(const std::string& helperPath) {
  HelperSessionConfig config = baseConfig(helperPath);
  config.extraArgs = {"--session-frame-short-read"};
  HelperProcessSession session(config);
  expect(session.start(), "truncated-read: session starts");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(4, 4);
  const FramePixelView view{frame.data(), 4, 4};
  const HelperTrackOutcome outcome = session.trackWithFrame(6000, view);
  expect(
      !outcome.ok,
      "truncated-read: helper's short read produces an ack mismatch "
      "(not-ok outcome)");
  expect(
      session.lastDiagnostic() == HelperDiagnosticCategory::FrameAckMismatch,
      "truncated-read: diagnostic is FrameAckMismatch");
  session.stop();
}

void testStaleSequenceRejection(const std::string& helperPath) {
  HelperSessionConfig config = baseConfig(helperPath);
  config.extraArgs = {"--session-stale-request-id"};
  HelperProcessSession session(config);
  expect(session.start(), "stale-sequence: session starts");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(2, 2);
  const FramePixelView view{frame.data(), 2, 2};
  const HelperTrackOutcome outcome = session.trackWithFrame(7000, view);
  expect(
      !outcome.ok,
      "stale-sequence: a stale requestId/frameAck.sequence rejects the "
      "result (not-ok outcome)");
  session.stop();
}

void testChecksumMismatchRejection(const std::string& helperPath) {
  HelperSessionConfig config = baseConfig(helperPath);
  config.extraArgs = {"--session-frame-bad-ack"};
  HelperProcessSession session(config);
  expect(session.start(), "checksum-mismatch: session starts");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(3, 3);
  const FramePixelView view{frame.data(), 3, 3};
  const HelperTrackOutcome outcome = session.trackWithFrame(8000, view);
  expect(
      !outcome.ok,
      "checksum-mismatch: a corrupted checksum rejects the result");
  expect(
      session.lastDiagnostic() == HelperDiagnosticCategory::FrameAckMismatch,
      "checksum-mismatch: diagnostic is FrameAckMismatch");
  session.stop();
}

void testExactOnceCleanup(const std::string& helperPath) {
  HelperProcessSession session(baseConfig(helperPath));
  expect(session.start(), "exact-once-cleanup: session starts");
  session.stop();
  session.stop();  // idempotent: must not double-close or crash
  session.stop();
  expect(true, "exact-once-cleanup: repeated stop() calls do not crash");
}

// Deterministic reservation test (#534 blocker #4): the process-wide
// unresolved-operation slot is an ATOMIC reservation, so two would-be
// concurrent operations can never both pass a zero-count check. Exercised
// directly on the registry (single-threaded, but modelling the exact
// check-then-act the atomic reservation eliminates): a first tryReserve()
// succeeds; a second is rejected while the first is outstanding; after
// releaseReservation() the slot is free again; and an unused reservation
// never becomes a durable entry.
void testRegistryReservationBoundAndRelease() {
  auto& registry = HelperProcessCleanupRegistry::instance();
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "reservation-bound: registry drained before test");
  expect(registry.tryReserve(),
         "reservation-bound: first writer-slot reservation succeeds");
  expect(!registry.tryReserve(),
         "reservation-bound: a second reservation is rejected while the first "
         "is outstanding (atomic bound, no check-then-act race)");
  expect(registryCount() == 0,
         "reservation-bound: an outstanding reservation is not yet a durable "
         "entry (pendingCount counts only committed entries)");
  registry.releaseReservation();
  expect(registry.tryReserve(),
         "reservation-bound: after release the slot can be reserved again");
  registry.releaseReservation();
  expect(registryCount() == 0,
         "reservation-bound: releasing an unused reservation leaves no entry");
}

#ifdef _WIN32
// Deterministic seam test (#534 blocker #5): when the registry cannot reserve
// a slot, the Windows writer path fails closed WITHOUT creating any operation
// (tryReserve() failure -> no writer thread, registry stays empty), and the
// caller (session) simply reports a bounded frame-write failure. Windows-only:
// the POSIX frame write is a single bounded non-blocking write that never
// reserves a registry slot, so this reservation branch does not exist there
// (the POSIX reserveDurable failure branch is covered by
// testPosixReserveFailureLeavesNoRegistryEntry).
void testReserveFailureRejectsWriteNoOperation(const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "reserve-failure: registry drained before test");
  HelperProcessSession session(baseConfig(helperPath));
  expect(session.start(), "reserve-failure: session starts");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(4, 3);
  const FramePixelView view{frame.data(), 4, 3};
  HelperProcessCleanupRegistry::instance().setForceNextReserveFailureForTest();
  const HelperTrackOutcome outcome = session.trackWithFrame(23000, view);
  expect(!outcome.ok,
         "reserve-failure: the write fails closed when the slot cannot be "
         "reserved");
  expect(session.lastDiagnostic() == HelperDiagnosticCategory::FrameWriteTimeout,
         "reserve-failure: diagnostic is FrameWriteTimeout");
  expect(registryCount() == 0,
         "reserve-failure: no writer operation was created (registry empty -- "
         "the reservation failure left the caller as sole owner)");
  session.stop();
}

// #534 Windows writer-setup rollback slice (Test A includes
// DurableEntryAllocation): the pre-thread setup between a successful
// registry reservation + DuplicateHandle and a successfully-started writer
// thread must be exception-safe. Deterministically injects a throw at each
// of the four throwing setup boundaries (FrameWriteOperationState
// allocation, packet-buffer allocation, the durable ThreadOwnedWriterCleanup
// entry allocation, and thread start itself) and proves: the write fails
// closed with the existing generic FrameWriteTimeout diagnostic, no durable
// registry entry is committed, no durable writer thread HANDLE is ever
// adopted, the process-wide reservation is released (both the same
// session's next write and a separate session can reserve it again), the
// duplicated writer pipe HANDLE is not leaked (count returns to 0), no
// writer thread was ever started (rollback is synchronous, well under the
// configured wait bounds), and the seam is one-shot -- it never poisons a
// later write or test.
void testWindowsFrameWriterSetupFailureRollback(const std::string& helperPath) {
  using test_seam::FrameWriterSetupFailure;
  const FrameWriterSetupFailure stages[] = {
      FrameWriterSetupFailure::StateAllocation,
      FrameWriterSetupFailure::BufferAllocation,
      FrameWriterSetupFailure::DurableEntryAllocation,
      FrameWriterSetupFailure::ThreadConstruction,
  };
  const char* labels[] = {
      "state-allocation", "buffer-allocation", "durable-entry-allocation",
      "thread-construction"};

  for (int i = 0; i < 4; ++i) {
    const std::string label =
        std::string("writer-setup-rollback ") + labels[i];
    expect(pumpUntilEmptyOrDeadline(2000) == 0,
           label + ": registry drained before case");
    expect(test_seam::frameWriterDuplicatedHandleCountForTest() == 0,
           label + ": duplicated writer HANDLE count is 0 before case");
    expect(test_seam::durableWriterThreadHandleCountForTest() == 0,
           label + ": durable writer thread HANDLE count is 0 before case");

    HelperProcessSession session(baseConfig(helperPath));
    expect(session.start(), label + ": session starts");
    if (session.state() != HelperSessionState::Ready) {
      continue;
    }

    const std::vector<std::uint8_t> frame = makeDeterministicBgr24(4, 3);
    const FramePixelView view{frame.data(), 4, 3};

    test_seam::setNextFrameWriterSetupFailure(stages[i]);
    const auto writeStartedAt = std::chrono::steady_clock::now();
    const HelperTrackOutcome outcome =
        session.trackWithFrame(24000 + i, view);
    const auto writeElapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - writeStartedAt)
            .count();

    expect(!outcome.ok,
           label + ": injected setup failure produces a not-ok outcome");
    expect(
        session.lastDiagnostic() == HelperDiagnosticCategory::FrameWriteTimeout,
        label + ": diagnostic is the existing generic FrameWriteTimeout");
    expect(writeElapsedMs < 1000,
           label + ": setup rollback returns promptly (no writer thread was "
                   "ever started, so there is nothing to wait on)");
    expect(registryCount() == 0,
           label + ": no durable writer operation was committed");
    expect(test_seam::frameWriterDuplicatedHandleCountForTest() == 0,
           label + ": the duplicated writer pipe HANDLE was not leaked");
    expect(test_seam::durableWriterThreadHandleCountForTest() == 0,
           label + ": no durable writer thread HANDLE was ever adopted "
                   "(the writer thread never started)");

    const auto stopStartedAt = std::chrono::steady_clock::now();
    session.stop();
    const auto stopElapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - stopStartedAt)
            .count();
    expect(stopElapsedMs < 5000,
           label + ": session shutdown remains bounded and completes "
                   "without a crash or deadlock");

    // A write failure permanently fails the session closed (existing,
    // unchanged behavior -- not part of this rollback slice), so "not
    // poisoned" is proven on a FRESH session: the seam is one-shot and the
    // process-wide reservation was released, so this separate session's
    // write, with no re-injection, must succeed normally.
    HelperProcessSession followUpSession(baseConfig(helperPath));
    expect(followUpSession.start(),
           label + ": a fresh session starts right after the injected "
                   "failure");
    if (followUpSession.state() == HelperSessionState::Ready) {
      const HelperTrackOutcome followUp =
          followUpSession.trackWithFrame(24500 + i, view);
      expect(followUp.ok,
             label + ": a fresh session's frame write succeeds normally "
                     "(seam is one-shot; the reservation was not left "
                     "poisoned)");
      expect(registryCount() == 0,
             label + ": registry stays empty after the follow-up write "
                     "completes (a real writer thread resolves "
                     "synchronously in the first wait)");
    }
    followUpSession.stop();
  }

  // A DIFFERENT session can also obtain the process-wide reservation
  // normally after every injected setup failure above -- proving the
  // reservation was genuinely released each time, not merely observed
  // indirectly via the same session's own follow-up write.
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "writer-setup-rollback: registry drained before cross-session "
         "check");
  HelperProcessSession otherSession(baseConfig(helperPath));
  expect(otherSession.start(),
         "writer-setup-rollback: a separate session starts after the "
         "injected failures");
  if (otherSession.state() == HelperSessionState::Ready) {
    const std::vector<std::uint8_t> frame = makeDeterministicBgr24(2, 2);
    const FramePixelView view{frame.data(), 2, 2};
    const HelperTrackOutcome outcome =
        otherSession.trackWithFrame(25000, view);
    expect(outcome.ok,
           "writer-setup-rollback: a separate session can acquire the "
           "process-wide reservation and complete a write normally after "
           "the injected failures");
  }
  otherSession.stop();
  expect(test_seam::frameWriterDuplicatedHandleCountForTest() == 0,
         "writer-setup-rollback: duplicated writer HANDLE count is 0 after "
         "all cases");
  expect(test_seam::durableWriterThreadHandleCountForTest() == 0,
         "writer-setup-rollback: durable writer thread HANDLE count is 0 "
         "after all cases");
}
#endif  // _WIN32

void testPublicStreamPrivacy(const std::string& helperPath) {
  // HelperTrackOutcome/HelperTrackingResult structurally never carry a raw
  // child line, frameAck, path, or handle value (see helper_message.h /
  // helper_tracking_result.h); this exercises a full successful exchange to
  // confirm the outcome the caller observes contains only the existing
  // mapped tracking fields.
  HelperProcessSession session(baseConfig(helperPath));
  expect(session.start(), "public-stream-privacy: session starts");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(2, 2);
  const FramePixelView view{frame.data(), 2, 2};
  const HelperTrackOutcome outcome = session.trackWithFrame(9000, view);
  expect(outcome.ok, "public-stream-privacy: exchange succeeds");
  session.stop();
}

// v0.13.0 (#556): focused startup-only ready-source handshake cases. No
// frame transport is involved -- these only exercise start()'s preflight
// expected-source validation and the ready-line source match/mismatch path.

void testReadySourceDefaultConfigDefaultSyntheticHelper(
    const std::string& helperPath) {
  HelperSessionConfig config;
  config.executablePath = helperPath;
  HelperProcessSession session(config);
  expect(
      session.start(),
      "ready-source default-config+default-helper: start succeeds");
  expect(
      session.state() == HelperSessionState::Ready,
      "ready-source default-config+default-helper: state becomes Ready");
  session.stop();
}

void testReadySourceMediaPipeExpectedSyntheticHelperFlag(
    const std::string& helperPath) {
  HelperSessionConfig config;
  config.executablePath = helperPath;
  config.expectedReadySource =
      lvk::tracker::kMediaPipeFaceLandmarkerReadySource;
  config.extraArgs = {"--session-ready-source-mediapipe"};
  HelperProcessSession session(config);
  expect(
      session.start(),
      "ready-source mediapipe-expected+mediapipe-flag: start succeeds");
  expect(
      session.state() == HelperSessionState::Ready,
      "ready-source mediapipe-expected+mediapipe-flag: state becomes Ready");
  session.stop();
}

void testReadySourceDefaultExpectedMediaPipeEmittingHelper(
    const std::string& helperPath) {
  HelperSessionConfig config;
  config.executablePath = helperPath;
  config.extraArgs = {"--session-ready-source-mediapipe"};
  HelperProcessSession session(config);
  expect(
      !session.start(),
      "ready-source default-expected+mediapipe-flag: start fails");
  expect(
      session.state() == HelperSessionState::Failed,
      "ready-source default-expected+mediapipe-flag: state becomes Failed");
  expect(
      session.lastDiagnostic() == HelperDiagnosticCategory::MalformedMessage,
      "ready-source default-expected+mediapipe-flag: diagnostic is "
      "MalformedMessage");
  session.stop();
}

void testReadySourceMediaPipeExpectedDefaultSyntheticHelper(
    const std::string& helperPath) {
  HelperSessionConfig config;
  config.executablePath = helperPath;
  config.expectedReadySource =
      lvk::tracker::kMediaPipeFaceLandmarkerReadySource;
  HelperProcessSession session(config);
  expect(
      !session.start(),
      "ready-source mediapipe-expected+default-helper: start fails");
  expect(
      session.state() == HelperSessionState::Failed,
      "ready-source mediapipe-expected+default-helper: state becomes Failed");
  expect(
      session.lastDiagnostic() == HelperDiagnosticCategory::MalformedMessage,
      "ready-source mediapipe-expected+default-helper: diagnostic is "
      "MalformedMessage");
  session.stop();
}

void testReadySourceInvalidExpectedFailsBeforeLaunch(
    const std::string& helperPath) {
  // A deliberately unusable executable path paired with an invalid expected
  // source: the preflight expected-source check must reject BEFORE any
  // launch attempt, so the diagnostic is MalformedMessage, never
  // LaunchFailure.
  HelperSessionConfig config;
  config.executablePath = helperPath + ".does-not-exist-lvk556";
  config.expectedReadySource = "arbitrary-unapproved-source";
  HelperProcessSession session(config);
  expect(
      !session.start(),
      "ready-source invalid-expected: start fails before child launch");
  expect(
      session.state() == HelperSessionState::Failed,
      "ready-source invalid-expected: state becomes Failed");
  expect(
      session.lastDiagnostic() == HelperDiagnosticCategory::MalformedMessage,
      "ready-source invalid-expected: diagnostic is MalformedMessage, not "
      "LaunchFailure");
  session.stop();
}

// v0.13.0 (#568): exact helper invocation mode. These cases exercise the
// platform-independent argument-selection boundary in
// HelperProcessSession::start() -- never platformLaunch() itself -- using the
// strict, exact-argc/argv synthetic-helper probes (A/B/C/D) added alongside
// this change. A strict probe only enters its normal session/frame path on a
// byte-for-byte exact argv match, so a passing exchange here is itself proof
// that no extra, missing, reordered, or implicitly injected argument reached
// the child.

// 1. Default synthetic argument order: the existing "--session" + extraArgs
// contract, no frame transport. Strict probe A proves the exact current argc
// and order (no implicit "--session-frame-mode" was added).
void testExactInvocationDefaultSyntheticArgumentOrder(
    const std::string& helperPath) {
  HelperSessionConfig config;
  config.executablePath = helperPath;
  config.enableFrameTransport = false;
  config.extraArgs = {"--strict-synthetic-session-probe"};
  HelperProcessSession session(config);
  expect(session.start(),
         "exact-invocation default-synthetic-order: session starts (strict "
         "probe A matched the exact current argv)");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const HelperTrackOutcome outcome = session.track(10000);
  expect(outcome.ok,
         "exact-invocation default-synthetic-order: one track() exchange "
         "succeeds");
  session.stop();
}

// 2. Synthetic frame argument order: the existing "--session" +
// "--session-frame-mode" + extraArgs contract. Strict probe B proves the
// exact current argc and order with frame transport enabled.
void testExactInvocationSyntheticFrameArgumentOrder(
    const std::string& helperPath) {
  HelperSessionConfig config;
  config.executablePath = helperPath;
  config.enableFrameTransport = true;
  config.extraArgs = {"--strict-synthetic-frame-session-probe"};
  HelperProcessSession session(config);
  expect(session.start(),
         "exact-invocation synthetic-frame-order: session starts (strict "
         "probe B matched the exact current argv)");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(2, 2);
  const FramePixelView view{frame.data(), 2, 2};
  const HelperTrackOutcome outcome = session.trackWithFrame(11000, view);
  expect(outcome.ok,
         "exact-invocation synthetic-frame-order: one trackWithFrame() "
         "exchange succeeds and frameAck validates");
  session.stop();
}

// 3. Exact argument order and count: ExactArguments mode passes only the
// configured argv, in order, with no injected "--session". Any implicit
// "--session" would change argc/order and strict probe C would reject
// startup -- a passing exchange is the required proof.
void testExactInvocationExactArgumentOrderAndCount(
    const std::string& helperPath) {
  HelperSessionConfig config;
  config.executablePath = helperPath;
  config.invocationMode = HelperInvocationMode::ExactArguments;
  config.exactArguments = {
      "--strict-exact-session-probe", "argument with spaces", "exact-tail"};
  config.enableFrameTransport = false;
  HelperProcessSession session(config);
  expect(session.start(),
         "exact-invocation exact-order-and-count: session starts (strict "
         "probe C matched the exact configured argv, no injected "
         "\"--session\")");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const HelperTrackOutcome outcome = session.track(12000);
  expect(outcome.ok,
         "exact-invocation exact-order-and-count: one track() exchange "
         "succeeds");
  session.stop();
}

// 4. Exact arguments with private frame transport: ExactArguments mode with
// enableFrameTransport = true still passes only the configured argv -- no
// injected "--session" or "--session-frame-mode". Strict probe D requires the
// exact same tail whether or not frame transport is enabled, so a passing
// trackWithFrame()/frameAck exchange is the required proof that frame
// endpoint creation is independent from synthetic CLI injection.
void testExactInvocationExactArgumentsWithFrameTransport(
    const std::string& helperPath) {
  HelperSessionConfig config;
  config.executablePath = helperPath;
  config.invocationMode = HelperInvocationMode::ExactArguments;
  config.exactArguments = {
      "--strict-exact-frame-session-probe", "frame argument with spaces",
      "exact-frame-tail"};
  config.enableFrameTransport = true;
  HelperProcessSession session(config);
  expect(session.start(),
         "exact-invocation exact-with-frame-transport: session starts "
         "(strict probe D matched the exact configured argv, no injected "
         "\"--session\"/\"--session-frame-mode\")");
  if (session.state() != HelperSessionState::Ready) {
    return;
  }
  const std::vector<std::uint8_t> frame = makeDeterministicBgr24(2, 2);
  const FramePixelView view{frame.data(), 2, 2};
  const HelperTrackOutcome outcome = session.trackWithFrame(13000, view);
  expect(outcome.ok,
         "exact-invocation exact-with-frame-transport: one trackWithFrame() "
         "exchange succeeds and frameAck validates");
  session.stop();
}

// 5. ExactArguments mode combined with non-empty legacy extraArgs is
// ambiguous argv ownership: start() must reject it BEFORE any child is
// created, with the same generic MalformedMessage category the
// expectedReadySource preflight check already uses.
void testExactInvocationRejectsMixedModeExtraArgs(
    const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "exact-invocation reject-mixed-extra-args: registry drained before "
         "test");
  HelperSessionConfig config;
  config.executablePath = helperPath;
  config.invocationMode = HelperInvocationMode::ExactArguments;
  config.exactArguments = {"--strict-exact-session-probe"};
  config.extraArgs = {"--strict-synthetic-session-probe"};
  HelperProcessSession session(config);
  expect(!session.start(),
         "exact-invocation reject-mixed-extra-args: start() fails closed "
         "before launch");
  expect(session.state() == HelperSessionState::Failed,
         "exact-invocation reject-mixed-extra-args: state is Failed");
  expect(session.lastDiagnostic() == HelperDiagnosticCategory::MalformedMessage,
         "exact-invocation reject-mixed-extra-args: diagnostic is "
         "MalformedMessage");
  expect(!session.testOnlyDirectlyOwnsChild(),
         "exact-invocation reject-mixed-extra-args: no child was ever "
         "created");
  expect(!session.testOnlyHasPreparedChildFallback(),
         "exact-invocation reject-mixed-extra-args: no prepared child "
         "fallback remains");
  expect(registryCount() == 0,
         "exact-invocation reject-mixed-extra-args: durable registry stays "
         "at baseline");
  session.stop();  // idempotent no-op on a never-launched session
}

// 6. SyntheticSession mode combined with non-empty exactArguments is the
// mirror-image ambiguous configuration: start() must reject it BEFORE any
// child is created, with the same pre-launch evidence as case 5.
void testExactInvocationRejectsMixedModeExactArguments(
    const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "exact-invocation reject-mixed-exact-args: registry drained before "
         "test");
  HelperSessionConfig config;
  config.executablePath = helperPath;
  config.exactArguments = {"--strict-exact-session-probe"};
  HelperProcessSession session(config);
  expect(!session.start(),
         "exact-invocation reject-mixed-exact-args: start() fails closed "
         "before launch");
  expect(session.state() == HelperSessionState::Failed,
         "exact-invocation reject-mixed-exact-args: state is Failed");
  expect(session.lastDiagnostic() == HelperDiagnosticCategory::MalformedMessage,
         "exact-invocation reject-mixed-exact-args: diagnostic is "
         "MalformedMessage");
  expect(!session.testOnlyDirectlyOwnsChild(),
         "exact-invocation reject-mixed-exact-args: no child was ever "
         "created");
  expect(!session.testOnlyHasPreparedChildFallback(),
         "exact-invocation reject-mixed-exact-args: no prepared child "
         "fallback remains");
  expect(registryCount() == 0,
         "exact-invocation reject-mixed-exact-args: durable registry stays "
         "at baseline");
  session.stop();  // idempotent no-op on a never-launched session
}

// 7. An unsupported HelperInvocationMode value (constructed via a deliberate
// invalid enum cast, never reachable through the closed public enum) must be
// rejected with the same pre-launch evidence as cases 5 and 6.
void testExactInvocationRejectsUnsupportedMode(const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "exact-invocation reject-unsupported-mode: registry drained before "
         "test");
  HelperSessionConfig config;
  config.executablePath = helperPath;
  config.invocationMode = static_cast<HelperInvocationMode>(
      static_cast<int>(HelperInvocationMode::ExactArguments) + 1);
  HelperProcessSession session(config);
  expect(!session.start(),
         "exact-invocation reject-unsupported-mode: start() fails closed "
         "before launch");
  expect(session.state() == HelperSessionState::Failed,
         "exact-invocation reject-unsupported-mode: state is Failed");
  expect(session.lastDiagnostic() == HelperDiagnosticCategory::MalformedMessage,
         "exact-invocation reject-unsupported-mode: diagnostic is "
         "MalformedMessage");
  expect(!session.testOnlyDirectlyOwnsChild(),
         "exact-invocation reject-unsupported-mode: no child was ever "
         "created");
  expect(!session.testOnlyHasPreparedChildFallback(),
         "exact-invocation reject-unsupported-mode: no prepared child "
         "fallback remains");
  expect(registryCount() == 0,
         "exact-invocation reject-unsupported-mode: durable registry stays "
         "at baseline");
  session.stop();  // idempotent no-op on a never-launched session
}

// 8. An empty exactArguments vector is valid configuration (an executable can
// require no arguments) and must reach the existing bounded platform launch
// path rather than being rejected as malformed configuration. Pairing it with
// a deliberately nonexistent executable path proves this: the failure must be
// LaunchFailure, not MalformedMessage.
void testExactInvocationEmptyExactArgumentsReachesLaunch(
    const std::string& helperPath) {
  expect(pumpUntilEmptyOrDeadline(2000) == 0,
         "exact-invocation empty-exact-args: registry drained before test");
  HelperSessionConfig config;
  config.executablePath = helperPath + ".does-not-exist-lvk568";
  config.invocationMode = HelperInvocationMode::ExactArguments;
  HelperProcessSession session(config);
  expect(!session.start(),
         "exact-invocation empty-exact-args: start() fails (bad exec path)");
  expect(session.state() == HelperSessionState::Failed,
         "exact-invocation empty-exact-args: state is Failed");
  expect(session.lastDiagnostic() == HelperDiagnosticCategory::LaunchFailure,
         "exact-invocation empty-exact-args: diagnostic is LaunchFailure, "
         "proving the empty vector passed configuration validation and "
         "reached the existing bounded platform launch path (not rejected "
         "as MalformedMessage)");
  expect(!session.testOnlyDirectlyOwnsChild(),
         "exact-invocation empty-exact-args: no child remains directly "
         "owned");
  expect(!session.testOnlyHasPreparedChildFallback(),
         "exact-invocation empty-exact-args: no prepared child fallback "
         "remains");
  expect(registryCount() == 0,
         "exact-invocation empty-exact-args: durable registry returns to "
         "baseline");
  session.stop();  // idempotent no-op on a never-launched session
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "[helper-frame-transport-smoke] usage: "
                 "lvk-helper-frame-transport-smoke "
                 "<path-to-lvk-synthetic-helper>\n";
    return 1;
  }
  const std::string helperPath = argv[1];

  // Deterministic lifecycle tests drive the durable registry through explicit
  // pump() calls, so disable its background worker for this process and start
  // from a known-empty registry.
  HelperProcessCleanupRegistry::instance().disableAutoWorkerForTest();
  expect(registryCount() == 0, "startup: durable cleanup registry is empty");

  testValidRoundTripAndAck(helperPath);
  testSequenceCorrelationOneFrameInFlight(helperPath);
  testNonContiguousNormalization(helperPath);
  testHelperExitDuringTransfer(helperPath);
  testHelperIgnoresFramePipeParentTimeoutAndShutdownUnblocks(helperPath);
  testRegistryReservationBoundAndRelease();
#ifdef _WIN32
  testReserveFailureRejectsWriteNoOperation(helperPath);
  testWindowsNormalCompletionLeavesRegistryEmpty(helperPath);
  testWindowsWriterTransferBoundReleaseAndDestruction(helperPath);
  testWindowsWriterTeardownSafety(helperPath);
  testWindowsFrameWriterSetupFailureRollback(helperPath);
#else
  testPosixExecStatusInjectionFailsClosed(helperPath);
  testPosixChildReportedFailureImmediateReap(helperPath);
  testPosixLaunchFailureCleanupTimeoutTransfer(helperPath);
  testPosixDuplicatePidRejected();
  testPosixPidClaimPreparationFailure(helperPath);
  testPosixPidClaimReuseSerialization();
#endif
  testChildFallbackPreLaunchPreparationFailure(helperPath);
  testChildUnresolvedShutdownAlwaysTransfers(helperPath);
  testChildDestructorFinalOwnership(helperPath);
  testFrameWriterReservationUnaffectedByChildFallback(helperPath);
  testDestructorEmergencyResolvesOwnership(helperPath);
  testEmergencyResolveIdempotent(helperPath);
  testTruncatedHelperReadPath(helperPath);
  testStaleSequenceRejection(helperPath);
  testChecksumMismatchRejection(helperPath);
  testExactOnceCleanup(helperPath);
  testPublicStreamPrivacy(helperPath);
  testReadySourceDefaultConfigDefaultSyntheticHelper(helperPath);
  testReadySourceMediaPipeExpectedSyntheticHelperFlag(helperPath);
  testReadySourceDefaultExpectedMediaPipeEmittingHelper(helperPath);
  testReadySourceMediaPipeExpectedDefaultSyntheticHelper(helperPath);
  testReadySourceInvalidExpectedFailsBeforeLaunch(helperPath);

  testExactInvocationDefaultSyntheticArgumentOrder(helperPath);
  testExactInvocationSyntheticFrameArgumentOrder(helperPath);
  testExactInvocationExactArgumentOrderAndCount(helperPath);
  testExactInvocationExactArgumentsWithFrameTransport(helperPath);
  testExactInvocationRejectsMixedModeExtraArgs(helperPath);
  testExactInvocationRejectsMixedModeExactArguments(helperPath);
  testExactInvocationRejectsUnsupportedMode(helperPath);
  testExactInvocationEmptyExactArgumentsReachesLaunch(helperPath);

  // No lifecycle test may leak a durable cleanup entry.
  expect(pumpUntilEmptyOrDeadline(5000) == 0,
         "teardown: durable cleanup registry returns to empty");

  if (gFailures != 0) {
    std::cerr << "[helper-frame-transport-smoke] " << gFailures
              << " assertion(s) failed.\n";
    return 1;
  }
  std::cout << "helper-frame-transport smoke OK\n";
  return 0;
}
