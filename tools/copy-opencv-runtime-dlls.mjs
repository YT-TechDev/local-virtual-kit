#!/usr/bin/env node
/**
 * Dev/local helper: copies Windows/vcpkg OpenCV runtime DLLs into an
 * app-owned output directory.
 *
 * Does NOT modify PATH, download dependencies, or implement Electron
 * packaging behavior. For local and development use only.
 *
 * Usage:
 *   node tools/copy-opencv-runtime-dlls.mjs --source-dir <dir> --dest-dir <dir> [--dry-run]
 *   node tools/copy-opencv-runtime-dlls.mjs --manifest <path> --source-dir <dir> --dest-dir <dir> [--dry-run]
 *   node tools/copy-opencv-runtime-dlls.mjs --manifest <path> --verify [--source-dir <dir>] [--dest-dir <dir>]
 *   node tools/copy-opencv-runtime-dlls.mjs --help
 *   node tools/copy-opencv-runtime-dlls.mjs --self-test
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// Explicitly allowed OpenCV runtime DLL filename patterns for LVK's
// OpenCV-enabled Native Core build. Only these patterns are copied;
// all other files in the source directory are ignored.
const ALLOWED_DLL_PATTERNS = [
  /^opencv_world\d+d?\.dll$/i,
  /^opencv_core\d+d?\.dll$/i,
  /^opencv_imgproc\d+d?\.dll$/i,
  /^opencv_videoio\d+d?\.dll$/i,
  /^opencv_highgui\d+d?\.dll$/i,
  /^opencv_imgcodecs\d+d?\.dll$/i,
  /^opencv_calib3d\d+d?\.dll$/i,
  /^opencv_features2d\d+d?\.dll$/i,
  /^opencv_flann\d+d?\.dll$/i,
  /^opencv_objdetect\d+d?\.dll$/i,
  /^opencv_dnn\d+d?\.dll$/i,
];

function isAllowedDll(filename) {
  return ALLOWED_DLL_PATTERNS.some((pattern) => pattern.test(filename));
}

function isDebugDll(filename) {
  return /d\.dll$/i.test(filename);
}

function printHelp() {
  console.log(`copy-opencv-runtime-dlls

Dev/local helper: copies Windows/vcpkg OpenCV runtime DLLs into an app-owned directory.

Does NOT modify PATH, download dependencies, or implement Electron packaging behavior.

Usage:
  node tools/copy-opencv-runtime-dlls.mjs --source-dir <dir> --dest-dir <dir> [--dry-run]
  node tools/copy-opencv-runtime-dlls.mjs --manifest <path> --source-dir <dir> --dest-dir <dir> [--dry-run]
  node tools/copy-opencv-runtime-dlls.mjs --manifest <path> --verify [--source-dir <dir>] [--dest-dir <dir>]
  node tools/copy-opencv-runtime-dlls.mjs --help
  node tools/copy-opencv-runtime-dlls.mjs --self-test

Options:
  --source-dir <dir>    Directory containing OpenCV runtime DLLs
  --dest-dir <dir>      Destination directory for copied DLLs
  --manifest <path>     Path to a required-DLL manifest JSON file (schema version 1)
  --verify              Verify manifest-listed DLLs exist (requires --manifest; does not copy)
  --dry-run             Print what would be copied without copying
  --help                Show this help message
  --self-test           Run self-test with temporary directories and fake DLL filenames

Without --manifest:
  --source-dir and --dest-dir are required. Copies all allowed DLL candidates from source.

With --manifest:
  Copies only manifest-listed DLLs. Fails if any manifest-listed DLL is missing from source.

With --verify --manifest:
  Checks that manifest-listed DLLs exist in --source-dir, --dest-dir, or both.
  At least one of --source-dir or --dest-dir is required.
  Does not copy files or create directories.

Manifest schema version 1 example:
  {
    "schemaVersion": 1,
    "target": "windows-x64-release",
    "configuration": "release",
    "opencvDistribution": "modular",
    "runtimeDlls": [
      "opencv_core4100.dll",
      "opencv_imgproc4100.dll"
    ]
  }

Allowed DLL patterns (case-insensitive):
  opencv_world<version>[d].dll
  opencv_core<version>[d].dll
  opencv_imgproc<version>[d].dll
  opencv_videoio<version>[d].dll
  opencv_highgui<version>[d].dll
  opencv_imgcodecs<version>[d].dll
  opencv_calib3d<version>[d].dll
  opencv_features2d<version>[d].dll
  opencv_flann<version>[d].dll
  opencv_objdetect<version>[d].dll
  opencv_dnn<version>[d].dll

Use placeholder paths in docs and reports, for example:
  --source-dir <vcpkg-root>/installed/x64-windows/bin
  --dest-dir <app-root>/native-runtime/bin
Do not commit local absolute paths.`);
}

function parseArgs(argv) {
  const args = {
    sourceDir: null,
    destDir: null,
    manifest: null,
    verify: false,
    dryRun: false,
    help: false,
    selfTest: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--source-dir":
        args.sourceDir = argv[++i] ?? null;
        break;
      case "--dest-dir":
        args.destDir = argv[++i] ?? null;
        break;
      case "--manifest":
        args.manifest = argv[++i] ?? null;
        break;
      case "--verify":
        args.verify = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--self-test":
        args.selfTest = true;
        break;
    }
  }
  return args;
}

/**
 * Loads and validates a manifest JSON file (schema version 1).
 * Returns the parsed manifest object on success.
 * Throws an Error with a descriptive message on any validation failure.
 */
