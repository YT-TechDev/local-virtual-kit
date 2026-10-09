#!/usr/bin/env node
// Electron helper-session diagnostic preservation checker (#589 follow-up).
//
// Protects the Electron native-process ownership boundary that parses tracker
// stderr and preserves the fixed, privacy-safe Native Core [helper-session]
// lifecycle diagnostics separately from periodic [pipeline]/[camera] status
// text, so later status lines can no longer overwrite them.
//
// Two layers:
//   A. Behavioral -- extracts the actual matcher source (HELPER_SESSION_*
//      constants + matchHelperSessionDiagnosticLine()) from nativePipeline.ts
//      and evaluates it directly (the block is plain JS once "as const" is
//      stripped), then runs real regex matches against fixed-form lines,
//      the unrelated "shutdown incomplete" diagnostic, ordinary periodic
//      status lines, and label-injection attempts.
//   B. Source-level -- confirms stderr is consumed line-by-line via
//      readline (not raw Buffer chunks), that a bounded store exists and is
//      capped, that it is reset on every new pipeline start, and that the
//      preload contract + renderer expose it.
//
// Source-level only for layer B (no Electron/tsc build dependency), matching
// the existing check-electron-native-runtime-status-contract.mjs approach.
// Dependency-free: Node built-ins only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const nativePipelinePath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "main",
  "nativePipeline.ts",
);
const preloadApiPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "preload",
  "api.ts",
);
const appRendererPath = join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "renderer",
  "src",
  "App.tsx",
);

const fail = (message) => {
  console.error(
    `Electron helper-session diagnostic preservation check failed: ${message}`,
  );
  process.exit(1);
};

const pipelineSrc = readFileSync(nativePipelinePath, "utf8");
const preloadSrc = readFileSync(preloadApiPath, "utf8");
const appSrc = readFileSync(appRendererPath, "utf8");

const requireMatch = (src, pattern, message) => {
  if (!pattern.test(src)) {
    fail(message);
  }
};

// ---------------------------------------------------------------------------
// A. Behavioral -- extract and evaluate the real matcher
// ---------------------------------------------------------------------------

const blockStart = pipelineSrc.indexOf("const HELPER_SESSION_CATEGORY_LABELS");
const blockEnd = pipelineSrc.indexOf(
  "\n}",
  pipelineSrc.indexOf("function matchHelperSessionDiagnosticLine"),
);

if (blockStart === -1 || blockEnd === -1) {
  fail(
    "could not locate the HELPER_SESSION_* constants / matchHelperSessionDiagnosticLine() block in nativePipeline.ts",
  );
}

const rawBlock = pipelineSrc.slice(blockStart, blockEnd + 2);
// Strip the TS-only constructs this block uses so it can run as plain JS.
const evaluableBlock = rawBlock
  .replace(/\s+as const/gu, "")
  .replace(/:\s*readonly RegExp\[\]/gu, "")
  .replace(/\(line:\s*string\)/gu, "(line)")
  .replace(/:\s*string\s*\|\s*null/gu, "");

