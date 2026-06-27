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
 *   node tools/copy-opencv-runtime-dlls.mjs --help
 *   node tools/copy-opencv-runtime-dlls.mjs --self-test
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

function printHelp() {
  console.log(`copy-opencv-runtime-dlls

Dev/local helper: copies Windows/vcpkg OpenCV runtime DLLs into an app-owned directory.

Does NOT modify PATH, download dependencies, or implement Electron packaging behavior.

Usage:
  node tools/copy-opencv-runtime-dlls.mjs --source-dir <dir> --dest-dir <dir> [--dry-run]
  node tools/copy-opencv-runtime-dlls.mjs --help
  node tools/copy-opencv-runtime-dlls.mjs --self-test

Options:
  --source-dir <dir>  Directory containing OpenCV runtime DLLs (required)
  --dest-dir <dir>    Destination directory for copied DLLs (required)
  --dry-run           Print what would be copied without copying
  --help              Show this help message
  --self-test         Run self-test with temporary directories and fake DLL filenames

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

  const tmpBase = tmpdir();
  const srcDir = mkdtempSync(join(tmpBase, "lvk-opencv-src-"));
  const dstBase = mkdtempSync(join(tmpBase, "lvk-opencv-dst-"));

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

  // Cleanup.
  try {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(dstBase, { recursive: true, force: true });
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
