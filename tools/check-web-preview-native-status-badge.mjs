#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const AVATAR_PREVIEW_URL = new URL(
  "../apps/web-preview/src/components/AvatarPreview.tsx",
  import.meta.url,
);
const AVATAR_PREVIEW_PATH = fileURLToPath(AVATAR_PREVIEW_URL);
const APP_CSS_URL = new URL("../apps/web-preview/src/App.css", import.meta.url);
const APP_CSS_PATH = fileURLToPath(APP_CSS_URL);
const NATIVE_MOTION_FRAME_HOOK_URL = new URL(
  "../apps/web-preview/src/hooks/useNativeMotionFrame.ts",
  import.meta.url,
);
const NATIVE_MOTION_FRAME_HOOK_PATH = fileURLToPath(
  NATIVE_MOTION_FRAME_HOOK_URL,
);

const NATIVE_MOTION_ENDPOINT = "ws://127.0.0.1:45731/motion";
const NATIVE_FRAME_STALE_TIMEOUT_MS = 1800;
const RECONNECT_DELAY_MS = 1000;
const PREVIEW_LOCAL_PRIVACY_NOTE =
  "Local preview only · No camera frames leave this device.";
const ENDPOINT_COPY_SUCCESS_TEXT = "Endpoint copied";
const ENDPOINT_COPY_FAILURE_TEXT = "Copy failed";
const ENDPOINT_COPY_FEEDBACK_CLEAR_DELAY_MS = 2000;
const ENDPOINT_COPY_FEEDBACK_ID = "web-preview-endpoint-copy-feedback";
const SOURCE_BADGE_ENDPOINT_NOTE_ID = "web-preview-native-endpoint-note";

const fail = (message) => {
  throw new Error(
    `Web Preview native status badge smoke check failed: ${message}`,
  );
};

const escapeRegExp = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const hasJsxAttribute = (source, attributeName, expectedValue) => {
  const expectedValuePattern = escapeRegExp(expectedValue);
  const attributePattern = new RegExp(
    `\\b${attributeName}=(?:"${expectedValuePattern}"|'${expectedValuePattern}')`,
  );

  return attributePattern.test(source);
};

const hasConditionalEndpointFeedbackDescription = (source) => {
  const feedbackIdPattern = escapeRegExp(ENDPOINT_COPY_FEEDBACK_ID);
  const conditionalDescriptionPattern = new RegExp(
    `\\baria-describedby=\\{\\s*currentEndpointCopyFeedback\\s*!==\\s*null\\s*\\?\\s*["']${feedbackIdPattern}["']\\s*:\\s*undefined\\s*\\}`,
  );

  return conditionalDescriptionPattern.test(source);
};

const hasConditionalSourceBadgeEndpointDescription = (source) => {
  const endpointNoteIdPattern = escapeRegExp(SOURCE_BADGE_ENDPOINT_NOTE_ID);
  const conditionalDescriptionPattern = new RegExp(
    `\\baria-describedby=\\{\\s*sourceBadgeContent\\.endpointNote\\s*!==\\s*null\\s*\\?\\s*(?:["']${endpointNoteIdPattern}["']|SOURCE_BADGE_ENDPOINT_NOTE_ID)\\s*:\\s*undefined\\s*\\}`,
  );

  return conditionalDescriptionPattern.test(source);
};

const getNamedImportsFromModule = (source, modulePath) => {
  const modulePathPattern = escapeRegExp(modulePath);
  const importPattern = new RegExp(
    `^\\s*import\\s+\\{([^;]*?)\\}\\s*from\\s*["']${modulePathPattern}["'];`,
    "gm",
  );
  const namedImports = new Set();

  for (const match of source.matchAll(importPattern)) {
    const importSpecifiers = match[1]
      .split(",")
      .map((specifier) => specifier.trim().replace(/^type\s+/, ""))
      .filter(Boolean);

    for (const specifier of importSpecifiers) {
      namedImports.add(specifier.split(/\s+as\s+/)[0].trim());
    }
  }

  return namedImports;
};

