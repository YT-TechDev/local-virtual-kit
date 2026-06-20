#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace lvk::tracker {

// Smoke-only cumulative capture cap per stream (stdout and stderr each) applied
// by runHelperProcessForSmoke. Every legitimate synthetic helper run emits well
// under this; the cap only bounds pathological / high-volume output so Native
// Core's captured buffer cannot grow without limit. Exposed so synthetic smokes
// can assert the bound. This is a smoke-only safety bound, NOT a production
// supervisor / backpressure / reject policy.
constexpr std::size_t kHelperSmokeCapturedStreamByteCap = 64 * 1024;

// Result of running a helper child process under bounded supervision (H1c).
//
// The captured stdout/stderr are PRIVATE child-process data read by Native Core
// only. They must never be forwarded to the parent's stdout (lvk-tracker-core
// stdout remains MotionFrame JSON only in existing runtime flows). See
// docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md.
//
// Captured stdout/stderr are each bounded to a smoke-only cumulative byte cap
// (see helper_process_supervisor.cpp). If a child emits more than the cap on a
// stream, the extra bytes are drained from the pipe but NOT stored, and the
// corresponding *Truncated flag is set. This keeps capture bounded, local, and
// private even for high-volume synthetic output; it is a smoke-only safety
// bound, NOT a production supervisor / backpressure / reject policy.
struct HelperProcessRunResult {
  int exitCode = -1;
  bool timedOut = false;
  bool launched = false;
  std::string stdoutText;
  std::string stderrText;
  // Set when captured stdout/stderr reached the smoke-only cumulative cap and
  // further bytes were drained-but-discarded. Internal to the smoke supervision
  // path; synthetic-only and not part of any public contract.
  bool stdoutTruncated = false;
  bool stderrTruncated = false;
};

// Launches `executablePath` with `arguments` as a child process, capturing its
// stdout and stderr through pipes (no temporary files). If the child does not
// exit within `timeoutMs` (when > 0), it is terminated and `timedOut` is set.
//
// This is a minimal smoke-only supervision primitive — not a production process
// manager. It assumes small, bounded child output (the synthetic helper's smoke
// contract). It is intentionally not wired into the lvk-tracker-core runtime.
HelperProcessRunResult runHelperProcessForSmoke(
    const std::string& executablePath,
    const std::vector<std::string>& arguments,
    int timeoutMs);

}  // namespace lvk::tracker