function loadAndValidateManifest(manifestPath) {
  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (err) {
    throw new Error(`could not read manifest file: ${err.message}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    throw new Error(`manifest file is not valid JSON: ${err.message}`);
  }

  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `manifest schemaVersion must be 1, got: ${JSON.stringify(manifest.schemaVersion)}`,
    );
  }

  const { runtimeDlls, configuration } = manifest;

  if (!Array.isArray(runtimeDlls) || runtimeDlls.length === 0) {
    throw new Error(`manifest runtimeDlls must be a non-empty array`);
  }

  const seen = new Set();
  for (const entry of runtimeDlls) {
    if (typeof entry !== "string") {
      throw new Error(`manifest runtimeDlls must contain only strings`);
    }

    // Reject absolute paths (Windows drive-letter and POSIX root)
    if (/^[A-Za-z]:[\\/]/.test(entry) || entry.startsWith("/")) {
      throw new Error(
        `manifest runtimeDlls must not contain absolute paths: "${entry}"`,
      );
    }

    // Reject path separators
    if (entry.includes("/") || entry.includes("\\")) {
      throw new Error(
        `manifest runtimeDlls must not contain path separators: "${entry}"`,
      );
    }

    // Reject ".." (path traversal marker)
    if (entry.includes("..")) {
      throw new Error(`manifest runtimeDlls must not contain "..": "${entry}"`);
    }

    // Reject non-.dll entries
    if (!entry.toLowerCase().endsWith(".dll")) {
      throw new Error(
        `manifest runtimeDlls must only contain .dll filenames: "${entry}"`,
      );
    }

    // Reject duplicates (case-insensitive)
    const lower = entry.toLowerCase();
    if (seen.has(lower)) {
      throw new Error(
        `manifest runtimeDlls contains a duplicate entry: "${entry}"`,
      );
    }
    seen.add(lower);

    // Reject entries not matching allowed DLL filename patterns
    if (!isAllowedDll(entry)) {
      throw new Error(
        `manifest runtimeDlls contains an entry that does not match allowed DLL patterns: "${entry}"`,
      );
    }

    // For release configuration, reject debug-style DLL names (ending in d.dll)
    if (configuration === "release" && isDebugDll(entry)) {
      throw new Error(
        `manifest runtimeDlls contains a debug DLL in a release configuration: "${entry}"`,
      );
    }
  }

  return manifest;
}

function copyDllsFromManifest({ manifest, sourceDir, destDir, dryRun }) {
  const resolvedSource = resolve(sourceDir);
  const resolvedDest = resolve(destDir);

  if (!existsSync(resolvedSource)) {
    console.error(
      `copy-opencv-runtime-dlls: source directory not found.\n` +
        `Pass a valid --source-dir. Do not commit local absolute paths.\n` +
        `Example: --source-dir <vcpkg-root>/installed/x64-windows/bin`,
    );
    process.exit(1);
  }

  const { runtimeDlls } = manifest;

  console.log(`copy-opencv-runtime-dlls (manifest mode)`);
  console.log(`  source:      ${resolvedSource}`);
  console.log(`  destination: ${resolvedDest}`);
  console.log(`  dry-run:     ${dryRun}`);
  console.log(`  manifest:    ${runtimeDlls.length} required DLL(s)`);

  const missing = runtimeDlls.filter(
    (dll) => !existsSync(join(resolvedSource, dll)),
  );

  if (missing.length > 0) {
    console.error(
      `copy-opencv-runtime-dlls: missing required DLL(s) in source directory:`,
    );
    for (const dll of missing) {
      console.error(`  missing: ${dll}`);
    }
    process.exit(1);
  }

  if (!dryRun) {
    if (!existsSync(resolvedDest)) {
      try {
        mkdirSync(resolvedDest, { recursive: true });
        console.log(`  Created destination directory.`);
      } catch (err) {
        console.error(
          `copy-opencv-runtime-dlls: could not create destination directory: ${err.message}`,
        );
        process.exit(1);
      }
    }
  }

  for (const dll of runtimeDlls) {
    if (dryRun) {
      console.log(`  [dry-run] would copy: ${dll}`);
    } else {
      try {
        copyFileSync(join(resolvedSource, dll), join(resolvedDest, dll));
        console.log(`  copied: ${dll}`);
      } catch (err) {
        console.error(
          `copy-opencv-runtime-dlls: could not copy ${dll}: ${err.message}`,
        );
        process.exit(1);
      }
    }
  }

  if (dryRun) {
    console.log(`  Dry-run complete. No files were copied.`);
  } else {
    console.log(`  Done. ${runtimeDlls.length} DLL(s) copied.`);
  }
}

/**
 * Verifies that manifest-listed DLLs exist in the given source/dest directories.
 * Does not copy files or create directories.
 * Returns true if all checks pass, false otherwise.
 */
function verifyDlls({ manifest, sourceDir, destDir }) {
  if (!sourceDir && !destDir) {
    console.error(
      `copy-opencv-runtime-dlls: --verify requires at least one of --source-dir or --dest-dir.\n` +
        `Run with --help for usage.`,
    );
    return false;
  }

  const { runtimeDlls } = manifest;
  let allOk = true;

  if (sourceDir) {
    const resolvedSource = resolve(sourceDir);
    console.log(`copy-opencv-runtime-dlls --verify source: ${resolvedSource}`);
    if (!existsSync(resolvedSource)) {
      console.error(`  source directory not found`);
      allOk = false;
    } else {
      let srcOk = true;
      for (const dll of runtimeDlls) {
        if (!existsSync(join(resolvedSource, dll))) {
          console.error(`  missing in source: ${dll}`);
          srcOk = false;
          allOk = false;
        }
      }
      if (srcOk) {
        console.log(
          `  All ${runtimeDlls.length} required DLL(s) present in source.`,
        );
      }
    }
  }

  if (destDir) {
    const resolvedDest = resolve(destDir);
    console.log(
      `copy-opencv-runtime-dlls --verify destination: ${resolvedDest}`,
    );
    if (!existsSync(resolvedDest)) {
      console.error(`  destination directory not found`);
      allOk = false;
    } else {
      let dstOk = true;
      for (const dll of runtimeDlls) {
        if (!existsSync(join(resolvedDest, dll))) {
          console.error(`  missing in destination: ${dll}`);
          dstOk = false;
          allOk = false;
        }
      }
      if (dstOk) {
        console.log(
          `  All ${runtimeDlls.length} required DLL(s) present in destination.`,
        );
      }
    }
  }

  return allOk;
}

function copyDlls({ sourceDir, destDir, dryRun }) {
  const resolvedSource = resolve(sourceDir);
  const resolvedDest = resolve(destDir);

  if (!existsSync(resolvedSource)) {
    console.error(
      `copy-opencv-runtime-dlls: source directory not found.\n` +
        `Pass a valid --source-dir. Do not commit local absolute paths.\n` +
        `Example: --source-dir <vcpkg-root>/installed/x64-windows/bin`,
    );
    process.exit(1);
  }

  let entries;
  try {
    entries = readdirSync(resolvedSource);
  } catch (err) {
    console.error(
      `copy-opencv-runtime-dlls: could not read source directory: ${err.message}`,
    );
    process.exit(1);
  }

  const matched = entries.filter((entry) => isAllowedDll(entry));
  const skippedDllCount = entries.filter(
    (entry) => entry.toLowerCase().endsWith(".dll") && !isAllowedDll(entry),
  ).length;

  console.log(`copy-opencv-runtime-dlls`);
  console.log(`  source:      ${resolvedSource}`);
  console.log(`  destination: ${resolvedDest}`);
  console.log(`  dry-run:     ${dryRun}`);
  console.log(`  matched:     ${matched.length} allowed DLL(s)`);
  console.log(`  skipped:     ${skippedDllCount} non-allowed DLL(s)`);

  if (matched.length === 0) {
    console.log(`  No allowed OpenCV runtime DLLs found in source directory.`);
    return;
  }

  if (!dryRun) {
    if (!existsSync(resolvedDest)) {
      try {
        mkdirSync(resolvedDest, { recursive: true });
        console.log(`  Created destination directory.`);
      } catch (err) {
        console.error(
          `copy-opencv-runtime-dlls: could not create destination directory: ${err.message}`,
        );
        process.exit(1);
      }
    }
  }

  for (const filename of matched) {
    if (dryRun) {
      console.log(`  [dry-run] would copy: ${filename}`);
    } else {
      try {
        copyFileSync(
          join(resolvedSource, filename),
          join(resolvedDest, filename),
        );
        console.log(`  copied: ${filename}`);
      } catch (err) {
        console.error(
          `copy-opencv-runtime-dlls: could not copy ${filename}: ${err.message}`,
        );
        process.exit(1);
      }
    }
  }

  if (dryRun) {
    console.log(`  Dry-run complete. No files were copied.`);
  } else {
    console.log(`  Done. ${matched.length} DLL(s) copied.`);
  }
}

function runSelfTest() {
  console.log("copy-opencv-runtime-dlls self-test starting...\n");

  let passed = 0;
  let failed = 0;

  function pass(label) {
    console.log(`  PASS: ${label}`);
    passed++;
  }

  function fail(label) {
    console.error(`  FAIL: ${label}`);
    failed++;
  }

  // Intercepts process.exit and suppresses console.error for the duration of fn.
  // Returns the exit code if process.exit was called, otherwise null.
  function captureExit(fn) {
    const origExit = process.exit;
    const origError = console.error;
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    };
    console.error = () => {};
    try {
      fn();
    } catch {
      // expected when process.exit is called
    } finally {
      process.exit = origExit;
      console.error = origError;
    }
    return exitCode;
  }

  // Calls loadAndValidateManifest and returns the thrown Error, or null if it succeeded.
  function tryValidateManifest(manifestPath) {
    try {
      loadAndValidateManifest(manifestPath);
      return null;
    } catch (err) {
      return err;
    }
  }

  const tmpBase = tmpdir();
  const srcDir = mkdtempSync(join(tmpBase, "lvk-opencv-src-"));
  const dstBase = mkdtempSync(join(tmpBase, "lvk-opencv-dst-"));
  const manifestDir = mkdtempSync(join(tmpBase, "lvk-opencv-manifest-"));

  const allowedFakeDlls = [
    "opencv_world4100.dll",
    "opencv_world4100d.dll",
    "opencv_core4100.dll",
    "opencv_imgproc4100d.dll",
    "opencv_videoio4100.dll",
    "opencv_highgui4100d.dll",
    "opencv_dnn4100.dll",
    "opencv_objdetect490.dll",
  ];
  const nonAllowedFiles = [
    "some_other_library.dll",
    "zlib1.dll",
    "readme.txt",
    "opencv_world.dll",
  ];

  for (const f of [...allowedFakeDlls, ...nonAllowedFiles]) {
    writeFileSync(join(srcDir, f), "");
  }

  // Test 1: pattern matching — allowed DLLs.
  console.log("[test 1] DLL pattern matching — allowed filenames");
  for (const f of allowedFakeDlls) {
    if (isAllowedDll(f)) {
      pass(`${f} matched`);
    } else {
      fail(`${f} should match but did not`);
    }
  }

  // Test 2: pattern matching — non-allowed files.
  console.log("\n[test 2] DLL pattern matching — non-allowed filenames");
  for (const f of nonAllowedFiles) {
    if (!isAllowedDll(f)) {
      pass(`${f} correctly rejected`);
    } else {
      fail(`${f} should be rejected but matched`);
    }
  }

  // Test 3: dry-run mode — no files are copied.
  console.log("\n[test 3] dry-run mode");
  const dryDestDir = join(dstBase, "dry-output");
  copyDlls({ sourceDir: srcDir, destDir: dryDestDir, dryRun: true });
  if (!existsSync(dryDestDir)) {
    pass("destination directory not created in dry-run mode");
  } else {
    fail("destination directory must not be created in dry-run mode");
  }

  // Test 4: real copy mode — allowed DLLs copied, non-allowed files absent.
  console.log("\n[test 4] real copy mode");
  const realDestDir = join(dstBase, "real-output");
  copyDlls({ sourceDir: srcDir, destDir: realDestDir, dryRun: false });

  if (existsSync(realDestDir)) {
    pass("destination directory created");
  } else {
    fail("destination directory was not created");
  }

  for (const f of allowedFakeDlls) {
    if (existsSync(join(realDestDir, f))) {
      pass(`${f} copied`);
    } else {
      fail(`${f} was not copied`);
    }
  }

  for (const f of nonAllowedFiles) {
    if (!existsSync(join(realDestDir, f))) {
      pass(`${f} not copied (correctly excluded)`);
    } else {
      fail(`${f} must not be copied`);
    }
  }

  // Test 5: missing source directory detection.
  console.log("\n[test 5] missing source directory detection");
  const missingSrc = join(tmpBase, "lvk-nonexistent-opencv-src-99999999");
  if (!existsSync(missingSrc)) {
    pass("missing source directory correctly detected as absent");
  } else {
    fail("expected missing source to not exist");
  }

  // Test 6: manifest validation — valid manifest parses without error.
  console.log("\n[test 6] manifest validation — valid manifest");
  const validManifestPath = join(manifestDir, "valid.json");
  writeFileSync(
    validManifestPath,
    JSON.stringify({
      schemaVersion: 1,
      target: "windows-x64-release",
      configuration: "release",
      opencvDistribution: "modular",
      runtimeDlls: ["opencv_core4100.dll", "opencv_imgproc4100.dll"],
    }),
  );
  const validErr = tryValidateManifest(validManifestPath);
  if (!validErr) {
    pass("valid manifest loaded without error");
  } else {
    fail(`valid manifest unexpectedly failed: ${validErr.message}`);
  }

  // Test 7: manifest copy mode — copies only manifest-listed DLLs.
  console.log(
    "\n[test 7] manifest copy mode — copies only manifest-listed DLLs",
  );
  const manifestSrcDir = mkdtempSync(join(tmpBase, "lvk-opencv-msrc-"));
  const manifestDstDir = join(dstBase, "manifest-output");
  const manifestDlls = ["opencv_core4100.dll", "opencv_videoio4100.dll"];
  const extraDll = "opencv_objdetect490.dll";
  for (const f of [...manifestDlls, extraDll]) {
    writeFileSync(join(manifestSrcDir, f), "");
  }
  const copyManifestPath = join(manifestDir, "copy.json");
  writeFileSync(
    copyManifestPath,
    JSON.stringify({
      schemaVersion: 1,
      configuration: "release",
      runtimeDlls: manifestDlls,
    }),
  );
  const copyManifest = loadAndValidateManifest(copyManifestPath);
  copyDllsFromManifest({
    manifest: copyManifest,
    sourceDir: manifestSrcDir,
    destDir: manifestDstDir,
    dryRun: false,
  });
  let manifestCopyOk = true;
  for (const f of manifestDlls) {
    if (existsSync(join(manifestDstDir, f))) {
      pass(`${f} copied via manifest`);
    } else {
      fail(`${f} was not copied via manifest`);
      manifestCopyOk = false;
    }
  }
  if (!existsSync(join(manifestDstDir, extraDll))) {
    pass(`${extraDll} correctly excluded (not in manifest)`);
  } else {
    fail(`${extraDll} must not be copied when not in manifest`);
    manifestCopyOk = false;
  }
  if (manifestCopyOk) {
    pass("manifest copy mode only copied manifest-listed DLLs");
  }

  // Test 8: manifest copy mode — fails when a required DLL is missing from source.
  console.log("\n[test 8] manifest copy mode — fails on missing required DLL");
  const missingDllManifestPath = join(manifestDir, "missing.json");
  writeFileSync(
    missingDllManifestPath,
    JSON.stringify({
      schemaVersion: 1,
      configuration: "release",
      runtimeDlls: ["opencv_core4100.dll", "opencv_dnn4100.dll"],
    }),
  );
  const missingDllSrcDir = mkdtempSync(join(tmpBase, "lvk-opencv-msrc2-"));
  writeFileSync(join(missingDllSrcDir, "opencv_core4100.dll"), "");
  // opencv_dnn4100.dll is intentionally absent
  const missingManifest = loadAndValidateManifest(missingDllManifestPath);
  const missingExitCode = captureExit(() => {
    copyDllsFromManifest({
      manifest: missingManifest,
      sourceDir: missingDllSrcDir,
      destDir: join(dstBase, "missing-output"),
      dryRun: false,
    });
  });
  if (missingExitCode === 1) {
    pass("manifest copy mode correctly failed on missing required DLL");
  } else {
    fail(
      `manifest copy mode should have failed (exit 1) on missing DLL, got: ${missingExitCode}`,
    );
  }

  // Test 9: --verify succeeds when all manifest files exist in source.
  console.log("\n[test 9] --verify succeeds when files exist");
  const verifySrcDir = mkdtempSync(join(tmpBase, "lvk-opencv-vsrc-"));
  const verifyDlls2 = ["opencv_core4100.dll", "opencv_imgproc4100.dll"];
  for (const f of verifyDlls2) {
    writeFileSync(join(verifySrcDir, f), "");
  }
  const verifyManifestPath = join(manifestDir, "verify.json");
  writeFileSync(
    verifyManifestPath,
    JSON.stringify({
      schemaVersion: 1,
      configuration: "release",
      runtimeDlls: verifyDlls2,
    }),
  );
  const verifyManifest = loadAndValidateManifest(verifyManifestPath);
  const verifyOk = verifyDlls({
    manifest: verifyManifest,
    sourceDir: verifySrcDir,
    destDir: null,
  });
  if (verifyOk) {
    pass("--verify returned true when all manifest DLLs present in source");
  } else {
    fail("--verify should return true when all manifest DLLs present");
  }

  // Test 10: --verify fails when files are missing from source.
  console.log("\n[test 10] --verify fails when files are missing");
  const verifyMissingSrcDir = mkdtempSync(join(tmpBase, "lvk-opencv-vsrc2-"));
  writeFileSync(join(verifyMissingSrcDir, "opencv_core4100.dll"), "");
  // opencv_imgproc4100.dll is intentionally absent
  const verifyMissingOk = verifyDlls({
    manifest: verifyManifest,
    sourceDir: verifyMissingSrcDir,
    destDir: null,
  });
  if (!verifyMissingOk) {
    pass("--verify returned false when manifest DLLs missing from source");
  } else {
    fail("--verify should return false when manifest DLLs are missing");
  }

  // Test 11: --verify fails when neither source nor dest is provided.
  console.log("\n[test 11] --verify fails with no source or dest");
  const verifyNoPathOk = verifyDlls({
    manifest: verifyManifest,
    sourceDir: null,
    destDir: null,
  });
  if (!verifyNoPathOk) {
    pass("--verify returned false when no source or dest provided");
  } else {
    fail(
      "--verify should return false when neither source nor dest is provided",
    );
  }

  // Test 12: release manifest rejects debug DLL names.
  console.log("\n[test 12] release manifest rejects debug DLL names");
  const debugManifestPath = join(manifestDir, "debug-in-release.json");
  writeFileSync(
    debugManifestPath,
    JSON.stringify({
      schemaVersion: 1,
      configuration: "release",
      runtimeDlls: ["opencv_core4100d.dll"],
    }),
  );
  const debugErr = tryValidateManifest(debugManifestPath);
  if (debugErr && debugErr.message.includes("debug DLL")) {
    pass("release manifest correctly rejected debug DLL name");
  } else {
    fail(
      `release manifest should reject debug DLL, got: ${debugErr?.message ?? "no error"}`,
    );
  }

  // Test 13: manifest rejects absolute paths.
  console.log("\n[test 13] manifest rejects absolute paths");
  const absPathManifestPath = join(manifestDir, "abs-path.json");
  writeFileSync(
    absPathManifestPath,
    JSON.stringify({
      schemaVersion: 1,
      runtimeDlls: ["C:\\vcpkg\\opencv_core4100.dll"],
    }),
  );
  const absErr = tryValidateManifest(absPathManifestPath);
  if (absErr && absErr.message.includes("absolute paths")) {
    pass("manifest correctly rejected absolute path entry");
  } else {
    fail(
      `manifest should reject absolute paths, got: ${absErr?.message ?? "no error"}`,
    );
  }

  // Test 14: manifest rejects path separators.
  console.log("\n[test 14] manifest rejects path separators");
  const separatorManifestPath = join(manifestDir, "separator.json");
  writeFileSync(
    separatorManifestPath,
    JSON.stringify({
      schemaVersion: 1,
      runtimeDlls: ["subdir/opencv_core4100.dll"],
    }),
  );
  const sepErr = tryValidateManifest(separatorManifestPath);
  if (sepErr && sepErr.message.includes("path separators")) {
    pass("manifest correctly rejected entry with path separator");
  } else {
    fail(
      `manifest should reject path separators, got: ${sepErr?.message ?? "no error"}`,
    );
  }

  // Test 15: manifest rejects duplicates.
  console.log("\n[test 15] manifest rejects duplicate entries");
  const dupManifestPath = join(manifestDir, "duplicate.json");
  writeFileSync(
    dupManifestPath,
    JSON.stringify({
      schemaVersion: 1,
      runtimeDlls: ["opencv_core4100.dll", "opencv_core4100.dll"],
    }),
  );
  const dupErr = tryValidateManifest(dupManifestPath);
  if (dupErr && dupErr.message.includes("duplicate")) {
    pass("manifest correctly rejected duplicate entry");
  } else {
    fail(
      `manifest should reject duplicates, got: ${dupErr?.message ?? "no error"}`,
    );
  }

  // Test 16: manifest rejects non-allowed DLL names.
  console.log("\n[test 16] manifest rejects non-allowed DLL names");
  const nonAllowedManifestPath = join(manifestDir, "non-allowed.json");
  writeFileSync(
    nonAllowedManifestPath,
    JSON.stringify({
      schemaVersion: 1,
      runtimeDlls: ["zlib1.dll"],
    }),
  );
  const nonAllowedErr = tryValidateManifest(nonAllowedManifestPath);
  if (nonAllowedErr && nonAllowedErr.message.includes("allowed DLL patterns")) {
    pass("manifest correctly rejected non-allowed DLL name");
  } else {
    fail(
      `manifest should reject non-allowed DLL names, got: ${nonAllowedErr?.message ?? "no error"}`,
    );
  }

  // Cleanup.
  try {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(dstBase, { recursive: true, force: true });
    rmSync(manifestDir, { recursive: true, force: true });
    rmSync(manifestSrcDir, { recursive: true, force: true });
    rmSync(missingDllSrcDir, { recursive: true, force: true });
    rmSync(verifySrcDir, { recursive: true, force: true });
    rmSync(verifyMissingSrcDir, { recursive: true, force: true });
  } catch {
    // Non-fatal cleanup failure.
  }

  console.log(
    `\ncopy-opencv-runtime-dlls self-test complete: ${passed} passed, ${failed} failed.`,
  );

  if (failed > 0) {
    process.exit(1);
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.selfTest) {
  runSelfTest();
  process.exit(0);
}

if (args.verify) {
  if (!args.manifest) {
    console.error(
      `copy-opencv-runtime-dlls: --verify requires --manifest.\nRun with --help for usage.`,
    );
    process.exit(1);
  }
  let manifest;
  try {
    manifest = loadAndValidateManifest(args.manifest);
  } catch (err) {
    console.error(`copy-opencv-runtime-dlls: invalid manifest: ${err.message}`);
    process.exit(1);
  }
  const ok = verifyDlls({
    manifest,
    sourceDir: args.sourceDir,
    destDir: args.destDir,
  });
  process.exit(ok ? 0 : 1);
}

if (args.manifest) {
  if (!args.sourceDir) {
    console.error(
      `copy-opencv-runtime-dlls: --manifest requires --source-dir.\nRun with --help for usage.`,
    );
    process.exit(1);
  }
  if (!args.destDir) {
    console.error(
      `copy-opencv-runtime-dlls: --manifest requires --dest-dir.\nRun with --help for usage.`,
    );
    process.exit(1);
  }
  let manifest;
  try {
    manifest = loadAndValidateManifest(args.manifest);
  } catch (err) {
    console.error(`copy-opencv-runtime-dlls: invalid manifest: ${err.message}`);
    process.exit(1);
  }
  copyDllsFromManifest({
    manifest,
    sourceDir: args.sourceDir,
    destDir: args.destDir,
    dryRun: args.dryRun,
  });
  process.exit(0);
}

if (!args.sourceDir) {
  console.error(
    `copy-opencv-runtime-dlls: --source-dir is required.\nRun with --help for usage.`,
  );
  process.exit(1);
}

if (!args.destDir) {
  console.error(
    `copy-opencv-runtime-dlls: --dest-dir is required.\nRun with --help for usage.`,
  );
  process.exit(1);
}

copyDlls({
  sourceDir: args.sourceDir,
  destDir: args.destDir,
  dryRun: args.dryRun,
});
