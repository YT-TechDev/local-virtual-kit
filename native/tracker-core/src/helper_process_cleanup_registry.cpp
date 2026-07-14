#include "helper_process_cleanup_registry.h"

#include <chrono>

// v0.13.0 (#534): platform-independent container + short-lived worker for the
// durable cleanup registry. The platform-specific PendingCleanup entry types
// (POSIX pid reap, Windows process-handle wait, Windows writer-thread wait)
// live in helper_process_session.cpp, inside its per-platform #ifdef blocks;
// this file only owns the generic lifecycle (reserve / commit / pump / worker).

namespace lvk::tracker {

// The worker's wake slice: short enough that a resolvable entry (e.g. a
// zombie that just became reapable, or a writer thread that just exited after
// the child was terminated) is cleaned up promptly, without busy-spinning.
constexpr int kWorkerSliceMs = 25;

HelperProcessCleanupRegistry& HelperProcessCleanupRegistry::instance() {
  static HelperProcessCleanupRegistry registry;
  return registry;
}

std::size_t HelperProcessCleanupRegistry::pumpLocked() {
  for (auto it = pending_.begin(); it != pending_.end();) {
    if ((*it)->poll()) {
      it = pending_.erase(it);
    } else {
      ++it;
    }
  }
  return pending_.size();
}

void HelperProcessCleanupRegistry::workerMain() {
  std::unique_lock<std::mutex> lock(mutex_);
  while (!stopping_ && !pending_.empty()) {
    pumpLocked();
    if (pending_.empty()) {
      break;
    }
    cv_.wait_for(lock, std::chrono::milliseconds(kWorkerSliceMs));
  }
  // Exit when drained (or stopping): no permanent background thread remains
  // once the pending set is empty. A later commit() joins this (now-exited)
  // thread before starting a fresh one.
  workerActive_ = false;
}

// Starts the short-lived worker if enabled and not already running. noexcept:
// any std::thread start-up failure (resource exhaustion) is swallowed -- the
// committed entry is still resolved by opportunistic pump() calls and the
// teardown drain, so the worker is only an optimization, never a correctness
// requirement. Caller holds mutex_.
void HelperProcessCleanupRegistry::startWorkerLocked() noexcept {
  if (!autoWorker_ || workerActive_) {
    return;
  }
  if (worker_.joinable()) {
    // A previous worker already returned (drained the set) but has not been
    // joined yet. It never re-locks mutex_ after clearing workerActive_, so
    // this join is bounded (the thread is exiting).
    worker_.join();
  }
  stopping_ = false;
  try {
    worker_ = std::thread([this]() { workerMain(); });
    workerActive_ = true;
  } catch (...) {
    // Could not start the worker (thread resource exhaustion). The entry is
    // already committed and will resolve via pump()/teardown; leave
    // workerActive_ false so a later commit() can retry the start.
    workerActive_ = false;
  }
}

// Grows pending_'s capacity to cover every committed entry plus every
// outstanding reservation of BOTH kinds (including the one about to be
// added), so each later commit()/commitChildFallback() push_back is
// guaranteed not to reallocate -- which is what makes both non-throwing.
// Caller holds mutex_.
bool HelperProcessCleanupRegistry::growPendingCapacityLocked() {
  try {
    pending_.reserve(
        pending_.size() + reservations_ + childFallbackReservations_ + 1);
  } catch (...) {
    return false;  // out of memory: nothing changed, caller keeps ownership
  }
  return true;
}

// Reserves the single process-wide unresolved-WRITER slot: refuses if any
// entry is pending or a writer reservation is already outstanding. Never
// looks at childFallbackReservations_, so a healthy session's own pre-
// reserved child fallback can never falsely block this. Caller holds mutex_.
bool HelperProcessCleanupRegistry::reserveLocked() {
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  if (forceNextReserveFailure_) {
    forceNextReserveFailure_ = false;
    return false;  // simulate capacity-growth failure; caller keeps ownership
  }
#endif
  pumpLocked();  // drop already-resolved entries so a finished op never blocks
  if (reservations_ > 0 || !pending_.empty()) {
    return false;
  }
  if (!growPendingCapacityLocked()) {
    return false;
  }
  ++reservations_;
  return true;
}

// Reserves a child-cleanup-fallback slot UNCONDITIONALLY (ignoring the writer
// bound entirely): every launched session holds exactly one of these for its
// whole lifetime. Only fails on genuine allocation failure, leaving the
// caller as sole owner (no child was created yet -- see platformLaunch).
// Deliberately does NOT pumpLocked() first (unlike reserveLocked()): there is
// no bound here for a stale resolved entry to falsely block, and this runs on
// every session launch (a common path), so opportunistically polling -- and
// thereby re-issuing CancelSynchronousIo/TerminateProcess retries against --
// EVERY other session's unrelated pending entries here would perturb their
// timing (observed by existing writer-bound tests). Caller holds mutex_.
bool HelperProcessCleanupRegistry::reserveChildFallbackLocked() {
#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
  if (forceNextReserveFailure_) {
    forceNextReserveFailure_ = false;
    return false;
  }
#endif
  if (!growPendingCapacityLocked()) {
    return false;
  }
  ++childFallbackReservations_;
  return true;
}

bool HelperProcessCleanupRegistry::tryReserve() {
  std::lock_guard<std::mutex> lock(mutex_);
  return reserveLocked();
}

void HelperProcessCleanupRegistry::releaseReservation() noexcept {
  std::lock_guard<std::mutex> lock(mutex_);
  if (reservations_ > 0) {
    --reservations_;
  }
}

void HelperProcessCleanupRegistry::commit(
    std::unique_ptr<PendingCleanup> cleanup) noexcept {
  std::lock_guard<std::mutex> lock(mutex_);
  if (reservations_ > 0) {
    --reservations_;
  }
  if (cleanup == nullptr) {
    return;
  }
  // Capacity was pre-grown by the matching reserve, so this push_back never
  // reallocates and (with unique_ptr's noexcept move) never throws.
  pending_.push_back(std::move(cleanup));
  startWorkerLocked();
}

bool HelperProcessCleanupRegistry::reserveChildFallback() {
  std::lock_guard<std::mutex> lock(mutex_);
  return reserveChildFallbackLocked();
}

void HelperProcessCleanupRegistry::releaseChildFallbackReservation() noexcept {
  std::lock_guard<std::mutex> lock(mutex_);
  if (childFallbackReservations_ > 0) {
    --childFallbackReservations_;
  }
}

void HelperProcessCleanupRegistry::commitChildFallback(
    std::unique_ptr<PendingCleanup> cleanup) noexcept {
  std::lock_guard<std::mutex> lock(mutex_);
  if (childFallbackReservations_ > 0) {
    --childFallbackReservations_;
  }
  if (cleanup == nullptr) {
    return;
  }
  // Capacity was pre-grown by the matching reserveChildFallback(), so this
  // push_back never reallocates and never throws.
  pending_.push_back(std::move(cleanup));
  startWorkerLocked();
}

std::size_t HelperProcessCleanupRegistry::pump() {
  std::lock_guard<std::mutex> lock(mutex_);
  return pumpLocked();
}

std::size_t HelperProcessCleanupRegistry::pendingCount() {
  std::lock_guard<std::mutex> lock(mutex_);
  return pending_.size();
}

#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM
void HelperProcessCleanupRegistry::disableAutoWorkerForTest() {
  std::lock_guard<std::mutex> lock(mutex_);
  autoWorker_ = false;
}
void HelperProcessCleanupRegistry::setForceNextReserveFailureForTest() {
  std::lock_guard<std::mutex> lock(mutex_);
  forceNextReserveFailure_ = true;
}
std::size_t HelperProcessCleanupRegistry::childFallbackReservationCountForTest() {
  std::lock_guard<std::mutex> lock(mutex_);
  return childFallbackReservations_;
}
#endif

HelperProcessCleanupRegistry::~HelperProcessCleanupRegistry() {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    stopping_ = true;
  }
  cv_.notify_all();
  if (worker_.joinable()) {
    // Bounded: the worker wakes within one slice, observes stopping_, and
    // returns.
    worker_.join();
  }
  // Process is exiting. Do one final non-blocking drain; any residual
  // entries are then destroyed with the vector, and each entry's destructor
  // performs its own bounded last-resort release (see helper_process_session
  // .cpp). This is the single point where an OS resource can outlast the
  // registry, and only at genuine process teardown.
  std::lock_guard<std::mutex> lock(mutex_);
  pumpLocked();
}

}  // namespace lvk::tracker
