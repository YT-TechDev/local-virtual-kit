#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const WEB_PREVIEW_PACKAGE_URL = new URL(
  "../apps/web-preview/package.json",
  import.meta.url,
);
const FALLBACK_SOURCE_URL = new URL(
  "../apps/web-preview/src/motion/nativeMotionFrameFallback.ts",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PREVIEW_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(
    `Web Preview native fallback readiness check failed: ${message}`,
  );
};

const assertEqual = (actual, expected, label) => {
  if (!Object.is(actual, expected)) {
    fail(`${label}: expected ${expected}, received ${actual}`);
  }
};

const loadFallbackModule = async () => {
  const source = await readFile(FALLBACK_SOURCE_URL, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: "nativeMotionFrameFallback.ts",
  });

  const tempDir = await mkdtemp(join(tmpdir(), "lvk-motion-fallback-"));
  const tempModulePath = join(tempDir, "nativeMotionFrameFallback.mjs");
  await writeFile(tempModulePath, output.outputText, "utf8");

  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const runCheck = async () => {
  const { isNativeFallbackReady } = await loadFallbackModule();
  const CONNECTING = 0;
  const OPEN = 1;
  const CLOSING = 2;
  const CLOSED = 3;

  assertEqual(
    isNativeFallbackReady(true, OPEN, OPEN),
    false,
    "unmounted with an open socket is not fallback-ready",
  );
  assertEqual(
    isNativeFallbackReady(false, null, OPEN),
    false,
    "mounted with no socket is not fallback-ready",
  );
  assertEqual(
    isNativeFallbackReady(false, CONNECTING, OPEN),
    false,
    "mounted with a connecting socket is not fallback-ready",
  );
  assertEqual(
    isNativeFallbackReady(false, CLOSING, OPEN),
    false,
    "mounted with a closing socket is not fallback-ready",
  );
  assertEqual(
    isNativeFallbackReady(false, CLOSED, OPEN),
    false,
    "mounted with a closed socket is not fallback-ready",
  );
  assertEqual(
    isNativeFallbackReady(false, OPEN, OPEN),
    true,
    "mounted with an open socket is fallback-ready",
  );
};

runCheck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
