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

// v0.13.0 (#589): locates the FIRST `#ifdef ${guard} ... #endif` block within
// `masked`/`original` (guard directives are never masked -- only comments and
// string literals are). Returns the content strictly between the `#ifdef`
// line's marker and the matching `#endif`, in both masked and original form,
// so callers can both search it (masked, comment-free) and quote it
// (original). Used to prove the #589 test-only lifecycle accessors live only
// inside the existing LVK_HELPER_LIFECYCLE_TEST_SEAM guard.
function extractIfdefBlock(masked, original, guard) {
  const marker = `#ifdef ${guard}`;
  const startIdx = masked.indexOf(marker);
  if (startIdx === -1) return null;
  const endMarker = "#endif";
  const endIdx = masked.indexOf(endMarker, startIdx);
  if (endIdx === -1) return null;
  const contentStart = startIdx + marker.length;
  return {
    masked: masked.slice(contentStart, endIdx),
    original: original.slice(contentStart, endIdx),
  };
}

// v0.13.0 (#589): finds the MATCHING `#endif` for a `#if`/`#ifdef`/`#ifndef`
// directive starting at `ifDirectiveIdx`, tracking nested #if*/#endif depth
// (masked text keeps every real directive, since only comments/string
// literals are masked out, so this only ever sees genuine directives). Plain
// `masked.indexOf("#endif", ifDirectiveIdx)` -- the pre-#589 approach -- only
// finds the FIRST #endif, which is wrong once nested guards (e.g. the #589
// LVK_HELPER_LIFECYCLE_TEST_SEAM blocks inside the outer LVK_HAS_OPENCV_CAMERA
// guard) exist. "#if" is a safe common prefix for #if/#ifdef/#ifndef and is
// never a substring of "#endif" itself, so a single prefix scan finds all
// three opener forms without extra cases. Returns -1 if unbalanced.
function findMatchingEndif(masked, ifDirectiveIdx) {
  let depth = 1;
  let i = ifDirectiveIdx + 1;
  while (i < masked.length) {
    const nestedIfIdx = masked.indexOf("#if", i);
    const endIdx = masked.indexOf("#endif", i);
    if (endIdx === -1) return -1;
    if (nestedIfIdx !== -1 && nestedIfIdx < endIdx) {
      depth++;
      i = nestedIfIdx + 3;
      continue;
    }
    depth--;
    if (depth === 0) return endIdx;
    i = endIdx + 6;
  }
  return -1;
}