const getCssRuleBody = (source, selector) => {
  const selectorPattern = escapeRegExp(selector);
  const rulePattern = new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\}`);
  const ruleMatch = source.match(rulePattern);

  return ruleMatch?.[1] ?? null;
};

const assertCssDeclaration = (
  ruleBody,
  selector,
  propertyName,
  expectedValue,
) => {
  const propertyPattern = escapeRegExp(propertyName);
  const expectedValuePattern = escapeRegExp(expectedValue);
  const declarationPattern = new RegExp(
    `(?:^|;)\\s*${propertyPattern}\\s*:\\s*${expectedValuePattern}\\s*(?:;|$)`,
  );

  if (!declarationPattern.test(ruleBody)) {
    fail(`${selector} must include ${propertyName}: ${expectedValue}`);
  }
};

const assertNamedImportsFromModule = (source, modulePath, requiredImports) => {
  const namedImports = getNamedImportsFromModule(source, modulePath);

  for (const requiredImport of requiredImports) {
    if (!namedImports.has(requiredImport)) {
      fail(
        `AvatarPreview.tsx must import ${requiredImport} from ${modulePath}`,
      );
    }
  }
};

const runSmokeCheck = async () => {
  const [source, appCssSource, nativeMotionFrameHookSource] = await Promise.all(
    [
      readFile(AVATAR_PREVIEW_PATH, "utf8"),
      readFile(APP_CSS_PATH, "utf8"),
      readFile(NATIVE_MOTION_FRAME_HOOK_PATH, "utf8"),
    ],
  );

  if (!source.includes('className="preview-source-badge"')) {
    fail("AvatarPreview.tsx must render the preview-source-badge class");
  }

  if (
    !nativeMotionFrameHookSource.includes(
      `export const NATIVE_MOTION_WS_URL = "${NATIVE_MOTION_ENDPOINT}"`,
    )
  ) {
    fail("useNativeMotionFrame.ts must export the native MotionFrame endpoint");
  }

  assertNamedImportsFromModule(source, "../hooks/useNativeMotionFrame", [
    "NATIVE_FRAME_STALE_TIMEOUT_MS",
    "NATIVE_MOTION_WS_URL",
    "RECONNECT_DELAY_MS",
    "useNativeMotionFrame",
    "NativeMotionConnectionStatus",
  ]);

  if (
    !nativeMotionFrameHookSource.includes(
      `export const NATIVE_FRAME_STALE_TIMEOUT_MS = ${NATIVE_FRAME_STALE_TIMEOUT_MS};`,
    )
  ) {
    fail(
      "useNativeMotionFrame.ts must export NATIVE_FRAME_STALE_TIMEOUT_MS as the stale-frame source of truth",
    );
  }

  if (
    !nativeMotionFrameHookSource.includes(
      `export const RECONNECT_DELAY_MS = ${RECONNECT_DELAY_MS};`,
    )
  ) {
    fail(
      "useNativeMotionFrame.ts must export RECONNECT_DELAY_MS as the reconnect source of truth",
    );
  }

  if (
    !source.includes("NATIVE_FRAME_STALE_TIMEOUT_MS,") ||
    !source.includes("NATIVE_FRAME_STALE_TIMEOUT_MS / 1000")
  ) {
    fail(
      "AvatarPreview.tsx must reuse NATIVE_FRAME_STALE_TIMEOUT_MS from useNativeMotionFrame.ts",
    );
  }

  if (
    !source.includes("RECONNECT_DELAY_MS,") ||
    !source.includes("RECONNECT_DELAY_MS / 1000")
  ) {
    fail(
      "AvatarPreview.tsx must reuse RECONNECT_DELAY_MS from useNativeMotionFrame.ts",
    );
  }

  const badgeTagMatch = source.match(
    /<aside\b(?=[\s\S]*?className=["']preview-source-badge["'])[\s\S]*?>/,
  );

  if (badgeTagMatch === null) {
    fail("preview-source-badge must be rendered on an aside element");
  }

  const badgeTag = badgeTagMatch[0];

  const guardedBadgePattern =
    /\{!\s*isObsMode\s*&&\s*\(\s*<aside\b(?=[\s\S]*?className=["']preview-source-badge["'])/;

  if (!guardedBadgePattern.test(source)) {
    fail(
      "preview-source-badge must stay behind the existing !isObsMode && (...) guard",
    );
  }

  if (
    !source.includes(
      "endpointNote: `Local MotionFrame endpoint: ${NATIVE_MOTION_WS_URL}`",
    )
  ) {
    fail("native source badge must include a local MotionFrame endpoint note");
  }

  if (
    !source.includes(
      "the fallback avatar appears after about ${NATIVE_FRAME_STALE_TIMEOUT_SECONDS.toFixed(1)}s if frames do not arrive",
    )
  ) {
    fail(
      "native connected_waiting_for_frame helper text must mention the first-frame wait timeout",
    );
  }

  if (
    !source.includes(
      "NATIVE_FRAME_STALE_TIMEOUT_SECONDS.toFixed(1)}s if frames do not arrive",
    )
  ) {
    fail(
      "native connected_waiting_for_frame helper text must use the stale-frame timeout seconds value",
    );
  }

  if (
    !source.includes(
      "valid native MotionFrames have paused for about ${NATIVE_FRAME_STALE_TIMEOUT_SECONDS.toFixed(1)}s",
    )
  ) {
    fail("native fallback helper text must mention the stale-frame timeout");
  }

  if (
    !source.includes(
      "retrying in about ${RECONNECT_DELAY_SECONDS.toFixed(1)}s without changing transport behavior",
    )
  ) {
    fail("native reconnecting helper text must mention the reconnect delay");
  }

  if (!source.includes("endpointNote: null")) {
    fail("demo source badge must not render a native endpoint note");
  }

  if (!source.includes('className="preview-source-badge__endpoint"')) {
    fail("native source badge endpoint note must be visible in badge markup");
  }

  if (
    !source.includes(
      `const SOURCE_BADGE_ENDPOINT_NOTE_ID = "${SOURCE_BADGE_ENDPOINT_NOTE_ID}"`,
    )
  ) {
    fail(
      `native endpoint note must use a stable ${SOURCE_BADGE_ENDPOINT_NOTE_ID} id constant`,
    );
  }

  const endpointCopyGuardIndex = source.indexOf(
    "{sourceBadgeContent.endpointNote !== null && (",
  );
  const endpointCopyButtonIndex = source.indexOf(
    'className="preview-source-badge__copy-button"',
  );
  const endpointCopyFeedbackIndex = source.indexOf(
    'className="preview-source-badge__copy-feedback"',
  );

  if (
    endpointCopyGuardIndex === -1 ||
    endpointCopyButtonIndex === -1 ||
    endpointCopyFeedbackIndex === -1 ||
    endpointCopyButtonIndex < endpointCopyGuardIndex ||
    endpointCopyFeedbackIndex < endpointCopyButtonIndex ||
    !source.includes('type="button"') ||
    !source.includes("onClick={handleCopyEndpoint}") ||
    !source.includes("Copy endpoint")
  ) {
    fail(
      "native endpoint badge must render a local Copy endpoint button and feedback inside the endpoint-only guard",
    );
  }

  const endpointCopyButtonMarkup = source.slice(
    source.lastIndexOf("<button", endpointCopyButtonIndex),
    source.indexOf("</button>", endpointCopyButtonIndex),
  );
  const endpointCopyFeedbackMarkup = source.slice(
    source.lastIndexOf("<span", endpointCopyFeedbackIndex),
    source.indexOf("{currentEndpointCopyFeedback}", endpointCopyFeedbackIndex),
  );
  const endpointNoteMarkup = source.slice(
    source.lastIndexOf("<span", endpointCopyButtonIndex - 1),
    endpointCopyButtonIndex,
  );

  if (!hasConditionalSourceBadgeEndpointDescription(badgeTag)) {
    fail(
      `preview-source-badge aria-describedby must reference ${SOURCE_BADGE_ENDPOINT_NOTE_ID} only when sourceBadgeContent.endpointNote !== null`,
    );
  }

  if (
    !endpointNoteMarkup.includes("id={SOURCE_BADGE_ENDPOINT_NOTE_ID}") &&
    !hasJsxAttribute(endpointNoteMarkup, "id", SOURCE_BADGE_ENDPOINT_NOTE_ID)
  ) {
    fail(
      `native endpoint note must be rendered with id="${SOURCE_BADGE_ENDPOINT_NOTE_ID}"`,
    );
  }

  if (!endpointNoteMarkup.includes("{sourceBadgeContent.endpointNote}")) {
    fail(
      "native endpoint note must continue to render sourceBadgeContent.endpointNote",
    );
  }

  if (!hasConditionalEndpointFeedbackDescription(endpointCopyButtonMarkup)) {
    fail(
      `native endpoint copy button aria-describedby must reference ${ENDPOINT_COPY_FEEDBACK_ID} only when currentEndpointCopyFeedback !== null`,
    );
  }

  if (
    !hasJsxAttribute(
      endpointCopyFeedbackMarkup,
      "id",
      ENDPOINT_COPY_FEEDBACK_ID,
    )
  ) {
    fail(
      `native endpoint copy feedback must use id="${ENDPOINT_COPY_FEEDBACK_ID}"`,
    );
  }

  if (
    !endpointCopyFeedbackMarkup.includes('role="status"') ||
    !endpointCopyFeedbackMarkup.includes('aria-live="polite"')
  ) {
    fail("native endpoint copy feedback must be a polite status live region");
  }

  if (!source.includes("{currentEndpointCopyFeedback}")) {
    fail(
      "native endpoint copy feedback must render currentEndpointCopyFeedback",
    );
  }

  if (source.includes("}, [sourceBadgeContent.endpointNote]);")) {
    fail(
      "native endpoint copy feedback must not use a synchronous endpoint-note cleanup effect",
    );
  }

  if (!source.includes("navigator.clipboard")) {
    fail("native endpoint copy action must use the browser Clipboard API");
  }

  if (!source.includes(".writeText(NATIVE_MOTION_WS_URL)")) {
    fail("native endpoint copy action must copy NATIVE_MOTION_WS_URL");
  }

  if (source.includes(`writeText("${NATIVE_MOTION_ENDPOINT}")`)) {
    fail("native endpoint copy action must not duplicate the endpoint literal");
  }

  if (
    !source.includes(
      `const ENDPOINT_COPY_SUCCESS_TEXT = "${ENDPOINT_COPY_SUCCESS_TEXT}"`,
    ) ||
    !source.includes(
      `const ENDPOINT_COPY_FAILURE_TEXT = "${ENDPOINT_COPY_FAILURE_TEXT}"`,
    )
  ) {
    fail(
      "native endpoint copy action must keep local success/failure feedback text",
    );
  }

  if (
    !source.includes("type EndpointCopyFeedbackState = {") ||
    !source.includes("message: string;") ||
    !source.includes("endpointNote: string | null;") ||
    !source.includes("useState<EndpointCopyFeedbackState>(null)")
  ) {
    fail(
      "native endpoint copy feedback state must store a message and associated endpoint note",
    );
  }

  const currentFeedbackPattern =
    /const currentEndpointCopyFeedback =\s*endpointCopyFeedback\?\.endpointNote === sourceBadgeContent\.endpointNote\s*\?\s*endpointCopyFeedback\.message\s*:\s*null;/;

  if (!currentFeedbackPattern.test(source)) {
    fail(
      "native endpoint copy feedback must derive rendered feedback by matching the stored endpoint note to the current endpoint note",
    );
  }

  const feedbackStatePattern =
    /setEndpointCopyFeedback\(\{\s*message: ENDPOINT_COPY_(?:SUCCESS|FAILURE)_TEXT,\s*endpointNote: sourceBadgeContent\.endpointNote,\s*\}\);/g;

  if ([...source.matchAll(feedbackStatePattern)].length < 3) {
    fail(
      "native endpoint copy success and failure paths must store feedback with the current endpoint note",
    );
  }

  if (
    !source.includes(
      `const ENDPOINT_COPY_FEEDBACK_CLEAR_DELAY_MS = ${ENDPOINT_COPY_FEEDBACK_CLEAR_DELAY_MS};`,
    ) ||
    !source.includes("useEffect(() =>") ||
    !source.includes("if (endpointCopyFeedback === null)") ||
    !source.includes("window.setTimeout") ||
    !source.includes("setEndpointCopyFeedback(null)") ||
    !source.includes("ENDPOINT_COPY_FEEDBACK_CLEAR_DELAY_MS") ||
    !source.includes("window.clearTimeout(clearFeedbackTimer)") ||
    !source.includes("}, [endpointCopyFeedback]);")
  ) {
    fail(
      "native endpoint copy feedback must auto-clear after a short delay with timer cleanup",
    );
  }

  const demoBadgeContentMatch = source.match(
    /return \{\s*label: ["']Source: Local demo MotionFrame["'],[\s\S]*?endpointNote: null,\s*\};/,
  );

  if (demoBadgeContentMatch === null) {
    fail("demo source badge must not render an endpoint note or copy action");
  }

  if (!source.includes(PREVIEW_LOCAL_PRIVACY_NOTE)) {
    fail("AvatarPreview.tsx must render the local privacy note text");
  }

  if (!source.includes('className="preview-source-badge__note"')) {
    fail("local privacy note must use preview-source-badge__note markup");
  }

  const sourceBadgeCssSelector = ".preview-source-badge";
  const sourceBadgeCssRuleBody = getCssRuleBody(
    appCssSource,
    sourceBadgeCssSelector,
  );

  if (sourceBadgeCssRuleBody === null) {
    fail("preview-source-badge must have dedicated CSS styling");
  }

  assertCssDeclaration(
    sourceBadgeCssRuleBody,
    sourceBadgeCssSelector,
    "box-sizing",
    "border-box",
  );
  assertCssDeclaration(
    sourceBadgeCssRuleBody,
    sourceBadgeCssSelector,
    "max-width",
    "min(28rem, calc(100vw - 2rem))",
  );

  const helperCssSelector = ".preview-source-badge__helper";
  const helperCssRuleBody = getCssRuleBody(appCssSource, helperCssSelector);

  if (helperCssRuleBody === null) {
    fail("preview-source-badge__helper must have dedicated CSS styling");
  }

  assertCssDeclaration(
    helperCssRuleBody,
    helperCssSelector,
    "font-size",
    "0.75rem",
  );
  assertCssDeclaration(
    helperCssRuleBody,
    helperCssSelector,
    "line-height",
    "1.4",
  );
  assertCssDeclaration(
    helperCssRuleBody,
    helperCssSelector,
    "overflow-wrap",
    "anywhere",
  );

  const endpointRowCssSelector = ".preview-source-badge__endpoint-row";
  const endpointRowCssRuleBody = getCssRuleBody(
    appCssSource,
    endpointRowCssSelector,
  );

  if (endpointRowCssRuleBody === null) {
    fail("preview-source-badge__endpoint-row must have dedicated CSS styling");
  }

  assertCssDeclaration(
    endpointRowCssRuleBody,
    endpointRowCssSelector,
    "display",
    "flex",
  );
  assertCssDeclaration(
    endpointRowCssRuleBody,
    endpointRowCssSelector,
    "flex-wrap",
    "wrap",
  );

  const endpointCssSelector = ".preview-source-badge__endpoint";
  const endpointCssRuleBody = getCssRuleBody(appCssSource, endpointCssSelector);

  if (endpointCssRuleBody === null) {
    fail("preview-source-badge__endpoint must have dedicated CSS styling");
  }

  assertCssDeclaration(
    endpointCssRuleBody,
    endpointCssSelector,
    "color",
    "#bae6fd",
  );
  assertCssDeclaration(
    endpointCssRuleBody,
    endpointCssSelector,
    "font-family",
    'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
  );
  assertCssDeclaration(
    endpointCssRuleBody,
    endpointCssSelector,
    "font-size",
    "0.6875rem",
  );
  assertCssDeclaration(
    endpointCssRuleBody,
    endpointCssSelector,
    "overflow-wrap",
    "anywhere",
  );

  const copyButtonCssSelector = ".preview-source-badge__copy-button";
  const copyButtonCssRuleBody = getCssRuleBody(
    appCssSource,
    copyButtonCssSelector,
  );

  if (copyButtonCssRuleBody === null) {
    fail("preview-source-badge__copy-button must have dedicated CSS styling");
  }

  assertCssDeclaration(
    copyButtonCssRuleBody,
    copyButtonCssSelector,
    "font-size",
    "0.6875rem",
  );

  const copyFeedbackCssSelector = ".preview-source-badge__copy-feedback";
  const copyFeedbackCssRuleBody = getCssRuleBody(
    appCssSource,
    copyFeedbackCssSelector,
  );

  if (copyFeedbackCssRuleBody === null) {
    fail("preview-source-badge__copy-feedback must have dedicated CSS styling");
  }

  assertCssDeclaration(
    copyFeedbackCssRuleBody,
    copyFeedbackCssSelector,
    "font-size",
    "0.6875rem",
  );

  const privacyNoteCssSelector = ".preview-source-badge__note";
  const privacyNoteCssRuleBody = getCssRuleBody(
    appCssSource,
    privacyNoteCssSelector,
  );

  if (privacyNoteCssRuleBody === null) {
    fail("preview-source-badge__note must have dedicated CSS styling");
  }

  assertCssDeclaration(
    privacyNoteCssRuleBody,
    privacyNoteCssSelector,
    "color",
    "#94a3b8",
  );
  assertCssDeclaration(
    privacyNoteCssRuleBody,
    privacyNoteCssSelector,
    "font-size",
    "0.6875rem",
  );

  const indicatorCssSelector = ".preview-source-badge__indicator";
  const indicatorCssRuleBody = getCssRuleBody(
    appCssSource,
    indicatorCssSelector,
  );

  if (indicatorCssRuleBody === null) {
    fail("preview-source-badge__indicator must have dedicated CSS styling");
  }

  assertCssDeclaration(
    indicatorCssRuleBody,
    indicatorCssSelector,
    "width",
    "0.5rem",
  );
  assertCssDeclaration(
    indicatorCssRuleBody,
    indicatorCssSelector,
    "height",
    "0.5rem",
  );
  assertCssDeclaration(
    indicatorCssRuleBody,
    indicatorCssSelector,
    "border-radius",
    "50%",
  );

  const indicatorVariantBackgrounds = new Map([
    [".preview-source-badge__indicator--active", "#4ade80"],
    [".preview-source-badge__indicator--waiting", "#fbbf24"],
    [".preview-source-badge__indicator--inactive", "#f87171"],
    [".preview-source-badge__indicator--demo", "#38bdf8"],
  ]);

  for (const [
    indicatorVariantCssSelector,
    expectedBackground,
  ] of indicatorVariantBackgrounds) {
    const indicatorVariantCssRuleBody = getCssRuleBody(
      appCssSource,
      indicatorVariantCssSelector,
    );

    if (indicatorVariantCssRuleBody === null) {
      fail(`${indicatorVariantCssSelector} must have dedicated CSS styling`);
    }

    assertCssDeclaration(
      indicatorVariantCssRuleBody,
      indicatorVariantCssSelector,
      "background",
      expectedBackground,
    );
  }

  if (!nativeMotionFrameHookSource.includes(NATIVE_MOTION_ENDPOINT)) {
    fail(`native endpoint must remain ${NATIVE_MOTION_ENDPOINT}`);
  }

  if (
    !source.includes("getNativeStatusText(nativeStatus)") ||
    !source.includes("helper: getNativeStatusHelper(nativeStatus)")
  ) {
    fail("native source badge must keep existing status text/helper semantics");
  }

  const requiredAttributes = [
    ["role", "status"],
    ["aria-live", "polite"],
    ["aria-atomic", "true"],
    ["aria-label", "Preview source status"],
  ];

  for (const [attributeName, expectedValue] of requiredAttributes) {
    if (!hasJsxAttribute(badgeTag, attributeName, expectedValue)) {
      fail(
        `preview-source-badge must keep ${attributeName}="${expectedValue}"`,
      );
    }
  }

  console.log("Web Preview native status badge smoke check passed.");
};

runSmokeCheck().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
