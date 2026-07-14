#pragma once

#include <condition_variable>
#include <cstddef>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

namespace lvk::tracker {

// v0.13.0 (#534): Native Core-internal, process-local durable owner of
// OS-resource cleanups that must be able to outlive the individual
// HelperProcessSession that created them:
//   - a POSIX child pid whose bounded reap timed out (avoid a lost zombie),
//   - a Windows process/thread handle whose bounded exit-wait timed out,
//   - a Windows frame-writer thread that a bounded cancellation sequence
//     could not confirm complete (avoid an unowned detached thread that
//     still holds a duplicated pipe handle and a packet buffer).
//
// It is NOT a public runtime API: nothing here is reachable through the CLI,
// MotionFrame, telemetry, logs, or HelperProcessSession's public interface,
// and it adds no network, persistence, file, socket, or shared-memory
// behavior. Every entry performs only bounded, non-blocking, local
// OS-resource lifecycle work in poll().
//
// A short-lived worker thread exists ONLY while at least one cleanup is
// pending and exits as soon as the pending set drains, so there is no
// permanent background thread during normal operation. In fact the singleton
// (and its worker) are never even created unless something actually times
// out -- the common #533/#534 paths reap within their bounds and never touch
// this registry.

// Abstract, platform-independent unit of deferred OS-resource cleanup.
class PendingCleanup {
 public:
  virtual ~PendingCleanup() = default;
  // Non-blocking, bounded, idempotent attempt to finish cleanup. Returns
  // true once the owned OS resource is conclusively released, so the entry
  // may be dropped. Must never block.
  virtual bool poll() = 0;
};

class HelperProcessCleanupRegistry {
 public:
  static HelperProcessCleanupRegistry& instance();

  HelperProcessCleanupRegistry(const HelperProcessCleanupRegistry&) = delete;
  HelperProcessCleanupRegistry& operator=(
      const HelperProcessCleanupRegistry&) = delete;

  // v0.13.0 (#534, transactional): ownership transfer is a two-phase
  // reserve -> prepare -> commit protocol so a caller never loses sole
  // ownership on a partial failure, and the process-wide unresolved-operation
  // bound is enforced atomically (no check-then-act race).
  //
  // tryReserve(): atomically claim the single process-wide unresolved-writer
  //   slot, enforcing the production bound (at most one pending WRITER entry
  //   OR outstanding writer reservation across all sessions). Drains already-
  //   resolved entries first, so a previously-finished operation never blocks
  //   a new one. Returns false (caller keeps sole ownership, nothing changed)
  //   when the slot is taken or capacity cannot be grown. Used by the frame
  //   writer only.
  // releaseReservation(): give back an unused WRITER reservation on any
  //   pre-commit failure. Non-throwing. Leaves the registry exactly as before
  //   the reserve.
  // commit(): convert a held WRITER reservation into a durable entry.
  //   Non-throwing: the storage was pre-grown at reserve time so no
  //   allocation happens here; worker start-up failure is tolerated (entries
  //   still resolve via pump() and the teardown drain). After commit the
  //   registry is the sole owner.
  //
  // reserveChildFallback() / releaseChildFallbackReservation() /
  //   commitChildFallback(): the SAME reserve -> prepare -> commit protocol,
  //   but for a session's own child-process cleanup fallback (POSIX pid /
  //   Windows process+thread handles), tracked in a SEPARATE counter
  //   (childFallbackReservations_) so it never counts toward -- and can never
  //   be falsely blocked by, or falsely block -- the writer bound above.
  //   reserveChildFallback() is UNCONDITIONAL (like the old reserveDurable()):
  //   every launched session reserves and holds exactly one of these for its
  //   entire lifetime (see platformLaunch), releasing it on confirmed child
  //   release or consuming it via commitChildFallback() on an unresolved
  //   shutdown. Both reservation kinds share the same pre-grown pending_
  //   storage and the same non-throwing commit guarantee; a committed child
  //   entry is indistinguishable from a committed writer entry once in
  //   pending_ (both are returned by pendingCount()), but an OUTSTANDING
  //   child-fallback reservation never is.
  //
  // Correct use (caller): reserve; construct/adopt the entry (construction
  // may fail -> release; adoption is noexcept and cannot fail); commit
  // (never throws) -> then, and only then, relinquish the raw pid/HANDLE.
  // There is no window in which both the registry and the caller own the
  // same resource.
  bool tryReserve();
  void releaseReservation() noexcept;
  void commit(std::unique_ptr<PendingCleanup> cleanup) noexcept;

  bool reserveChildFallback();
  void releaseChildFallbackReservation() noexcept;
  void commitChildFallback(std::unique_ptr<PendingCleanup> cleanup) noexcept;

  // Bounded, non-blocking pump of every pending entry; drops resolved ones.
  // Returns the number still pending afterward. Safe to call from any
  // HelperProcessSession lifecycle operation as an opportunistic retry
  // trigger, independent of the background worker.
  std::size_t pump();

  // Number of committed durable entries (outstanding reservations are not
  // counted; they are transient and held only across a single transfer).
  std::size_t pendingCount();

  ~HelperProcessCleanupRegistry();

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  // Test-only: disable the background worker so tests drive resolution
  // deterministically through explicit pump() calls. Compiled out of
  // production binaries (the macro is defined only on the smoke target).
  void disableAutoWorkerForTest();
  // Test-only: force the NEXT reserve (tryReserve or reserveChildFallback) to
  // fail as if capacity could not be grown, so the caller's ownership-
  // retention path can be exercised deterministically. One-shot; consumed by
  // the next reserve attempt. No production CLI/env control; compiled out of
  // production binaries.
  void setForceNextReserveFailureForTest();
  // Test-only: current count of outstanding (uncommitted) child-fallback
  // reservations, so a test can prove a pre-launch failure left none
  // outstanding, and that a healthy running session holds exactly one
  // without it ever being mistaken for a pending entry (see pendingCount()).
  std::size_t childFallbackReservationCountForTest();
#endif

 private:
  HelperProcessCleanupRegistry() = default;
  void workerMain();
  std::size_t pumpLocked();          // caller holds mutex_
  // Grows pending_'s capacity to cover every already-committed entry plus
  // every outstanding reservation of BOTH kinds (including the one about to
  // be added), so every later commit()/commitChildFallback() push_back is
  // guaranteed not to reallocate. Caller holds mutex_.
  bool growPendingCapacityLocked();
  bool reserveLocked();                    // caller holds mutex_ (writer bound)
  bool reserveChildFallbackLocked();       // caller holds mutex_ (no bound)
  void startWorkerLocked() noexcept;       // caller holds mutex_

  std::mutex mutex_;
  std::condition_variable cv_;
  std::vector<std::unique_ptr<PendingCleanup>> pending_;
  // Outstanding (uncommitted) WRITER reservations. Together with
  // pending_.size() this is the atomic accounting for the process-wide
  // unresolved-WRITER-operation bound (tryReserve()/commit()).
  std::size_t reservations_ = 0;
  // Outstanding (uncommitted) child-cleanup-fallback reservations. Tracked
  // SEPARATELY from reservations_ above so a healthy session's own pre-
  // reserved child fallback (held for the session's whole lifetime) never
  // counts toward, and can never be blocked by, the writer bound.
  std::size_t childFallbackReservations_ = 0;
  std::thread worker_;
  bool workerActive_ = false;
  bool stopping_ = false;
  bool autoWorker_ = true;
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  bool forceNextReserveFailure_ = false;
#endif
};

}  // namespace lvk::tracker
