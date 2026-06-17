#pragma once

#include <string>
#include <vector>

namespace lvk::tracker {

// Result of running a helper child process under bounded supervision (H1c).
//
// The captured stdout/stderr are PRIVATE child-process data read by Native Core
// only. They must never be forwarded to the parent's stdout (lvk-tracker-core
// stdout remains MotionFrame JSON only in existing runtime flows). See
// docs/TRACKING_HELPER_PROCESS_PROTOTYPE_DESIGN.md.
struct HelperProcessRunResult {
  int exitCode = -1;
  bool timedOut = false;
  bool launched = false;
  std::string stdoutText;
  std::string stderrText;
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