let matchHelperSessionDiagnosticLine;
try {
  // eslint-disable-next-line no-new-func -- controlled, source-derived, test-only evaluation.
  matchHelperSessionDiagnosticLine = new Function(
    `${evaluableBlock}\nreturn matchHelperSessionDiagnosticLine;`,
  )();
} catch (error) {
  fail(
    `could not evaluate the extracted matcher block: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (typeof matchHelperSessionDiagnosticLine !== "function") {
  fail("extracted matchHelperSessionDiagnosticLine is not a function");
}

const assertMatches = (line, label) => {
  const result = matchHelperSessionDiagnosticLine(line);
  if (result !== line.trim()) {
    fail(`${label}: expected ${JSON.stringify(line)} to be recognized`);
  }
};

const assertRejects = (line, label) => {
  const result = matchHelperSessionDiagnosticLine(line);
  if (result !== null) {
    fail(
      `${label}: expected ${JSON.stringify(line)} to be rejected, got ${JSON.stringify(result)}`,
    );
  }
};

const categoryLabels = [
  "none",
  "launch-failure",
  "ready-timeout",
  "malformed-message",
  "result-timeout",
  "child-exit",
  "shutdown-timeout",
  "frame-write-timeout",
  "frame-ack-mismatch",
];
const dispositionLabels = [
  "not-applicable",
  "confirmed-release",
  "deferred-registry-transfer",
  "unknown",
];

for (const label of categoryLabels) {
  assertMatches(
    `[helper-session] session failed (category=${label})`,
    `session failed / category=${label}`,
  );
  assertMatches(
    `[helper-session] recovery failed (category=${label})`,
    `recovery failed / category=${label}`,
  );
}
for (const label of dispositionLabels) {
  assertMatches(
    `[helper-session] recovery gen1-cleanup (disposition=${label})`,
    `recovery gen1-cleanup / disposition=${label}`,
  );
}
assertMatches("[helper-session] recovery succeeded", "recovery succeeded");

// Only the five fixed forms are recognized -- the unrelated
// "shutdown incomplete" diagnostic, ordinary periodic status lines, and
// label-injection attempts must never enter the bounded evidence store.
assertRejects(
  "[helper-session] shutdown incomplete (category=child-exit)",
  "unrelated shutdown-incomplete diagnostic",
);
assertRejects(
  "[pipeline] status frame=120 fps=29.8",
  "periodic pipeline status line",
);
assertRejects(
  "[camera] status opened=true width=640 height=480",
  "periodic camera status line",
);
assertRejects(
  "[helper-session] session failed (category=arbitrary-injected-text)",
  "non-fixed category label",
);
assertRejects(
  "[helper-session] session failed (category=launch-failure) /Users/dev/secret/path",
  "trailing raw text appended to a fixed form",
);
assertRejects("totally unrelated stderr noise", "arbitrary unrelated stderr");

// --- #616: the fifth fixed form, "[helper-session] failure timing (...)" ---

const timingKeys = [
  "exchanges",
  "ageMs",
  "writeMs",
  "maxGapMs",
  "overshootMs",
  "lastWaitMs",
  "maxWaitMs",
  "slowWaits",
  "lastInferenceMs",
  "maxInferenceMs",
];
const optionalTimingKeys = new Set([
  "lastWaitMs",
  "maxWaitMs",
  "lastInferenceMs",
  "maxInferenceMs",
]);
const canonicalTimingValues = {
  exchanges: "3",
  ageMs: "147",
  writeMs: "1",
  maxGapMs: "18",
  overshootMs: "14",
  lastWaitMs: "13",
  maxWaitMs: "15",
  slowWaits: "0",
  lastInferenceMs: "0",
  maxInferenceMs: "12",
};
const buildTimingLine = ({
  generation = "1",
  values = canonicalTimingValues,
  keys = timingKeys,
  separator = ", ",
  prefix = "[helper-session] failure timing (",
  suffix = ")",
} = {}) =>
  `${prefix}generation=${generation}${separator}${keys
    .map((key) => `${key}=${values[key]}`)
    .join(separator)}${suffix}`;
const withValue = (key, value) => ({ ...canonicalTimingValues, [key]: value });

// Canonical generation 1 and 2 records, all-"na" first-exchange failure,
// boundary values, and saturation.
assertMatches(buildTimingLine(), "timing / canonical generation=1");
assertMatches(
  buildTimingLine({ generation: "2" }),
  "timing / canonical generation=2",
);
const firstExchangeFailure = {
  ...canonicalTimingValues,
  exchanges: "0",
  lastWaitMs: "na",
  maxWaitMs: "na",
  lastInferenceMs: "na",
  maxInferenceMs: "na",
};
assertMatches(
  buildTimingLine({ generation: "2", values: firstExchangeFailure }),
  "timing / generation=2 exchanges=0 with na fields",
);
for (const key of timingKeys) {
  assertMatches(
    buildTimingLine({ values: withValue(key, "0") }),
    `timing / ${key}=0`,
  );
  assertMatches(
    buildTimingLine({ values: withValue(key, "999999999") }),
    `timing / ${key}=999999999 (saturation cap)`,
  );
  if (optionalTimingKeys.has(key)) {
    assertMatches(
      buildTimingLine({ values: withValue(key, "na") }),
      `timing / ${key}=na`,
    );
  } else {
    assertRejects(
      buildTimingLine({ values: withValue(key, "na") }),
      `timing / na is not allowed for ${key}`,
    );
  }
  // Signed, leading-zero, too-many-digit, fractional, exponent, hex,
  // whitespace-padded, empty, and non-literal "na" values.
  for (const bad of [
    "-1",
    "+1",
    "01",
    "00",
    "1000000000",
    "9999999999",
    "1.5",
    "1e3",
    "0x1",
    " 1",
    "1 ",
    "",
    "NA",
    "n/a",
    "null",
  ]) {
    assertRejects(
      buildTimingLine({ values: withValue(key, bad) }),
      `timing / invalid ${key}=${JSON.stringify(bad)}`,
    );
  }
}

// Invalid generations.
for (const generation of ["0", "3", "01", "-1", "12", "", "na", "1.0"]) {
  assertRejects(
    buildTimingLine({ generation }),
    `timing / invalid generation=${JSON.stringify(generation)}`,
  );
}

// Changed key order, missing keys, duplicated/extra keys, renamed keys.
assertRejects(
  buildTimingLine({ keys: [...timingKeys].reverse() }),
  "timing / reversed key order",
);
assertRejects(
  buildTimingLine({
    keys: [
      "ageMs",
      "exchanges",
      ...timingKeys.filter((key) => key !== "ageMs" && key !== "exchanges"),
    ],
  }),
  "timing / two adjacent keys swapped",
);
for (const key of timingKeys) {
  assertRejects(
    buildTimingLine({ keys: timingKeys.filter((other) => other !== key) }),
    `timing / missing ${key}`,
  );
}
assertRejects(
  buildTimingLine({ keys: [...timingKeys, "maxInferenceMs"] }),
  "timing / duplicated trailing key",
);
assertRejects(
  buildTimingLine({
    keys: [...timingKeys, "extraMs"],
    values: { ...canonicalTimingValues, extraMs: "1" },
  }),
  "timing / extra key",
);
assertRejects(
  buildTimingLine({
    keys: timingKeys.map((key) => (key === "ageMs" ? "AgeMs" : key)),
    values: { ...canonicalTimingValues, AgeMs: "147" },
  }),
  "timing / key case changed",
);
assertRejects(
  `[helper-session] failure timing (exchanges=3, ${buildTimingLine()
    .slice("[helper-session] failure timing (".length)
    .replace("exchanges=3, ", "")}`,
  "timing / generation moved out of first position",
);

// Malformed spacing, delimiters, parentheses, and prefix.
for (const [separator, label] of [
  [",", "missing space after comma"],
  [",  ", "double space after comma"],
  [" , ", "space before comma"],
  ["; ", "semicolon delimiter"],
  ["\t", "tab delimiter"],
]) {
  assertRejects(buildTimingLine({ separator }), `timing / ${label}`);
}
assertRejects(
  buildTimingLine({ prefix: "[helper-session] failure timing(" }),
  "timing / missing space before parenthesis",
);
assertRejects(
  buildTimingLine({ prefix: "[helper-session] failure  timing (" }),
  "timing / doubled inner space",
);
assertRejects(
  buildTimingLine({ prefix: "[helper-session] Failure timing (" }),
  "timing / changed prefix case",
);
assertRejects(
  buildTimingLine({ prefix: "[helper-session] failure timing " }),
  "timing / missing opening parenthesis",
);
assertRejects(
  buildTimingLine({ suffix: "" }),
  "timing / missing closing parenthesis",
);
assertRejects(
  buildTimingLine().replace("generation=1", "generation = 1"),
  "timing / spaces around '='",
);
assertRejects(
  buildTimingLine().replace("ageMs=", "ageMs:"),
  "timing / ':' instead of '='",
);

// Arbitrary prefixes/suffixes, including private paths and helper text.
for (const suffix of [
  " /Users/dev/secret/path",
  " C:\\Users\\dev\\secret\\model.task",
  ")",
  " extra",
  ", note=private",
  " [helper] raw child stderr",
]) {
  assertRejects(
    `${buildTimingLine()}${suffix}`,
    `timing / trailing ${JSON.stringify(suffix)}`,
  );
}
assertRejects(
  `prefix ${buildTimingLine()}`,
  "timing / arbitrary text before the fixed form",
);
assertRejects(
  `${buildTimingLine()}\n[helper-session] recovery succeeded`,
  "timing / embedded newline followed by another form",
);

console.log(
  "Behavioral guard OK: matchHelperSessionDiagnosticLine() recognizes only the five fixed " +
    "[helper-session] forms with fixed labels and the closed #616 timing grammar " +
    "(generation=1|2, saturated decimals, na only for the four successful-exchange fields), " +
    "and rejects the unrelated shutdown-incomplete diagnostic, periodic status lines, " +
    "label-injection, invalid generations/numbers, key reordering, missing/extra keys, " +
    "malformed spacing, and trailing raw text or private paths.",
);

// ---------------------------------------------------------------------------
// B. Source-level -- stderr line parsing, bounded reset store, contract, UI
// ---------------------------------------------------------------------------

requireMatch(
  pipelineSrc,
  /this\.trackerStderrReader\s*=\s*createInterface\(\{\s*input:\s*this\.trackerProcess\.stderr/u,
  "start() must consume tracker stderr via a readline createInterface(), not raw Buffer chunks",
);

requireMatch(
  pipelineSrc,
  /this\.trackerStderrReader\.on\(\s*['"]line['"]/u,
  "tracker stderr readline interface must be consumed line-by-line via .on('line', ...)",
);

if (/childProcess\.stderr\.on\(\s*['"]data['"]/u.test(pipelineSrc)) {
  fail(
    "nativePipeline.ts must not consume tracker stderr as raw Buffer chunks via childProcess.stderr.on('data', ...) anymore",
  );
}

requireMatch(
  pipelineSrc,
  /private\s+handleTrackerStderrLine\s*\(\s*line:\s*string\s*\)\s*:\s*void/u,
  "NativePipelineManager must define handleTrackerStderrLine(line: string): void",
);

requireMatch(
  pipelineSrc,
  /const\s+MAX_HELPER_SESSION_DIAGNOSTICS\s*=\s*\d+/u,
  "nativePipeline.ts must define a bounded MAX_HELPER_SESSION_DIAGNOSTICS constant",
);

// #616: the existing 20-entry bound is retained unchanged, and it holds the
// largest fixed sequence one pipeline run can produce (six lines: per
// generation a session-failed line plus its timing line, plus the single
// recovery's gen1-cleanup and outcome lines).
const maxHelperSessionDiagnostics = Number(
  /const\s+MAX_HELPER_SESSION_DIAGNOSTICS\s*=\s*(\d+)/u.exec(pipelineSrc)?.[1],
);
if (maxHelperSessionDiagnostics !== 20) {
  fail(
    `MAX_HELPER_SESSION_DIAGNOSTICS must stay exactly 20 (found ${maxHelperSessionDiagnostics})`,
  );
}

requireMatch(
  pipelineSrc,
  /appendHelperSessionDiagnostic[\s\S]{0,400}?next\.length\s*>\s*MAX_HELPER_SESSION_DIAGNOSTICS/u,
  "appendHelperSessionDiagnostic must enforce the MAX_HELPER_SESSION_DIAGNOSTICS bound",
);

requireMatch(
  pipelineSrc,
  /private\s+helperSessionDiagnostics:\s*string\[\]\s*=\s*\[\]/u,
  "NativePipelineManager must keep helperSessionDiagnostics as an in-memory string[] field",
);

// New pipeline start must reset the bounded store so a fresh lifecycle cannot
// inherit stale evidence from a previous run.
requireMatch(
  pipelineSrc,
  /this\.isStopping\s*=\s*false\s*\n\s*this\.helperSessionDiagnostics\s*=\s*\[\]/u,
  "start() must reset this.helperSessionDiagnostics = [] for every new pipeline start",
);

requireMatch(
  pipelineSrc,
  /helperSessionDiagnostics:\s*\[\]/u,
  "createInitialStatus() must include helperSessionDiagnostics: []",
);

// --- Preload contract ---

requireMatch(
  preloadSrc,
  /helperSessionDiagnostics\?:\s*string\[\]/u,
  "preload/api.ts LvkRuntimeStatus must include optional helperSessionDiagnostics: string[]",
);

// --- Renderer exposure ---

requireMatch(
  appSrc,
  /runtimeStatus\.helperSessionDiagnostics/u,
  "App.tsx must read runtimeStatus.helperSessionDiagnostics",
);

requireMatch(
  appSrc,
  /Helper session diagnostics/u,
  'App.tsx must include a "Helper session diagnostics" label',
);

console.log(
  "Source guard OK: tracker stderr is parsed line-by-line via readline (no raw Buffer-chunk " +
    "diagnostic parsing remains); helperSessionDiagnostics is a bounded, in-memory-only store " +
    "reset on every new pipeline start; createInitialStatus(), the preload contract, and App.tsx " +
    "all carry the field through to the runtime status UI.",
);