// The complement of extractIfdefBlock: returns `masked` with the ENTIRE first
// `#ifdef ${guard} ... #endif` span (markers included) blanked out to spaces
// of the same length, so callers can assert that a guarded-only symbol never
// appears anywhere else in the surrounding region (production-build
// isolation). A missing block is a no-op (returns `masked` unchanged) so this
// stays safe to call defensively.
function stripIfdefBlock(masked, guard) {
  const marker = `#ifdef ${guard}`;
  const startIdx = masked.indexOf(marker);
  if (startIdx === -1) return masked;
  const endMarker = "#endif";
  const endIdx = masked.indexOf(endMarker, startIdx);
  if (endIdx === -1) return masked;
  const blockEnd = endIdx + endMarker.length;
  return (
    masked.slice(0, startIdx) +
    " ".repeat(blockEnd - startIdx) +
    masked.slice(blockEnd)
  );
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

  // #589: #ifdef ... #endif block extraction / stripping self-test.
  const ifdefSample = [
    "class Seam {",
    " public:",
    "#ifdef LVK_TEST_GUARD",
    "  int guarded() { return 1; }",
    "#endif",
    "  int visible() { return 2; }",
    "};",
  ].join("\n");
  const ifdefMasked = maskCommentsAndStrings(ifdefSample);
  const ifdefBlock = extractIfdefBlock(
    ifdefMasked,
    ifdefSample,
    "LVK_TEST_GUARD",
  );
  assert(ifdefBlock !== null);
  assert(ifdefBlock.original.includes("guarded()"));
  assert(!ifdefBlock.original.includes("visible()"));
  const strippedIfdef = stripIfdefBlock(ifdefMasked, "LVK_TEST_GUARD");
  assert(!strippedIfdef.includes("guarded"));
  assert(strippedIfdef.includes("visible"));

  // #589: findMatchingEndif must skip nested #if*/#endif pairs and return the
  // OUTER matching #endif, not the first one encountered.
  const nestedGuardSample = [
    "#if OUTER",
    "before",
    "#ifdef INNER",
    "inner-only",
    "#endif",
    "after",
    "#endif",
    "outside",
  ].join("\n");
  const outerIfIdx = nestedGuardSample.indexOf("#if OUTER");
  const outerEndifIdx = findMatchingEndif(nestedGuardSample, outerIfIdx);
  assert(outerEndifIdx !== -1);
  assert(nestedGuardSample.slice(outerIfIdx, outerEndifIdx).includes("after"));
  assert(
    !nestedGuardSample.slice(outerIfIdx, outerEndifIdx).includes("outside"),
  );
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
  // #589: nesting-aware -- the guarded region now legitimately contains two
  // nested `#ifdef LVK_HELPER_LIFECYCLE_TEST_SEAM` blocks (one per class), so
  // the matching #endif is no longer simply the first one encountered.
  const guardEndIdx = findMatchingEndif(headerMasked, guardIdx);
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
  // #589: the recovery policy is private-only; the public surface never
  // names it, so no caller can select or observe it from outside this class.
  assert(!genericPublicMasked.includes("RecoveryPolicy"));

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

  // #589: the closed, code-owned recovery policy. Declared only under
  // private:, so the public surface (checked above) can never name or select
  // it -- no string-derived, CLI-derived, config-derived, or public policy
  // selection is possible from outside this class.
  assert(genericPrivateMasked.includes("enum class RecoveryPolicy {"));
  const recoveryPolicyEnumIdx = genericPrivateMasked.indexOf(
    "enum class RecoveryPolicy {",
  );
  const recoveryPolicyBraceIdx = genericPrivateMasked.indexOf(
    "{",
    recoveryPolicyEnumIdx,
  );
  const recoveryPolicyEndIdx = findMatchingBracket(
    genericPrivateMasked,
    recoveryPolicyBraceIdx,
    "{",
    "}",
  );
  assert(recoveryPolicyEndIdx !== -1);
  assert(
    normalizeWhitespace(
      genericPrivateOriginal.slice(
        recoveryPolicyBraceIdx + 1,
        recoveryPolicyEndIdx,
      ),
    ) === "Disabled, SingleAttempt,",
  );
  assert(genericPrivateMasked.includes("RecoveryPolicy recoveryPolicy);"));

  // #589: session_ is now an owning pointer (not a value member), so the
  // single approved recovery attempt can destroy a failed generation through
  // the existing ~HelperProcessSession() and construct a fresh one from the
  // retained config. The old value-member form is explicitly rejected, not
  // merely left unchecked. retainedConfig_ must be declared before session_
  // so it is fully initialized before the initial session moves from it.
  assert(
    countOccurrences(
      genericPrivateOriginal,
      "std::unique_ptr<HelperProcessSession> session_;",
    ) === 1,
  );
  assert(!genericPrivateOriginal.includes("HelperProcessSession session_;"));
  assert(
    countOccurrences(
      genericPrivateOriginal,
      "HelperSessionConfig retainedConfig_;",
    ) === 1,
  );
  const retainedConfigDeclIdx = genericPrivateOriginal.indexOf(
    "HelperSessionConfig retainedConfig_;",
  );
  const sessionPtrDeclIdx = genericPrivateOriginal.indexOf(
    "std::unique_ptr<HelperProcessSession> session_;",
  );
  assert(retainedConfigDeclIdx !== -1 && sessionPtrDeclIdx !== -1);
  assert(retainedConfigDeclIdx < sessionPtrDeclIdx);
  assert(
    countOccurrences(
      genericPrivateOriginal,
      "FaceDetectionDiagnostics diagnostics_;",
    ) === 1,
  );
  assert(
    countOccurrences(
      genericPrivateOriginal,
      "const RecoveryPolicy recoveryPolicy_;",
    ) === 1,
  );
  assert(
    countOccurrences(genericPrivateOriginal, "int recoveryBudget_;") === 1,
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

  // #589: exact ownership/recovery-state initialization -- retainedConfig_
  // copies `config` (still intact at this point in the init list) before
  // session_ moves from it; recoveryBudget_ is the finite, closed-form budget
  // (exactly 1 for SingleAttempt, exactly 0 otherwise -- never a raw literal,
  // a caller-supplied count, or any other derivation).
  assert(ctorInitList.masked.includes("retainedConfig_(config)"));
  assert(
    ctorInitList.masked.includes(
      "session_(std::make_unique<HelperProcessSession>(std::move(config)))",
    ),
  );
  assert(ctorInitList.masked.includes("recoveryPolicy_(recoveryPolicy)"));
  assert(
    normalizeWhitespace(ctorInitList.original).includes(
      "recoveryBudget_( recoveryPolicy == RecoveryPolicy::SingleAttempt ? 1 : 0)",
    ),
  );

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
  const recoverBody = extractMethodBody(
    cppMasked,
    cppSrc,
    "FrameHelperTrackingBackend::maybeRecoverAfterResultTimeout(",
  );
  assert(startBody !== null);
  assert(stopBody !== null);
  assert(trackBody !== null);
  assert(lastDiagBody !== null);
  assert(recoverBody !== null);

  // #589: session_ is a pointer now -- every owner-boundary entry point uses
  // the approved `session_->` call shape (never the old value-member `.`
  // shape) and is null-safe / fail-closed.
  assert(startBody.masked.includes("session_->start()"));
  assert(!startBody.masked.includes("session_.start()"));
  assert(startBody.masked.includes("if (!session_) {"));
  assert(stopBody.masked.includes("session_->stop()"));
  assert(!stopBody.masked.includes("session_.stop()"));
  assert(stopBody.masked.includes("session_->shutdownDiagnostic()"));
  assert(stopBody.masked.includes("if (!session_) {"));
  assert(lastDiagBody.masked.includes("diagnostics_"));

  // #589: exact recovery boundary -- the single evaluation point relies on
  // the closed policy, the finite budget, the per-generation #587
  // disposition, and the exact ResultTimeout terminal state; then tears down
  // through the existing owning-pointer reset and reconstructs from the
  // retained config, re-arming only via the existing arming helper.
  assert(recoverBody.masked.includes("RecoveryPolicy::SingleAttempt"));
  assert(recoverBody.masked.includes("recoveryBudget_"));
  assert(
    recoverBody.masked.includes(
      "HelperTerminalDiagnosticDisposition::Reported",
    ),
  );
  assert(recoverBody.masked.includes("HelperSessionState::Failed"));
  assert(
    recoverBody.masked.includes("HelperDiagnosticCategory::ResultTimeout"),
  );
  assert(recoverBody.masked.includes("session_.reset()"));
  assert(
    recoverBody.masked.includes(
      "HelperTerminalDiagnosticDisposition::SuppressedUntilStarted",
    ),
  );
  assert(
    recoverBody.masked.includes(
      "std::make_unique<HelperProcessSession>(retainedConfig_)",
    ),
  );
  assert(recoverBody.masked.includes("armHelperSessionTerminalDiagnostic("));

  // --- C. One implementation source within track() ---------------------------
  assert(countOccurrences(trackBody.masked, "normalizeBgr24Rows(") === 1);
  assert(countOccurrences(trackBody.masked, "session_->trackWithFrame(") === 1);
  assert(!trackBody.masked.includes("session_.trackWithFrame("));
  // #589: the recovery attempt adds exactly one more safe-fallback return
  // (the null-session fail-closed path), so the existing two-mapping-call
  // count becomes three -- still the ONLY three mapping call sites, and the
  // "lost" fallback construction now appears twice (once for the null-session
  // path, once for the existing outcome.ok==false path).
  assert(
    countOccurrences(
      trackBody.masked,
      "createTrackingSampleFromHelperResult(",
    ) === 3,
  );
  assert(trackBody.masked.includes("std::vector<std::uint8_t> payload;"));
  assert(trackBody.masked.includes("HelperTrackOutcome outcome;"));
  assert(
    countOccurrences(trackBody.masked, "HelperTrackingResult lost;") === 2,
  );
  assert(
    countOccurrences(
      trackBody.masked,
      "lost.timestampMs = frameTimestampMs;",
    ) === 2,
  );
  assert(
    countOccurrences(
      trackBody.masked,
      "lost.status = HelperTrackingStatus::Lost;",
    ) === 2,
  );
  assert(!trackBody.masked.includes("for ("));
  assert(!trackBody.masked.includes("for("));
  assert(!trackBody.masked.includes("while ("));
  assert(!trackBody.masked.includes("while("));
  assert(!trackBody.masked.includes("static "));

  // #589: the single recovery evaluation happens exactly once, strictly
  // before the null-session fail-closed check and before frame
  // normalization/exchange -- so the rest of the method only ever observes a
  // post-recovery session (a fresh replacement, or fail-closed null), never a
  // stale pre-recovery one.
  assert(
    countOccurrences(trackBody.masked, "maybeRecoverAfterResultTimeout()") ===
      1,
  );
  const recoverCallIdx = trackBody.masked.indexOf(
    "maybeRecoverAfterResultTimeout();",
  );
  const nullSessionCheckIdx = trackBody.masked.indexOf("if (!session_) {");
  const normalizeCallIdx = trackBody.masked.indexOf("normalizeBgr24Rows(");
  const frameExchangeCallIdx = trackBody.masked.indexOf(
    "session_->trackWithFrame(",
  );
  assert(recoverCallIdx !== -1);
  assert(nullSessionCheckIdx !== -1);
  assert(normalizeCallIdx !== -1);
  assert(frameExchangeCallIdx !== -1);
  assert(recoverCallIdx < nullSessionCheckIdx);
  assert(recoverCallIdx < normalizeCallIdx);
  assert(recoverCallIdx < frameExchangeCallIdx);

  // Whole-file uniqueness: these two calls are specific to the frame-transport
  // path (distinct from the result-only session_.track() used elsewhere), so
  // a file-wide count of 1 proves no second call site exists anywhere. The old
  // value-member call shape must never reappear anywhere in the file.
  assert(countOccurrences(cppMasked, "normalizeBgr24Rows(") === 1);
  assert(countOccurrences(cppMasked, "session_->trackWithFrame(") === 1);
  assert(countOccurrences(cppMasked, "session_.trackWithFrame(") === 0);

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
  // #589: the synthetic frame-helper route stays Disabled -- a fixed,
  // code-owned literal, never a variable, config field, or CLI-derived value.
  assert(
    countOccurrences(
      wrapperCtorInit.original,
      "FrameHelperTrackingBackend::RecoveryPolicy::Disabled",
    ) === 1,
  );
  assert(!wrapperCtorInit.original.includes("RecoveryPolicy::SingleAttempt"));
  assert(countOccurrences(wrapperCtorInit.masked, ",") === 3);
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
  // #589: the MediaPipe route is the sole approved SingleAttempt opt-in -- a
  // fixed, code-owned literal, never a variable, config field, or CLI-derived
  // value.
  assert(
    countOccurrences(
      mediaPipeWrapperCtorInit.original,
      "FrameHelperTrackingBackend::RecoveryPolicy::SingleAttempt",
    ) === 1,
  );
  assert(
    !mediaPipeWrapperCtorInit.original.includes("RecoveryPolicy::Disabled"),
  );
  assert(countOccurrences(mediaPipeWrapperCtorInit.masked, ",") === 3);
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

  // --- F. Test-only lifecycle observability surface (#589) -------------------
  //
  // The bounded-recovery smoke needs to observe generation cleanup and the
  // remaining recovery budget without a new HelperProcessSession seam. Both
  // accessors are permitted ONLY inside the existing
  // LVK_HELPER_LIFECYCLE_TEST_SEAM guard (defined solely on the recovery smoke
  // target, never on lvk-tracker-core) and must expose no raw pid/HANDLE/
  // path/frame/diagnostic detail -- only a bool and the remaining int budget.
  const LIFECYCLE_TEST_SEAM_GUARD = "LVK_HELPER_LIFECYCLE_TEST_SEAM";

  const genericSeamBlock = extractIfdefBlock(
    genericClass.masked,
    genericClass.original,
    LIFECYCLE_TEST_SEAM_GUARD,
  );
  assert(genericSeamBlock !== null);
  assert(genericSeamBlock.masked.includes("testOnlyDirectlyOwnsChild"));
  assert(genericSeamBlock.masked.includes("testOnlyRemainingRecoveryBudget"));

  const mediaPipeSeamBlock = extractIfdefBlock(
    mediaPipeWrapperClass.masked,
    mediaPipeWrapperClass.original,
    LIFECYCLE_TEST_SEAM_GUARD,
  );
  assert(mediaPipeSeamBlock !== null);
  assert(mediaPipeSeamBlock.masked.includes("testOnlyDirectlyOwnsChild"));
  assert(mediaPipeSeamBlock.masked.includes("testOnlyRemainingRecoveryBudget"));

  // Masked (comment-free) code-only scan: the accessor bodies themselves must
  // never touch a raw handle/pid/path/frame/diagnostic value. (The doc
  // comments above them legitimately DISCLAIM exposing those things in
  // English prose -- using the masked text, not the original, keeps that
  // prose from ever being able to trip this check.)
  const seamForbiddenTerms = ["pid", "handle", "path", "frame", "diag"];
  for (const block of [genericSeamBlock, mediaPipeSeamBlock]) {
    const lowerCode = block.masked.toLowerCase();
    for (const term of seamForbiddenTerms) {
      assert(!lowerCode.includes(term));
    }
  }

  // Production-build isolation: outside the guarded block, neither class ever
  // names the test-only accessors, and the .cpp translation unit (always
  // compiled into lvk-tracker-core) never references them either.
  assert(
    !stripIfdefBlock(genericClass.masked, LIFECYCLE_TEST_SEAM_GUARD).includes(
      "testOnly",
    ),
  );
  assert(
    !stripIfdefBlock(
      mediaPipeWrapperClass.masked,
      LIFECYCLE_TEST_SEAM_GUARD,
    ).includes("testOnly"),
  );
  assert(!cppMasked.includes("testOnly"));

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
    recoverBody.masked,
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
