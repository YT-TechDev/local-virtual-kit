#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const AVATAR_PREVIEW_URL = new URL(
  "../apps/web-preview/src/components/AvatarPreview.tsx",
  import.meta.url,
);
const AVATAR_PREVIEW_PATH = fileURLToPath(AVATAR_PREVIEW_URL);

const fail = (message) => {
  throw new Error(
    `Web Preview native status badge smoke check failed: ${message}`,
  );
};

const escapeRegExp = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const hasJsxAttribute = (source, tagName, attributeName, expectedValue) => {
  const tagPattern = new RegExp(`<${tagName}\\b[\\s\\S]*?>`, "g");
  const expectedValuePattern = escapeRegExp(expectedValue);
  const attributePattern = new RegExp(
    `\\b${attributeName}=(?:"${expectedValuePattern}"|'${expectedValuePattern}')`,
  );

  return Array.from(source.matchAll(tagPattern)).some((match) =>
    attributePattern.test(match[0]),
  );
};

const runSmokeCheck = async () => {
  const source = await readFile(AVATAR_PREVIEW_PATH, "utf8");

  if (!source.includes('className="preview-source-badge"')) {
    fail("AvatarPreview.tsx must render the preview-source-badge class");
  }

  const badgeTagMatch = source.match(
    /<aside\b(?=[\s\S]*?className=["']preview-source-badge["'])[\s\S]*?>/,
  );

  if (badgeTagMatch === null) {
    fail("preview-source-badge must be rendered on an aside element");
  }

  const guardedBadgePattern =
    /\{!\s*isObsMode\s*&&\s*\(\s*<aside\b(?=[\s\S]*?className=["']preview-source-badge["'])/;

  if (!guardedBadgePattern.test(source)) {
    fail(
      "preview-source-badge must stay behind the existing !isObsMode && (...) guard",
    );
  }

  const badgeTag = badgeTagMatch[0];

  const requiredAttributes = [
    ["role", "status"],
    ["aria-live", "polite"],
    ["aria-atomic", "true"],
    ["aria-label", "Preview source status"],
  ];

  for (const [attributeName, expectedValue] of requiredAttributes) {
    if (!hasJsxAttribute(badgeTag, "aside", attributeName, expectedValue)) {
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
