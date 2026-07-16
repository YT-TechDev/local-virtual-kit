#!/usr/bin/env node
// Native frame-helper backend boundary check (v0.13.0, #569).
//
// Deterministic, static source-contract checker. Requires no OpenCV, no
// native binary, no camera, and no helper process: it inspects only
// tracking_backend.h, tracking_backend.cpp, and main.cpp text and proves the
// generic FrameHelperTrackingBackend / SyntheticFrameHelperTrackingBackend
// composition boundary described in Issue #569, without ever printing file
// paths, source snippets, regex text, exception text, line numbers, or
// private helper markers.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

function readBoundedUtf8(relativePath) {
  const buffer = readFileSync(join(repoRoot, relativePath));
  if (buffer.length > MAX_SOURCE_BYTES) {
    throw new Error("bounded read limit exceeded");
  }
  return buffer.toString("utf8");
}

function assert(condition) {
  if (!condition) {
    throw new Error("boundary contract check failed");
  }
}

// --- bounded lexical helpers -------------------------------------------------
//
// Masks // line comments, /* */ block comments, and "..."/'...' literal
// bodies with spaces (preserving length and newlines) so brace/paren
// balancing and text matching never misfire on bracket-shaped characters
// inside comments or string literals. Masked and original strings always
// stay the same length and index-aligned.
function maskCommentsAndStrings(source) {
  let out = "";
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    const next = i + 1 < n ? source[i + 1] : "";
    if (c === "/" && next === "/") {
      let j = i;
      while (j < n && source[j] !== "\n") j++;
      out += " ".repeat(j - i);
      i = j;
      continue;
    }
    if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < n - 1 && !(source[j] === "*" && source[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      for (let k = i; k < j; k++) out += source[k] === "\n" ? "\n" : " ";
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < n && source[j] !== quote) {
        if (source[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, n);
      for (let k = i; k < j; k++) out += source[k] === "\n" ? "\n" : " ";
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function findMatchingBracket(masked, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    const c = masked[i];
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractClassBody(masked, original, className) {
  // "final" disambiguates the real class definition from an earlier
  // `friend class ${className};` declaration inside a different class body
  // (e.g. FrameHelperTrackingBackend's trusted-wrapper friend list): every
  // real class definition in this codebase (and the self-test sample below)
  // is declared `final`, but a friend declaration never is, so a bare
  // `class ${className}` marker would otherwise match the friend line first
  // and return the wrong class's body.
  const marker = `class ${className} final`;
  const markerIdx = masked.indexOf(marker);
  if (markerIdx === -1) return null;
  const braceIdx = masked.indexOf("{", markerIdx);
  if (braceIdx === -1) return null;
  const endIdx = findMatchingBracket(masked, braceIdx, "{", "}");
  if (endIdx === -1) return null;
  return {
    masked: masked.slice(braceIdx + 1, endIdx),
    original: original.slice(braceIdx + 1, endIdx),
  };
}

// Locates a named function/constructor's parameter-list close paren and its
// real body-opening brace. The scan between the parameter-list close paren
// and the body brace tolerates a member-initializer list that itself
// contains nested parens and brace-init expressions (e.g.
// `: diagnostics_(Type{...})`): it tracks combined paren/brace nesting depth
// and only accepts a '{' as the body brace when depth has returned to zero,
// so brace-init syntax inside the initializer list is never mistaken for
// the function body.
function locateFunctionRegions(masked, signaturePrefix) {
  const idx = masked.indexOf(signaturePrefix);
  if (idx === -1) return null;
  const parenOpenIdx = idx + signaturePrefix.length - 1;
  if (masked[parenOpenIdx] !== "(") return null;

  let paramDepth = 0;
  let parenCloseIdx = -1;
  for (let i = parenOpenIdx; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(") paramDepth++;
    else if (c === ")") {
      paramDepth--;
      if (paramDepth === 0) {
        parenCloseIdx = i;
        break;
      }
    }
  }
  if (parenCloseIdx === -1) return null;

  let depth = 0;
  let braceIdx = -1;
  for (let i = parenCloseIdx + 1; i < masked.length; i++) {
    const c = masked[i];
    if (depth === 0 && c === "{") {
      braceIdx = i;
      break;
    }
    if (depth === 0 && c === ";") return null;
    if (c === "(" || c === "{") depth++;
    else if (c === ")" || c === "}") depth--;
  }
  if (braceIdx === -1) return null;

  const braceEndIdx = findMatchingBracket(masked, braceIdx, "{", "}");
  if (braceEndIdx === -1) return null;

  return { parenCloseIdx, braceIdx, braceEndIdx };
}

function extractMethodBody(masked, original, signaturePrefix) {
  const regions = locateFunctionRegions(masked, signaturePrefix);
  if (regions === null) return null;
  return {
    masked: masked.slice(regions.braceIdx + 1, regions.braceEndIdx),
    original: original.slice(regions.braceIdx + 1, regions.braceEndIdx),
  };
}

function extractInitList(masked, original, signaturePrefix) {
  const regions = locateFunctionRegions(masked, signaturePrefix);
  if (regions === null) return null;
  return {
    masked: masked.slice(regions.parenCloseIdx + 1, regions.braceIdx),
    original: original.slice(regions.parenCloseIdx + 1, regions.braceIdx),
  };
}

function countOccurrences(text, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

// --- self-tests (in-memory synthetic strings only, no fixture files) -------
function runSelfTests() {
  const classSample = [
    "class Widget final {",
    " public:",
    "  int value() const { return inner_; }",
    " private:",
    "  int inner_ = 0;",
    "};",
    "",
    "int Widget::helper(int x) {",
    "  // a { comment with braces }",
    '  const char* s = "a { b } c";',
    "  return x + 1;",
    "}",
  ].join("\n");
  const classMasked = maskCommentsAndStrings(classSample);

  const classBody = extractClassBody(classMasked, classSample, "Widget");
  assert(classBody !== null);
  assert(classBody.original.includes("inner_ = 0"));
  assert(!classBody.original.includes("Widget::helper"));

  const methodBody = extractMethodBody(
    classMasked,
    classSample,
    "Widget::helper(",
  );
  assert(methodBody !== null);
  assert(methodBody.original.includes("return x + 1;"));
  assert(countOccurrences(methodBody.masked, "{") === 0);
  assert(countOccurrences(methodBody.masked, "}") === 0);

  // A constructor-style sample with a member-initializer list that itself
  // contains nested parens and brace-init syntax, proving the body-brace
  // scan is not fooled by it.
  const ctorSample = [
    "class Gadget {",
    " public:",
    "  Gadget(int x)",
    "      : value_(Compute(x)),",
    "        info_(Info{1, 2, 3}) {",
    "    consume();",
    "  }",
    " private:",
    "  int value_;",
    "  Info info_;",
    "};",
  ].join("\n");
  const ctorMasked = maskCommentsAndStrings(ctorSample);

  const ctorInit = extractInitList(ctorMasked, ctorSample, "Gadget(");
  assert(ctorInit !== null);
  assert(ctorInit.original.includes("info_(Info{1, 2, 3})"));
  assert(!ctorInit.original.includes("consume()"));

  const ctorBody = extractMethodBody(ctorMasked, ctorSample, "Gadget(");
  assert(ctorBody !== null);
  assert(normalizeWhitespace(ctorBody.original) === "consume();");

  // Duplicate-count guard semantics: non-overlapping, exact-substring scan.
  assert(countOccurrences("aXaXaX", "aXa") === 1);
  assert(countOccurrences("foo(); foo(); foo();", "foo()") === 3);
  assert(countOccurrences("no match here", "zzz") === 0);

  // Models the "reject any second generic constructor declaration" guard:
  // a class body with two same-named constructor declarations must count 2,
  // not be collapsed or miscounted.
  const twoCtorSample = [
    "class Sample {",
    " private:",
    "  Sample(int x);",
    "  Sample(int x, int y);",
    "};",
  ].join("\n");
  assert(countOccurrences(twoCtorSample, "Sample(") === 2);
}

// --- main boundary checks -----------------------------------------------------
function main() {
  runSelfTests();

  const headerSrc = readBoundedUtf8(
    "native/tracker-core/src/tracking_backend.h",
  );
  const cppSrc = readBoundedUtf8(
    "native/tracker-core/src/tracking_backend.cpp",
  );
  const mainSrc = readBoundedUtf8("native/tracker-core/src/main.cpp");

  const headerMasked = maskCommentsAndStrings(headerSrc);
  const cppMasked = maskCommentsAndStrings(cppSrc);
  const mainMasked = maskCommentsAndStrings(mainSrc);

  // --- A. Generic ownership under the OpenCV guard --------------------------
  const guardMarker = "#if LVK_HAS_OPENCV_CAMERA";
  const guardIdx = headerMasked.indexOf(guardMarker);
  assert(guardIdx !== -1);
  const guardEndIdx = headerMasked.indexOf("#endif", guardIdx);
  assert(guardEndIdx !== -1);
  const guardedHeaderMasked = headerMasked.slice(guardIdx, guardEndIdx);
  const guardedHeaderOriginal = headerSrc.slice(guardIdx, guardEndIdx);

  assert(guardedHeaderMasked.includes("class FrameHelperTrackingBackend"));
  assert(guardedHeaderMasked.includes("kMaxFrameHelperBackendLabelBytes = 64"));

  const genericClass = extractClassBody(
    guardedHeaderMasked,
    guardedHeaderOriginal,
    "FrameHelperTrackingBackend",
  );
  assert(genericClass !== null);

  const privateMarkerIdx = genericClass.masked.indexOf("private:");
  assert(privateMarkerIdx !== -1);
  const genericPublicMasked = genericClass.masked.slice(0, privateMarkerIdx);
  const genericPrivateMasked = genericClass.masked.slice(privateMarkerIdx);
  const genericPrivateOriginal = genericClass.original.slice(privateMarkerIdx);

  // The two explicitly trusted friend wrappers (#569 synthetic, #572
  // MediaPipe). Both are named-friend declarations, not logic, so they are
  // stripped out of the forbidden-term scan further below (section E) --
  // otherwise the MediaPipe wrapper's own name would falsely look like
  // "MediaPipe...logic entering generic mechanics" when it is really just
  // the trust boundary declaration itself.
  const trustedFriendDeclarations = [
    "friend class SyntheticFrameHelperTrackingBackend;",
    "friend class MediaPipeFaceLandmarkerHelperTrackingBackend;",
  ];

  // A. Generic public surface: only the TrackingBackend operations are
  // public. There is no public constructor of any shape -- no
  // char-array-reference literal-typed constructor, no const char*, and no
  // std::string label constructor -- so construction access, not parameter
  // typing, is what keeps the label code-owned.
  assert(genericPublicMasked.includes("bool start() override;"));
  assert(genericPublicMasked.includes("void stop() override;"));
  assert(
    genericPublicMasked.includes(
      "TrackingSample track(const PreprocessedFrame& frame) override;",
    ),
  );
  assert(
    genericPublicMasked.includes(
      "const FaceDetectionDiagnostics& lastDetectionDiagnostics() const override;",
    ),
  );
  assert(!genericPublicMasked.includes("FrameHelperTrackingBackend("));
  assert(!genericPublicMasked.includes("template <std::size_t N>"));
  assert(!genericPublicMasked.includes("const char (&backendLabel)[N])"));
  assert(!genericPublicMasked.includes("const char*"));
  assert(!genericPublicMasked.includes("std::string"));
  assert(!genericPublicMasked.includes("backendLabel"));

  // B. Generic private construction: exactly one constructor declaration,
  // private, reachable only through the explicitly trusted friend wrappers.
  for (const friendDeclaration of trustedFriendDeclarations) {
    assert(genericPrivateMasked.includes(friendDeclaration));
  }
  assert(
    countOccurrences(genericClass.masked, "FrameHelperTrackingBackend(") === 1,
  );
  assert(genericPrivateMasked.includes("const char* backendLabel"));
  assert(genericPrivateMasked.includes("std::size_t backendLabelBytes"));
  assert(
    countOccurrences(
      genericPrivateOriginal,
      "HelperProcessSession session_;",
    ) === 1,
  );
  assert(
    countOccurrences(
      genericPrivateOriginal,
      "FaceDetectionDiagnostics diagnostics_;",
    ) === 1,
  );

  assert(!genericClass.masked.includes("std::string"));
  assert(countOccurrences(genericClass.original, "HelperTrackingResult") === 0);
  assert(countOccurrences(genericClass.original, "HelperTrackOutcome") === 0);

  // --- B/E. Safe label handling + boundary isolation (cpp) -------------------
  const anonNamespaceIdx = cppMasked.indexOf("namespace {");
  assert(anonNamespaceIdx !== -1);
  const anonBraceIdx = cppMasked.indexOf("{", anonNamespaceIdx);
  const anonEndIdx = findMatchingBracket(cppMasked, anonBraceIdx, "{", "}");
  assert(anonEndIdx !== -1);
  const anonNamespace = {
    masked: cppMasked.slice(anonBraceIdx + 1, anonEndIdx),
    original: cppSrc.slice(anonBraceIdx + 1, anonEndIdx),
  };

  assert(anonNamespace.masked.includes("isValidFrameHelperBackendLabel"));
  assert(anonNamespace.masked.includes("len == 0"));
  assert(
    anonNamespace.masked.includes("len > kMaxFrameHelperBackendLabelBytes"),
  );
  assert(anonNamespace.original.includes("c >= 'a' && c <= 'z'"));
  assert(anonNamespace.original.includes("c >= '0' && c <= '9'"));
  assert(anonNamespace.original.includes("c == '-'"));
  assert(countOccurrences(anonNamespace.original, '"frame-helper"') === 1);
  assert(!anonNamespace.masked.includes("cerr"));
  assert(!anonNamespace.masked.includes("cout"));

  // The generic constructor's function body is trivially empty ("{}"); the
  // label validation and diagnostics construction happen in its
  // member-initializer list instead.
  const ctorInitList = extractInitList(
    cppMasked,
    cppSrc,
    "FrameHelperTrackingBackend::FrameHelperTrackingBackend(",
  );
  assert(ctorInitList !== null);
  assert(
    ctorInitList.masked.includes(
      "isValidFrameHelperBackendLabel(backendLabel, backendLabelBytes)",
    ),
  );
  assert(!ctorInitList.masked.includes("cerr"));

  const startBody = extractMethodBody(
    cppMasked,
    cppSrc,
    "FrameHelperTrackingBackend::start(",
  );
  const stopBody = extractMethodBody(
    cppMasked,
    cppSrc,
    "FrameHelperTrackingBackend::stop(",
  );
  const trackBody = extractMethodBody(
    cppMasked,
    cppSrc,
    "FrameHelperTrackingBackend::track(",
  );
  const lastDiagBody = extractMethodBody(
    cppMasked,
    cppSrc,
    "FrameHelperTrackingBackend::lastDetectionDiagnostics(",
  );
  assert(startBody !== null);
  assert(stopBody !== null);
  assert(trackBody !== null);
  assert(lastDiagBody !== null);

  assert(startBody.masked.includes("session_.start()"));
  assert(stopBody.masked.includes("session_.stop()"));
  assert(stopBody.masked.includes("shutdownDiagnostic()"));
  assert(lastDiagBody.masked.includes("diagnostics_"));

  // --- C. One implementation source within track() ---------------------------
  assert(countOccurrences(trackBody.masked, "normalizeBgr24Rows(") === 1);
  assert(countOccurrences(trackBody.masked, "session_.trackWithFrame(") === 1);
  assert(
    countOccurrences(
      trackBody.masked,
      "createTrackingSampleFromHelperResult(",
    ) === 2,
  );
  assert(trackBody.masked.includes("std::vector<std::uint8_t> payload;"));
  assert(trackBody.masked.includes("HelperTrackOutcome outcome;"));
  assert(trackBody.masked.includes("HelperTrackingResult lost;"));
  assert(trackBody.masked.includes("lost.timestampMs = frameTimestampMs;"));
  assert(
    trackBody.masked.includes("lost.status = HelperTrackingStatus::Lost;"),
  );
  assert(!trackBody.masked.includes("for ("));
  assert(!trackBody.masked.includes("for("));
  assert(!trackBody.masked.includes("while ("));
  assert(!trackBody.masked.includes("while("));
  assert(!trackBody.masked.includes("static "));

  // Whole-file uniqueness: these two calls are specific to the frame-transport
  // path (distinct from the result-only session_.track() used elsewhere), so
  // a file-wide count of 1 proves no second call site exists anywhere.
  assert(countOccurrences(cppMasked, "normalizeBgr24Rows(") === 1);
  assert(countOccurrences(cppMasked, "session_.trackWithFrame(") === 1);

  // --- D. Thin compatibility wrapper ------------------------------------------
  const wrapperClass = extractClassBody(
    headerMasked,
    headerSrc,
    "SyntheticFrameHelperTrackingBackend",
  );
  assert(wrapperClass !== null);
  assert(
    countOccurrences(
      wrapperClass.original,
      "FrameHelperTrackingBackend backend_;",
    ) === 1,
  );
  assert(countOccurrences(wrapperClass.original, "HelperProcessSession") === 0);
  assert(
    countOccurrences(
      wrapperClass.original,
      "FaceDetectionDiagnostics diagnostics_;",
    ) === 0,
  );
  assert(countOccurrences(wrapperClass.original, "HelperTrackingResult") === 0);
  assert(countOccurrences(wrapperClass.original, "HelperTrackOutcome") === 0);
  assert(
    wrapperClass.masked.includes(
      "explicit SyntheticFrameHelperTrackingBackend(HelperSessionConfig config);",
    ),
  );

  // C. Wrapper construction: the trusted wrapper invokes the private
  // pointer+length constructor directly with one fixed code-owned literal
  // and its compile-time sizeof-derived length -- never strlen, a runtime
  // variable, or a two-argument call.
  const wrapperCtorInit = extractInitList(
    cppMasked,
    cppSrc,
    "SyntheticFrameHelperTrackingBackend::SyntheticFrameHelperTrackingBackend(",
  );
  assert(wrapperCtorInit !== null);
  assert(wrapperCtorInit.masked.includes("backend_("));
  assert(wrapperCtorInit.masked.includes("std::move(config)"));
  assert(
    countOccurrences(wrapperCtorInit.original, '"synthetic-frame-helper"') ===
      2,
  );
  assert(
    normalizeWhitespace(wrapperCtorInit.original).includes(
      'sizeof("synthetic-frame-helper") - 1',
    ),
  );
  assert(countOccurrences(wrapperCtorInit.masked, ",") === 2);
  assert(!wrapperCtorInit.masked.includes("strlen("));
  assert(!wrapperCtorInit.masked.includes("std::string("));

  const wrapperStart = extractMethodBody(
    cppMasked,
    cppSrc,
    "SyntheticFrameHelperTrackingBackend::start(",
  );
  const wrapperStop = extractMethodBody(
    cppMasked,
    cppSrc,
    "SyntheticFrameHelperTrackingBackend::stop(",
  );
  const wrapperTrack = extractMethodBody(
    cppMasked,
    cppSrc,
    "SyntheticFrameHelperTrackingBackend::track(",
  );
  const wrapperLastDiag = extractMethodBody(
    cppMasked,
    cppSrc,
    "SyntheticFrameHelperTrackingBackend::lastDetectionDiagnostics(",
  );
  assert(wrapperStart !== null);
  assert(wrapperStop !== null);
  assert(wrapperTrack !== null);
  assert(wrapperLastDiag !== null);

  assert(
    normalizeWhitespace(wrapperStart.masked) === "return backend_.start();",
  );
  assert(normalizeWhitespace(wrapperStop.masked) === "backend_.stop();");
  assert(
    normalizeWhitespace(wrapperTrack.masked) ===
      "return backend_.track(frame);",
  );
  assert(
    normalizeWhitespace(wrapperLastDiag.masked) ===
      "return backend_.lastDetectionDiagnostics();",
  );

  // --- D2. Second thin trusted wrapper (#572 MediaPipe) -----------------------
  const mediaPipeWrapperClass = extractClassBody(
    headerMasked,
    headerSrc,
    "MediaPipeFaceLandmarkerHelperTrackingBackend",
  );
  assert(mediaPipeWrapperClass !== null);
  assert(
    countOccurrences(
      mediaPipeWrapperClass.original,
      "FrameHelperTrackingBackend backend_;",
    ) === 1,
  );
  assert(
    countOccurrences(mediaPipeWrapperClass.original, "HelperProcessSession") ===
      0,
  );
  assert(
    countOccurrences(
      mediaPipeWrapperClass.original,
      "FaceDetectionDiagnostics diagnostics_;",
    ) === 0,
  );
  assert(
    countOccurrences(mediaPipeWrapperClass.original, "HelperTrackingResult") ===
      0,
  );
  assert(
    countOccurrences(mediaPipeWrapperClass.original, "HelperTrackOutcome") ===
      0,
  );
  assert(
    mediaPipeWrapperClass.masked.includes(
      "explicit MediaPipeFaceLandmarkerHelperTrackingBackend(HelperSessionConfig config);",
    ),
  );

  // C2. MediaPipe wrapper construction: the trusted wrapper invokes the
  // private pointer+length constructor directly with one fixed code-owned
  // literal and its compile-time sizeof-derived length -- never strlen, a
  // runtime variable, or a two-argument call.
  const mediaPipeWrapperCtorInit = extractInitList(
    cppMasked,
    cppSrc,
    "MediaPipeFaceLandmarkerHelperTrackingBackend::" +
      "MediaPipeFaceLandmarkerHelperTrackingBackend(",
  );
  assert(mediaPipeWrapperCtorInit !== null);
  assert(mediaPipeWrapperCtorInit.masked.includes("backend_("));
  assert(mediaPipeWrapperCtorInit.masked.includes("std::move(config)"));
  assert(
    countOccurrences(
      mediaPipeWrapperCtorInit.original,
      '"mediapipe-face-landmarker"',
    ) === 2,
  );
  assert(
    normalizeWhitespace(mediaPipeWrapperCtorInit.original).includes(
      'sizeof("mediapipe-face-landmarker") - 1',
    ),
  );
  assert(countOccurrences(mediaPipeWrapperCtorInit.masked, ",") === 2);
  assert(!mediaPipeWrapperCtorInit.masked.includes("strlen("));
  assert(!mediaPipeWrapperCtorInit.masked.includes("std::string("));

  const mediaPipeWrapperStart = extractMethodBody(
    cppMasked,
    cppSrc,
    "MediaPipeFaceLandmarkerHelperTrackingBackend::start(",
  );
  const mediaPipeWrapperStop = extractMethodBody(
    cppMasked,
    cppSrc,
    "MediaPipeFaceLandmarkerHelperTrackingBackend::stop(",
  );
  const mediaPipeWrapperTrack = extractMethodBody(
    cppMasked,
    cppSrc,
    "MediaPipeFaceLandmarkerHelperTrackingBackend::track(",
  );
  const mediaPipeWrapperLastDiag = extractMethodBody(
    cppMasked,
    cppSrc,
    "MediaPipeFaceLandmarkerHelperTrackingBackend::lastDetectionDiagnostics(",
  );
  assert(mediaPipeWrapperStart !== null);
  assert(mediaPipeWrapperStop !== null);
  assert(mediaPipeWrapperTrack !== null);
  assert(mediaPipeWrapperLastDiag !== null);

  assert(
    normalizeWhitespace(mediaPipeWrapperStart.masked) ===
      "return backend_.start();",
  );
  assert(
    normalizeWhitespace(mediaPipeWrapperStop.masked) === "backend_.stop();",
  );
  assert(
    normalizeWhitespace(mediaPipeWrapperTrack.masked) ===
      "return backend_.track(frame);",
  );
  assert(
    normalizeWhitespace(mediaPipeWrapperLastDiag.masked) ===
      "return backend_.lastDetectionDiagnostics();",
  );

  // --- E. Boundary isolation ---------------------------------------------------
  //
  // The generic class body legitimately names its trusted friend wrappers by
  // class name (including "MediaPipeFaceLandmarkerHelperTrackingBackend",
  // which itself starts with "MediaPipe"). That is a construction-trust
  // declaration, not MediaPipe/Python/path/CLI logic entering generic frame
  // mechanics, so the two friend declarations are stripped out of the region
  // before the forbidden-term scan below -- every other occurrence of a
  // forbidden term anywhere else in the generic class/cpp regions still
  // fails this check.
  let genericClassMaskedForTermScan = genericClass.masked;
  for (const friendDeclaration of trustedFriendDeclarations) {
    assert(genericClassMaskedForTermScan.includes(friendDeclaration));
    genericClassMaskedForTermScan = genericClassMaskedForTermScan.replace(
      friendDeclaration,
      " ".repeat(friendDeclaration.length),
    );
  }

  const genericRegionLower = [
    genericClassMaskedForTermScan,
    anonNamespace.masked,
    ctorInitList.masked,
    startBody.masked,
    stopBody.masked,
    trackBody.masked,
    lastDiagBody.masked,
  ]
    .join(" ")
    .toLowerCase();
  const forbiddenTerms = [
    "mediapipe",
    "python",
    "model",
    "script",
    "argv",
    "helper-executable",
    "lvk_frame_pipe_handle",
  ];
  for (const term of forbiddenTerms) {
    assert(!genericRegionLower.includes(term));
  }

  const genericNameCount = countOccurrences(
    mainMasked,
    "FrameHelperTrackingBackend",
  );
  const syntheticNameCount = countOccurrences(
    mainMasked,
    "SyntheticFrameHelperTrackingBackend",
  );
  const mediaPipeWrapperNameCount = countOccurrences(
    mainMasked,
    "MediaPipeFaceLandmarkerHelperTrackingBackend",
  );
  // The generic name only ever appears as a suffix of one of the two trusted
  // wrapper names in main.cpp -- it proves main.cpp never names the generic
  // FrameHelperTrackingBackend bare. MediaPipeFaceLandmarkerHelperTrackingBackend
  // does not contain "FrameHelperTrackingBackend" as a substring, so it is
  // verified independently below instead of folding into this equality.
  assert(genericNameCount === syntheticNameCount);
  assert(syntheticNameCount >= 1);
  assert(mediaPipeWrapperNameCount >= 1);
  assert(
    mainMasked.includes(
      "make_unique<lvk::tracker::SyntheticFrameHelperTrackingBackend>",
    ),
  );
  assert(
    mainMasked.includes(
      "make_unique<lvk::tracker::MediaPipeFaceLandmarkerHelperTrackingBackend>",
    ),
  );
  // Main composition: the MediaPipe wrapper is only ever constructed from
  // the sole #570 factory's successful result, moved in -- never a
  // default-constructed or ad hoc HelperSessionConfig.
  assert(mainMasked.includes("createMediaPipeHelperRouteConfig("));
  assert(
    normalizeWhitespace(mainSrc).includes(
      "std::make_unique<lvk::tracker::MediaPipeFaceLandmarkerHelperTrackingBackend>( std::move(*mediaPipeHelperRouteConfig));",
    ),
  );
}

try {
  main();
  process.stdout.write("Native frame-helper backend boundary check passed.\n");
  process.exit(0);
} catch {
  process.stderr.write("Native frame-helper backend boundary check failed.\n");
  process.exit(1);
}
