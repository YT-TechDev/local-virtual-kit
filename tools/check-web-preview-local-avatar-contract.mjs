#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT_PACKAGE_URL = new URL("../package.json", import.meta.url);
const WEB_PACKAGE_URL = new URL(
  "../apps/web-preview/package.json",
  import.meta.url,
);
const LOCAL_AVATAR_URL = new URL(
  "../apps/web-preview/src/avatar/useLocalGlbAvatar.ts",
  import.meta.url,
);
const LOADED_GLB_URL = new URL(
  "../apps/web-preview/src/components/LoadedGlbAvatar.tsx",
  import.meta.url,
);
const AVATAR_PREVIEW_URL = new URL(
  "../apps/web-preview/src/components/AvatarPreview.tsx",
  import.meta.url,
);
const APP_CSS_URL = new URL("../apps/web-preview/src/App.css", import.meta.url);
const LOCAL_AVATAR_WORKSPACE_URL = new URL(
  "../apps/web-preview/src/avatar/localAvatarWorkspace.ts",
  import.meta.url,
);

const requireFromWebPreview = createRequire(WEB_PACKAGE_URL);
const ts = requireFromWebPreview("typescript");

const fail = (message) => {
  throw new Error(`Web Preview local avatar contract check failed: ${message}`);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const countOccurrences = (source, needle) => {
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
};

const sliceBetween = (source, startNeedle, endNeedle, label) => {
  const startIndex = source.indexOf(startNeedle);
  assert(startIndex !== -1, `${label}: missing start marker ${startNeedle}`);
  const endIndex = source.indexOf(endNeedle, startIndex + startNeedle.length);
  assert(endIndex !== -1, `${label}: missing end marker ${endNeedle}`);
  return { startIndex, endIndex, slice: source.slice(startIndex, endIndex) };
};

const sliceFunction = (source, functionNeedle, nextNeedle, label) =>
  sliceBetween(source, functionNeedle, nextNeedle, label).slice;

const getCssRule = (source, selector) => {
  const selectorIndex = source.indexOf(selector);
  assert(
    selectorIndex !== -1,
    `OBS transparency/full viewport: missing CSS selector ${selector}`,
  );
  const openIndex = source.indexOf("{", selectorIndex);
  assert(
    openIndex !== -1,
    `OBS transparency/full viewport: missing CSS rule open for ${selector}`,
  );
  const closeIndex = source.indexOf("}", openIndex);
  assert(
    closeIndex !== -1,
    `OBS transparency/full viewport: missing CSS rule close for ${selector}`,
  );
  return source.slice(openIndex + 1, closeIndex);
};

const assertNotContainsAny = (source, needles, label) => {
  for (const needle of needles) {
    assert(!source.includes(needle), `${label}: unexpected ${needle}`);
  }
};

const assertOrdered = (source, needles, label) => {
  let previousIndex = -1;
  for (const needle of needles) {
    const index = source.indexOf(needle);
    assert(index !== -1, `${label}: missing ${needle}`);
    assert(
      index > previousIndex,
      `${label}: ${needle} must appear after the previous contract marker`,
    );
    previousIndex = index;
  }
};

const loadWorkspaceModule = async () => {
  const source = await readFile(LOCAL_AVATAR_WORKSPACE_URL, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: "localAvatarWorkspace.ts",
  });
  const tempDir = await mkdtemp(join(tmpdir(), "lvk-local-avatar-workspace-"));
  const tempModulePath = join(tempDir, "localAvatarWorkspace.mjs");
  await writeFile(tempModulePath, output.outputText, "utf8");
  try {
    return await import(pathToFileURL(tempModulePath).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const assertEqual = (actual, expected, label) => {
  assert(
    Object.is(actual, expected),
    `${label}: expected ${expected}, received ${actual}`,
  );
};

const assertArrayBufferBytes = (buffer, expected, label) => {
  const actual = Array.from(new Uint8Array(buffer));
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected bytes ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
  );
};

const createMemoryRecordStoreOpener = (initialRecord, options = {}) => {
  let storedRecord = initialRecord;
  const openedStores = [];
  const opener = async () => {
    if (options.openThrows) throw new Error("open failed");
    const store = {
      closed: false,
      readCalls: 0,
      writeCalls: 0,
      deleteCalls: 0,
      async read() {
        this.readCalls += 1;
        if (options.readThrows) throw new Error("read failed");
        return storedRecord;
      },
      async write(value) {
        this.writeCalls += 1;
        if (options.writeThrows) throw new Error("write failed");
        storedRecord = value;
      },
      async delete() {
        this.deleteCalls += 1;
        if (options.deleteThrows) throw new Error("delete failed");
        storedRecord = undefined;
      },
      close() {
        this.closed = true;
      },
    };
    openedStores.push(store);
    return store;
  };
  opener.openedStores = openedStores;
  opener.getStoredRecord = () => storedRecord;
  return opener;
};

const withFakeIndexedDB = async (fakeIndexedDB, callback) => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "indexedDB",
  );
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: fakeIndexedDB,
  });
  try {
    await callback();
  } finally {
    if (previousDescriptor === undefined) {
      delete globalThis.indexedDB;
    } else {
      Object.defineProperty(globalThis, "indexedDB", previousDescriptor);
    }
  }
};

const createManualIndexedDBOpenFake = () => {
  const requests = [];
  return {
    requests,
    open(name, version) {
      const request = {
        name,
        version,
        result: undefined,
        onblocked: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
      };
      requests.push(request);
      return request;
    },
  };
};

const createFakeOpenDatabase = () => ({
  closeCalls: 0,
  objectStoreNames: {
    contains() {
      return true;
    },
  },
  createObjectStore() {
    fail("fake IndexedDB open regression: unexpected object store creation");
  },
  transaction() {
    fail("fake IndexedDB open regression: unexpected transaction use");
  },
  close() {
    this.closeCalls += 1;
  },
});

const runCheck = async () => {
  const [
    rootPackageSource,
    webPackageSource,
    loaderSource,
    loadedSource,
    previewSource,
    cssSource,
    workspaceSource,
  ] = await Promise.all([
    readFile(ROOT_PACKAGE_URL, "utf8"),
    readFile(WEB_PACKAGE_URL, "utf8"),
    readFile(LOCAL_AVATAR_URL, "utf8"),
    readFile(LOADED_GLB_URL, "utf8"),
    readFile(AVATAR_PREVIEW_URL, "utf8"),
    readFile(APP_CSS_URL, "utf8"),
    readFile(LOCAL_AVATAR_WORKSPACE_URL, "utf8"),
  ]);
  const workspaceModule = await loadWorkspaceModule();
  const rootPackage = JSON.parse(rootPackageSource);
  const webPackage = JSON.parse(webPackageSource);
  const rootTest = rootPackage.scripts.test;
  const webTest = webPackage.scripts.test;
  const localCommand =
    "node ../../tools/check-web-preview-local-avatar-contract.mjs";
  const obsCommand =
    "node ../../tools/check-web-preview-obs-route-contract.mjs";

  assert(
    rootPackage.scripts["test:web-preview-local-avatar-contract"] ===
      "node tools/check-web-preview-local-avatar-contract.mjs",
    "exact-once test registration: root focused command must exist with exact value",
  );
  assert(
    webTest.includes(localCommand),
    "exact-once test registration: Web Preview test chain must include local avatar checker",
  );
  assert(
    countOccurrences(webTest, localCommand) === 1,
    "exact-once test registration: Web Preview test chain must include local avatar checker exactly once",
  );
  assert(
    !rootTest.includes("test:web-preview-local-avatar-contract"),
    "exact-once test registration: root test must not directly call focused command",
  );
  assert(
    !rootTest.includes("check-web-preview-local-avatar-contract.mjs"),
    "exact-once test registration: root test must not directly call checker file",
  );
  assert(
    rootTest.includes("pnpm -r --if-present test"),
    "exact-once test registration: root test must still reach package tests",
  );
  assert(
    countOccurrences(webTest, obsCommand) === 1,
    "exact-once test registration: existing OBS checker must remain registered exactly once",
  );
  assert(
    webTest.indexOf(localCommand) < webTest.indexOf(obsCommand),
    "exact-once test registration: local avatar checker must run immediately before OBS checker",
  );
  assert(
    webTest.includes(`${localCommand} && ${obsCommand}`),
    "exact-once test registration: local avatar checker must be immediately before OBS checker",
  );

  for (const constantNeedle of [
    "export const DEFAULT_LOCAL_AVATAR_SCALE = 1",
    "export const MIN_LOCAL_AVATAR_SCALE = 0.25",
    "export const MAX_LOCAL_AVATAR_SCALE = 3",
    "export const LOCAL_AVATAR_SCALE_STEP = 0.05",
    "export const DEFAULT_LOCAL_AVATAR_VERTICAL_OFFSET = 0",
    "export const MIN_LOCAL_AVATAR_VERTICAL_OFFSET = -2",
    "export const MAX_LOCAL_AVATAR_VERTICAL_OFFSET = 2",
    "export const LOCAL_AVATAR_VERTICAL_OFFSET_STEP = 0.05",
    "export const DEFAULT_LOCAL_AVATAR_YAW_DEGREES = 0",
    "export const MIN_LOCAL_AVATAR_YAW_DEGREES = -180",
    "export const MAX_LOCAL_AVATAR_YAW_DEGREES = 180",
    "export const LOCAL_AVATAR_YAW_STEP_DEGREES = 1",
  ])
    assert(
      workspaceSource.includes(constantNeedle),
      `extracted framing contract: missing ${constantNeedle}`,
    );
  assert(
    previewSource.includes('from "../avatar/localAvatarWorkspace"'),
    "extracted framing contract: AvatarPreview must import shared constants",
  );
  assert(
    !previewSource.includes("const DEFAULT_LOCAL_AVATAR_SCALE = 1") &&
      !previewSource.includes("const MIN_LOCAL_AVATAR_SCALE = 0.25") &&
      !previewSource.includes("const MAX_LOCAL_AVATAR_YAW_DEGREES = 180"),
    "extracted framing contract: old local constant definitions must be removed from AvatarPreview",
  );
  assert(
    previewSource.includes(
      "const [localAvatarScale, setLocalAvatarScale] = useState(\n    DEFAULT_LOCAL_AVATAR_SCALE,\n  );",
    ),
    "local avatar scale control: scale state must be renderer-owned React state initialized to default",
  );
  assert(
    previewSource.includes(
      "const localAvatarScaleValueText = `${localAvatarScale.toFixed(2)}×`;",
    ),
    "local avatar scale control: current value text must format scale as multiplier",
  );
  for (const stateNeedle of [
    "const [localAvatarVerticalOffset, setLocalAvatarVerticalOffset] = useState(\n    DEFAULT_LOCAL_AVATAR_VERTICAL_OFFSET,\n  );",
    "const [localAvatarYawDegrees, setLocalAvatarYawDegrees] = useState(\n    DEFAULT_LOCAL_AVATAR_YAW_DEGREES,\n  );",
    "localAvatarVerticalOffset.toFixed(2)",
    "const localAvatarYawValueText = `${localAvatarYawDegrees}°`;",
    "const degreesToRadians = (degrees: number) =>",
    "return (degrees * Math.PI) / 180;",
  ])
    assert(
      previewSource.includes(stateNeedle),
      `local avatar framing controls: missing ${stateNeedle}`,
    );

  const controls = sliceBetween(
    previewSource,
    "{!isObsMode && (",
    '{debugMode === "motion" && (',
    "local controls inside !isObsMode",
  );
  const panel = sliceBetween(
    controls.slice,
    'className="preview-local-avatar-panel"',
    'className="preview-calibration-panel"',
    "local controls inside !isObsMode",
  ).slice;

  for (const scaleNeedle of [
    "Avatar scale",
    'type="range"',
    "min={MIN_LOCAL_AVATAR_SCALE}",
    "max={MAX_LOCAL_AVATAR_SCALE}",
    "step={LOCAL_AVATAR_SCALE_STEP}",
    "value={localAvatarScale}",
    "onChange={handleLocalAvatarScaleChange}",
    "disabled={localGlbAvatar.asset === null}",
    "aria-valuetext={localAvatarScaleValueText}",
    "<output",
    "htmlFor={LOCAL_AVATAR_SCALE_ID}",
    "{localAvatarScaleValueText}",
    "Reset framing",
    "onClick={handleResetLocalAvatarFraming}",
  ])
    assert(
      panel.includes(scaleNeedle),
      `local avatar scale control: panel missing ${scaleNeedle}`,
    );
  for (const framingNeedle of [
    "Vertical offset",
    "min={MIN_LOCAL_AVATAR_VERTICAL_OFFSET}",
    "max={MAX_LOCAL_AVATAR_VERTICAL_OFFSET}",
    "step={LOCAL_AVATAR_VERTICAL_OFFSET_STEP}",
    "value={localAvatarVerticalOffset}",
    "onChange={handleLocalAvatarVerticalOffsetChange}",
    "aria-valuetext={localAvatarVerticalOffsetAriaValueText}",
    "htmlFor={LOCAL_AVATAR_VERTICAL_OFFSET_ID}",
    "{localAvatarVerticalOffsetValueText}",
    "Yaw orientation",
    "min={MIN_LOCAL_AVATAR_YAW_DEGREES}",
    "max={MAX_LOCAL_AVATAR_YAW_DEGREES}",
    "step={LOCAL_AVATAR_YAW_STEP_DEGREES}",
    "value={localAvatarYawDegrees}",
    "onChange={handleLocalAvatarYawChange}",
    "aria-valuetext={localAvatarYawAriaValueText}",
    "htmlFor={LOCAL_AVATAR_YAW_ID}",
    "{localAvatarYawValueText}",
  ])
    assert(
      panel.includes(framingNeedle),
      `local avatar framing controls: panel missing ${framingNeedle}`,
    );
  assert(
    countOccurrences(panel, 'type="range"') === 3,
    "local avatar framing controls: panel must expose exactly three range inputs",
  );
  for (const { id, label } of [
    { id: "LOCAL_AVATAR_SCALE_ID", label: "Avatar scale" },
    {
      id: "LOCAL_AVATAR_VERTICAL_OFFSET_ID",
      label: "Vertical offset",
    },
    { id: "LOCAL_AVATAR_YAW_ID", label: "Yaw orientation" },
  ]) {
    const inputBlock = sliceBetween(
      panel,
      `id={${id}}`,
      "/>",
      `local avatar framing controls: ${label} range input`,
    ).slice;
    assert(
      inputBlock.includes("disabled={localGlbAvatar.asset === null}"),
      `local avatar framing controls: ${label} range input must be disabled until a local GLB asset is ready`,
    );
  }

  const scaleHandler = sliceBetween(
    previewSource,
    "const handleLocalAvatarScaleChange",
    "const handleLocalAvatarVerticalOffsetChange",
    "local avatar scale control",
  ).slice;
  assert(
    scaleHandler.includes("setLocalAvatarScale(event.target.valueAsNumber)"),
    "local avatar scale control: range handler must update renderer-owned scale state",
  );
  const verticalOffsetHandler = sliceBetween(
    previewSource,
    "const handleLocalAvatarVerticalOffsetChange",
    "const handleLocalAvatarYawChange",
    "local avatar vertical offset control",
  ).slice;
  assert(
    verticalOffsetHandler.includes(
      "setLocalAvatarVerticalOffset(event.target.valueAsNumber)",
    ),
    "local avatar vertical offset control: range handler must update renderer-owned vertical offset state",
  );
  const yawHandler = sliceBetween(
    previewSource,
    "const handleLocalAvatarYawChange",
    "const handleResetLocalAvatarFraming",
    "local avatar yaw control",
  ).slice;
  assert(
    yawHandler.includes("setLocalAvatarYawDegrees(event.target.valueAsNumber)"),
    "local avatar yaw control: range handler must update renderer-owned yaw degree state",
  );
  const resetFramingDisabled = sliceBetween(
    previewSource,
    "const resetLocalAvatarFramingDisabled =",
    "const localAvatarStatusText =",
    "local avatar framing controls",
  ).slice;
  assert(
    resetFramingDisabled.includes(
      "localAvatarScale === DEFAULT_LOCAL_AVATAR_SCALE",
    ) &&
      resetFramingDisabled.includes(
        "localAvatarVerticalOffset === DEFAULT_LOCAL_AVATAR_VERTICAL_OFFSET",
      ) &&
      resetFramingDisabled.includes(
        "localAvatarYawDegrees === DEFAULT_LOCAL_AVATAR_YAW_DEGREES",
      ),
    "local avatar framing controls: reset disabled expression must compare scale, vertical offset, and yaw to defaults",
  );
  assert(
    countOccurrences(resetFramingDisabled, "&&") === 2,
    "local avatar framing controls: reset disabled expression must use AND semantics across all three framing defaults",
  );
  const resetFramingHandler = sliceBetween(
    previewSource,
    "const handleResetLocalAvatarFraming",
    "const handleLocalAvatarFileChange",
    "local avatar scale control",
  ).slice;
  assert(
    resetFramingHandler.includes(
      "setLocalAvatarScale(DEFAULT_LOCAL_AVATAR_SCALE)",
    ) &&
      resetFramingHandler.includes(
        "setLocalAvatarVerticalOffset(DEFAULT_LOCAL_AVATAR_VERTICAL_OFFSET)",
      ) &&
      resetFramingHandler.includes(
        "setLocalAvatarYawDegrees(DEFAULT_LOCAL_AVATAR_YAW_DEGREES)",
      ),
    "local avatar framing controls: reset framing must restore scale, vertical offset, and yaw defaults",
  );
  assert(
    panel.includes("disabled={resetLocalAvatarFramingDisabled}"),
    "local avatar framing controls: reset button must use the resetLocalAvatarFramingDisabled expression",
  );
  assert(
    resetFramingHandler.includes("DEFAULT_LOCAL_AVATAR_SCALE") &&
      !resetFramingHandler.includes("localGlbAvatar.reset"),
    "local avatar scale control: reset framing must remain separate from asset reset",
  );

  assert(
    panel.includes("Local GLB file"),
    "local controls inside !isObsMode: local avatar panel label missing",
  );
  assert(
    panel.includes('type="file"'),
    ".glb restriction: local avatar input must be a file input",
  );
  assert(
    panel.includes('accept=".glb,model/gltf-binary"'),
    ".glb restriction: file input must accept .glb/model/gltf-binary",
  );
  assert(
    panel.includes("onChange={handleLocalAvatarFileChange}"),
    ".glb restriction: file input must call local avatar file handler",
  );
  assert(
    !panel.includes("multiple"),
    ".glb restriction: local avatar input must not allow multiple files",
  );
  assert(
    !panel.includes('type="url"') && !panel.includes('type="text"'),
    ".glb restriction: local avatar panel must not expose URL/text avatar location input",
  );
  const handler = sliceBetween(
    previewSource,
    "const handleLocalAvatarFileChange",
    "const handleCopyEndpoint",
    ".glb restriction",
  ).slice;
  assert(
    handler.includes("event.target.files?.item(0)"),
    ".glb restriction: file handler must read only the first selected file",
  );
  assert(
    handler.includes("localGlbAvatar.loadFile(selectedFile)"),
    ".glb restriction: file handler must forward the File object to the loader",
  );

  assert(
    loaderSource.includes('from "three/examples/jsm/loaders/GLTFLoader.js"'),
    "existing GLTFLoader path: must import Three.js GLTFLoader directly",
  );
  assert(
    loaderSource.includes('fileName.toLowerCase().endsWith(".glb")'),
    ".glb restriction: loader must validate .glb extension",
  );
  assert(
    loaderSource.includes("async (file: File)"),
    "renderer-owned in-memory state: loader must consume a browser File",
  );
  assert(
    loaderSource.includes("file.arrayBuffer()"),
    "renderer-owned in-memory state: loader must read bytes from file.arrayBuffer()",
  );
  assert(
    loaderSource.includes('loader.parseAsync(fileBytes, "")'),
    "existing GLTFLoader path: loader must parse ArrayBuffer with parseAsync",
  );
  assertNotContainsAny(
    loaderSource,
    ["loader.load(", "loader.loadAsync(", "fetch("],
    "remote/external resource blocking",
  );
  assert(
    !/https?:\/\//.test(loaderSource),
    "remote/external resource blocking: loader must not introduce http(s) avatar-loading literals",
  );
  assert(
    loaderSource.includes("new THREE.LoadingManager()"),
    "remote/external resource blocking: must create a LoadingManager",
  );
  assert(
    loaderSource.includes("loadingManager.setURLModifier"),
    "remote/external resource blocking: must install URL modifier",
  );
  assert(
    loaderSource.includes('normalizedUrl.startsWith("blob:")') &&
      loaderSource.includes('normalizedUrl.startsWith("data:")'),
    "remote/external resource blocking: URL modifier must allow only blob/data generated resources",
  );
  assert(
    loaderSource.includes("throw new Error(LOCAL_ONLY_RESOURCE_ERROR)"),
    "remote/external resource blocking: disallowed URLs must throw local-only error",
  );
  assert(
    loaderSource.includes("new GLTFLoader(createLocalOnlyLoadingManager())"),
    "remote/external resource blocking: GLTFLoader must receive local-only LoadingManager",
  );

  const statusType = sliceBetween(
    loaderSource,
    "export type LocalGlbAvatarLoadStatus",
    ";",
    "renderer-owned in-memory state",
  ).slice;
  for (const state of ['"idle"', '"loading"', '"ready"', '"error"'])
    assert(
      statusType.includes(state),
      `renderer-owned in-memory state: missing status ${state}`,
    );
  assert(
    countOccurrences(statusType, '"') === 8,
    "renderer-owned in-memory state: load status union must contain exactly four literals",
  );
  const controllerType = sliceBetween(
    loaderSource,
    "export type LocalGlbAvatarController",
    "};",
    "renderer-owned in-memory state",
  ).slice;
  for (const member of [
    "asset",
    "errorMessage",
    "pendingFileName",
    "status",
    "loadFile",
    "reset",
  ])
    assert(
      controllerType.includes(member),
      `renderer-owned in-memory state: controller missing ${member}`,
    );
  assert(
    countOccurrences(loaderSource, "useState<") >= 4,
    "renderer-owned in-memory state: local avatar state must be React-owned through useState",
  );
  assertNotContainsAny(
    loaderSource,
    [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "writeFile",
      "createWriteStream",
    ],
    "renderer-owned in-memory state",
  );
  for (const framingIdentifier of [
    "localAvatarScale",
    "localAvatarVerticalOffset",
    "localAvatarYawDegrees",
  ]) {
    const firstIndex = previewSource.indexOf(framingIdentifier);
    const lastIndex = previewSource.lastIndexOf(framingIdentifier);
    const framingScope = previewSource.slice(
      Math.max(0, firstIndex - 500),
      Math.min(
        previewSource.length,
        lastIndex + framingIdentifier.length + 500,
      ),
    );
    assertNotContainsAny(
      framingScope,
      [
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "ipcRenderer",
        "window.electron",
        "fetch(",
        "WebSocket(",
      ],
      `renderer-owned memory-only framing: ${framingIdentifier}`,
    );
  }

  const loadFile = sliceBetween(
    loaderSource,
    "async (file: File) =>",
    "[replaceAsset]",
    ".glb restriction",
  ).slice;
  assert(
    loadFile.indexOf("requestGenerationRef.current = requestGeneration") <
      loadFile.indexOf("if (!hasGlbExtension(file.name))"),
    ".glb restriction: request generation must advance before extension validation",
  );
  const unsupported = sliceBetween(
    loadFile,
    "if (!hasGlbExtension(file.name))",
    "setErrorMessage(null)",
    ".glb restriction",
  ).slice;
  assert(
    unsupported.includes("setErrorMessage(UNSUPPORTED_FILE_ERROR)"),
    ".glb restriction: unsupported file must set sanitized error",
  );
  assert(
    unsupported.includes("setPendingFileName(null)"),
    ".glb restriction: unsupported file must clear pending filename",
  );
  assert(
    unsupported.includes('setStatus("error")'),
    ".glb restriction: unsupported file must set error status",
  );
  assert(
    unsupported.includes("return;"),
    ".glb restriction: unsupported file must return before reading bytes",
  );
  assert(
    !unsupported.includes("file.arrayBuffer()"),
    ".glb restriction: unsupported file must not read bytes",
  );
  assert(
    !unsupported.includes("replaceAsset(null)") &&
      !unsupported.includes("disposeLocalGlbAvatarAsset(assetRef.current)"),
    "primitive fallback: unsupported selections must preserve current asset",
  );

  const successfulLoad = sliceBetween(
    loadFile,
    "const nextAsset =",
    "} catch (error) {",
    "ready asset handoff",
  ).slice;
  const staleCheckIndex = successfulLoad.indexOf(
    "requestGenerationRef.current !== requestGeneration",
  );
  const staleDisposeIndex = successfulLoad.indexOf(
    "disposeLocalGlbAvatarAsset(nextAsset)",
  );
  const staleReturnIndex = successfulLoad.indexOf(
    "return;",
    staleDisposeIndex + "disposeLocalGlbAvatarAsset(nextAsset)".length,
  );
  const assetCommitIndex = successfulLoad.indexOf("replaceAsset(nextAsset)");
  const readyStatusIndex = successfulLoad.indexOf('setStatus("ready")');
  assert(
    staleCheckIndex !== -1,
    "ready asset handoff: successful parse must verify request generation",
  );
  assert(
    staleDisposeIndex !== -1,
    "stale asset cleanup: stale successful asset must be disposed",
  );
  assert(
    staleReturnIndex !== -1,
    "ready asset handoff: stale successful assets must return after disposal",
  );
  assert(
    assetCommitIndex !== -1,
    "ready asset handoff: successful current load must commit nextAsset",
  );
  assert(
    countOccurrences(successfulLoad, "replaceAsset(nextAsset)") === 1,
    "ready asset handoff: successful current load must commit nextAsset exactly once",
  );
  assert(
    readyStatusIndex !== -1,
    "ready asset handoff: successful current load must set ready status",
  );
  assert(
    staleCheckIndex < staleDisposeIndex &&
      staleDisposeIndex < staleReturnIndex &&
      staleReturnIndex < assetCommitIndex,
    "ready asset handoff: stale assets must be checked, disposed, and returned before current asset commit",
  );
  assert(
    assetCommitIndex < readyStatusIndex,
    "ready asset handoff: nextAsset must be committed before ready status",
  );

  const catchBlock = sliceBetween(
    loadFile,
    "} catch (error) {",
    "}\n    },",
    "primitive fallback",
  ).slice;
  assert(
    catchBlock.includes("requestGenerationRef.current !== requestGeneration") &&
      catchBlock.includes("return;"),
    "primitive fallback: stale failures must return without feedback updates",
  );
  assert(
    catchBlock.includes("LOCAL_ONLY_RESOURCE_ERROR") &&
      catchBlock.includes("PARSE_ERROR"),
    "primitive fallback: current errors must be sanitized",
  );
  assert(
    catchBlock.includes("setPendingFileName(null)"),
    "primitive fallback: failed replacement must clear pending filename",
  );
  assert(
    catchBlock.includes('setStatus("error")'),
    "primitive fallback: failed replacement must set error status",
  );
  assert(
    !catchBlock.includes("replaceAsset") && !catchBlock.includes("setAsset"),
    "primitive fallback: failed replacement must not clear existing asset",
  );

  const reset = sliceBetween(
    loaderSource,
    "const reset = useCallback(() =>",
    "}, [replaceAsset]);",
    "reset wiring",
  ).slice;
  assert(
    reset.includes("requestGenerationRef.current += 1"),
    "reset wiring: reset must advance request generation",
  );
  assert(
    reset.includes("replaceAsset(null)"),
    "reset wiring: reset must clear committed asset through replaceAsset",
  );
  assert(
    reset.includes("setErrorMessage(null)") &&
      reset.includes("setPendingFileName(null)"),
    "reset wiring: reset must clear feedback state",
  );
  assert(
    reset.includes('setStatus("idle")'),
    "reset wiring: reset must return status to idle",
  );
  assert(
    !reset.includes("disposeLocalGlbAvatarAsset"),
    "reset wiring: reset must not synchronously dispose current asset before React commits fallback",
  );
  assert(
    loaderSource.includes("asset.scene.traverse(disposeObjectResources)"),
    "stale asset cleanup: disposal must traverse the scene",
  );
  assert(
    loaderSource.includes("maybeMesh.geometry?.dispose()"),
    "stale asset cleanup: geometry disposal missing",
  );
  assert(
    loaderSource.includes("material.dispose()"),
    "stale asset cleanup: material disposal missing",
  );
  assert(
    loaderSource.includes("texture.dispose()"),
    "stale asset cleanup: texture disposal missing",
  );
  assert(
    successfulLoad.includes("disposeLocalGlbAvatarAsset(nextAsset)"),
    "stale asset cleanup: stale successful assets must be disposed",
  );
  const replaceAsset = sliceBetween(
    loaderSource,
    "const replaceAsset = useCallback",
    "const reset = useCallback",
    "post-commit retired asset cleanup",
  ).slice;
  assert(
    replaceAsset.includes("pendingDisposalsRef.current.push(previousAsset)"),
    "post-commit retired asset cleanup: replaced assets must be queued",
  );
  assert(
    replaceAsset.includes(
      "previousAsset !== null && previousAsset !== nextAsset",
    ),
    "post-commit retired asset cleanup: only different previous assets should be queued",
  );
  assert(
    loaderSource.includes(
      "useEffect(() => {\n    drainPendingDisposals();\n  }, [asset, drainPendingDisposals]);",
    ),
    "post-commit retired asset cleanup: effect keyed by committed asset must drain pending disposals",
  );
  const unmount = sliceBetween(
    loaderSource,
    "return () => {",
    "};\n  }, []);",
    "post-commit retired asset cleanup",
  ).slice;
  assert(
    unmount.includes("assetRef.current") &&
      unmount.includes("...pendingDisposalsRef.current"),
    "post-commit retired asset cleanup: unmount must include current and queued assets",
  );
  assert(
    unmount.includes("new Set(assetsToDispose)"),
    "post-commit retired asset cleanup: unmount must deduplicate owned assets",
  );

  assert(
    loadedSource.includes("AvatarMotionState"),
    "AvatarMotionState prop wiring: LoadedGlbAvatar must import AvatarMotionState",
  );
  assert(
    loadedSource.includes("motion: AvatarMotionState") &&
      loadedSource.includes("scene: THREE.Group") &&
      loadedSource.includes("verticalOffset: number") &&
      loadedSource.includes("yawRadians: number"),
    "AvatarMotionState prop wiring: LoadedGlbAvatar props must include motion and scene",
  );
  assert(
    loadedSource.includes("position={motion.rootPosition}"),
    "root translation: loaded GLB must use AvatarMotionState rootPosition",
  );
  assert(
    loadedSource.includes("rotation={motion.headRotation}"),
    "coarse rotation: loaded GLB must use AvatarMotionState headRotation",
  );
  assert(
    loadedSource.includes("position={[0, verticalOffset, 0]}") &&
      loadedSource.includes("rotation={[0, yawRadians, 0]}") &&
      loadedSource.includes("<group scale={uniformScale} dispose={null}>") &&
      loadedSource.indexOf("position={motion.rootPosition}") <
        loadedSource.indexOf("position={[0, verticalOffset, 0]}") &&
      loadedSource.indexOf("rotation={[0, yawRadians, 0]}") <
        loadedSource.indexOf("rotation={motion.headRotation}") &&
      loadedSource.indexOf("rotation={motion.headRotation}") <
        loadedSource.indexOf("scale={uniformScale}") &&
      loadedSource.indexOf("scale={uniformScale}") <
        loadedSource.indexOf("<primitive object={scene}"),
    "local avatar framing controls: loaded GLB must use root, static vertical/yaw, head, static scale, primitive hierarchy",
  );
  const rootMotionGroup = sliceBetween(
    loadedSource,
    "<group position={motion.rootPosition} dispose={null}>",
    "</group>",
    "local avatar framing controls: root motion group",
  ).slice;
  const staticFramingGroup = sliceBetween(
    rootMotionGroup,
    "<group\n        position={[0, verticalOffset, 0]}\n        rotation={[0, yawRadians, 0]}\n        dispose={null}\n      >",
    "<primitive object={scene}",
    "local avatar framing controls: static framing group",
  ).slice;
  assert(
    staticFramingGroup.includes("rotation={motion.headRotation}"),
    "local avatar framing controls: static position and yaw must share one explicit framing wrapper before MotionFrame head rotation",
  );
  assertOrdered(
    loadedSource,
    [
      "position={motion.rootPosition}",
      "position={[0, verticalOffset, 0]}",
      "rotation={[0, yawRadians, 0]}",
      "rotation={motion.headRotation}",
      "scale={uniformScale}",
      "<primitive object={scene}",
    ],
    "local avatar framing controls: loaded GLB transform hierarchy",
  );
  assert(
    loadedSource.includes("<primitive object={scene}"),
    "AvatarMotionState prop wiring: loaded GLB scene must render as primitive",
  );
  assert(
    countOccurrences(loadedSource, "dispose={null}") === 5,
    "AvatarMotionState prop wiring: root, static framing, head motion, scale, and primitive ownership must all be protected with dispose={null}",
  );
  assertNotContainsAny(
    loadedSource,
    [
      "getObjectByName",
      "skeleton",
      "bone",
      "morphTarget",
      "AnimationMixer",
      "clipAction",
      "eyes",
      "mouth",
      "gaze",
      "expression",
      "scene.position",
      "scene.rotation",
      "scene.scale",
      "scene.clone",
      "clone(",
      "Box3",
    ],
    "AvatarMotionState prop wiring",
  );
  assert(
    !loadedSource.includes("mapMotionFrameToAvatar("),
    "AvatarMotionState prop wiring: LoadedGlbAvatar must not map MotionFrame directly",
  );

  const scene = sliceFunction(
    previewSource,
    "function AvatarScene(",
    "export function AvatarPreview(",
    "AvatarMotionState prop wiring",
  );
  assert(
    countOccurrences(scene, "mapMotionFrameToAvatar(") === 1,
    "AvatarMotionState prop wiring: AvatarScene must map MotionFrame exactly once",
  );
  for (const needle of [
    'source === "native"',
    "nativeFrame ?? stableNativeFallbackFrame",
    "createDummyMotionFrame(timestampMs)",
    "calibration",
    "applyRendererIdleApproximation",
    "smoothTrackingMotion",
    "computeLostTrackingFallbackMotion",
  ])
    assert(
      scene.includes(needle),
      `AvatarMotionState prop wiring: AvatarScene missing ${needle}`,
    );
  const rendererSelection = sliceBetween(
    scene,
    "{localAvatarScene === null ? (",
    ")}",
    "primitive fallback",
  ).slice;
  assert(
    rendererSelection.includes("<DummyAvatar"),
    "primitive fallback: primitive DummyAvatar branch missing",
  );
  assert(
    rendererSelection.includes("<LoadedGlbAvatar"),
    "primitive fallback: loaded GLB branch missing",
  );
  assert(
    countOccurrences(scene, "motion={fallbackState.renderedMotion}") === 2 &&
      rendererSelection.includes(
        "verticalOffset={localAvatarVerticalOffset}",
      ) &&
      scene.includes("yawRadians={degreesToRadians(localAvatarYawDegrees)}"),
    "AvatarMotionState prop wiring: both renderers must receive the same renderedMotion and loaded GLB must receive static framing props",
  );
  assert(
    countOccurrences(scene, "degreesToRadians(") === 1 &&
      scene.includes("yawRadians={degreesToRadians(localAvatarYawDegrees)}"),
    "local avatar yaw control: AvatarScene loaded-GLB path must convert stored degrees to radians exactly once",
  );
  assertNotContainsAny(
    loadedSource,
    ["degreesToRadians", "Math.PI", "degToRad", "MathUtils"],
    "local avatar yaw control: LoadedGlbAvatar must receive radians and must not convert degrees itself",
  );
  assertNotContainsAny(
    previewSource,
    ["MathUtils", "degToRad", "three/examples/jsm/math"],
    "local avatar yaw control: yaw conversion must not add Three.js math helpers or runtime dependencies",
  );

  const invocation = sliceBetween(
    previewSource,
    "<AvatarScene",
    "/>\n        </Canvas>",
    "AvatarMotionState prop wiring",
  ).slice;
  for (const prop of [
    "key={calibrationRevision}",
    "calibration={effectiveCalibration}",
    "nativeFrame={nativeFrame}",
    "localAvatarScale={localAvatarScale}",
    "localAvatarVerticalOffset={localAvatarVerticalOffset}",
    "localAvatarYawDegrees={localAvatarYawDegrees}",
    "smoothing={selectedPreset.smoothing}",
    "source={source}",
    "localAvatarScene={localGlbAvatar.asset?.scene ?? null}",
  ])
    assert(
      invocation.includes(prop),
      `AvatarMotionState prop wiring: AvatarScene invocation missing ${prop}`,
    );

  const statusLogic = sliceBetween(
    previewSource,
    "const localAvatarStatusText = (() =>",
    "})();",
    "primitive fallback",
  ).slice;
  for (const caseNeedle of [
    'case "idle"',
    'case "loading"',
    'case "ready"',
    'case "error"',
  ])
    assert(
      statusLogic.includes(caseNeedle),
      `primitive fallback: missing ${caseNeedle}`,
    );
  for (const marker of [
    "built-in primitive avatar",
    "built-in primitive remains rendered",
    "Error · built-in primitive is rendered",
    "keeping",
    "replacement GLB",
  ])
    assert(
      statusLogic.includes(marker),
      `primitive fallback: status copy missing semantic marker ${marker}`,
    );
  assert(
    panel.includes("onClick={localGlbAvatar.reset}"),
    "reset wiring: reset button must call localGlbAvatar.reset",
  );

  assert(
    previewSource.includes('useNativeMotionFrame(source === "native")'),
    "dummy/native source independence: native hook must stay gated by native source",
  );
  assert(
    scene.includes('source === "native"'),
    "dummy/native source independence: AvatarScene must branch on source",
  );
  assert(
    scene.includes("createDummyMotionFrame"),
    "dummy/native source independence: dummy route must create dummy MotionFrames",
  );
  assert(
    invocation.includes("source={source}"),
    "dummy/native source independence: source prop must reach AvatarScene",
  );

  assert(
    controls.slice.includes("preview-local-avatar-panel") &&
      controls.slice.includes('type="file"') &&
      countOccurrences(controls.slice, 'type="range"') === 3 &&
      controls.slice.includes("onClick={handleResetLocalAvatarFraming}") &&
      controls.slice.includes("onClick={localGlbAvatar.reset}"),
    "local controls inside !isObsMode: file input, exactly three framing ranges, reset framing, and reset local avatar must remain inside OBS exclusion gate",
  );
  assert(
    !controls.slice.includes("<AvatarScene"),
    "local controls inside !isObsMode: AvatarScene must not be inside controls gate",
  );
  assert(
    previewSource.indexOf("<AvatarScene") > controls.endIndex,
    "local controls inside !isObsMode: avatar rendering must remain after controls gate for OBS output",
  );

  assert(
    previewSource.includes('const isObsMode = mode === "obs";'),
    "OBS transparency/full viewport: isObsMode derivation missing",
  );
  assert(
    previewSource.includes("gl={{ alpha: isObsMode }}"),
    "OBS transparency/full viewport: Canvas alpha must follow OBS mode",
  );
  assert(
    previewSource.includes("preview-shell preview-shell--${mode}") &&
      previewSource.includes("preview-panel preview-panel--${mode}"),
    "OBS transparency/full viewport: mode-specific shell/panel classes missing",
  );
  assert(
    getCssRule(cssSource, ".preview-shell--obs").includes(
      "background: transparent",
    ),
    "OBS transparency/full viewport: OBS shell must be transparent",
  );
  const obsPanelRule = getCssRule(cssSource, ".preview-panel--obs");
  assert(
    obsPanelRule.includes("width: 100vw") &&
      obsPanelRule.includes("height: 100svh"),
    "OBS transparency/full viewport: OBS panel must fill viewport",
  );
  assert(
    getCssRule(cssSource, ".preview-panel--obs canvas").includes(
      "background: transparent",
    ),
    "OBS transparency/full viewport: OBS canvas must be transparent",
  );

  const {
    DEFAULT_LOCAL_AVATAR_SCALE,
    MIN_LOCAL_AVATAR_SCALE,
    MAX_LOCAL_AVATAR_SCALE,
    DEFAULT_LOCAL_AVATAR_VERTICAL_OFFSET,
    MIN_LOCAL_AVATAR_VERTICAL_OFFSET,
    MAX_LOCAL_AVATAR_VERTICAL_OFFSET,
    DEFAULT_LOCAL_AVATAR_YAW_DEGREES,
    MIN_LOCAL_AVATAR_YAW_DEGREES,
    MAX_LOCAL_AVATAR_YAW_DEGREES,
    LOCAL_AVATAR_WORKSPACE_SCHEMA_VERSION,
    LOCAL_AVATAR_WORKSPACE_DATABASE_NAME,
    LOCAL_AVATAR_WORKSPACE_DATABASE_VERSION,
    LOCAL_AVATAR_WORKSPACE_STORE_NAME,
    LOCAL_AVATAR_WORKSPACE_ACTIVE_KEY,
    MAX_LOCAL_AVATAR_GLB_BYTES,
    createDefaultLocalAvatarFraming,
    parseLocalAvatarFraming,
    sanitizeLocalAvatarFileName,
    createLocalAvatarWorkspace,
    parsePersistedLocalAvatarWorkspace,
    cloneLocalAvatarWorkspace,
    openIndexedDBLocalAvatarWorkspaceRecordStore,
    createLocalAvatarWorkspaceStorage,
  } = workspaceModule;

  assertEqual(
    DEFAULT_LOCAL_AVATAR_SCALE,
    1,
    "extracted framing value: default scale",
  );
  assertEqual(
    MIN_LOCAL_AVATAR_SCALE,
    0.25,
    "extracted framing value: min scale",
  );
  assertEqual(MAX_LOCAL_AVATAR_SCALE, 3, "extracted framing value: max scale");
  assertEqual(
    DEFAULT_LOCAL_AVATAR_VERTICAL_OFFSET,
    0,
    "extracted framing value: default vertical offset",
  );
  assertEqual(
    MIN_LOCAL_AVATAR_VERTICAL_OFFSET,
    -2,
    "extracted framing value: min vertical offset",
  );
  assertEqual(
    MAX_LOCAL_AVATAR_VERTICAL_OFFSET,
    2,
    "extracted framing value: max vertical offset",
  );
  assertEqual(
    DEFAULT_LOCAL_AVATAR_YAW_DEGREES,
    0,
    "extracted framing value: default yaw",
  );
  assertEqual(
    MIN_LOCAL_AVATAR_YAW_DEGREES,
    -180,
    "extracted framing value: min yaw",
  );
  assertEqual(
    MAX_LOCAL_AVATAR_YAW_DEGREES,
    180,
    "extracted framing value: max yaw",
  );
  assertEqual(
    LOCAL_AVATAR_WORKSPACE_SCHEMA_VERSION,
    1,
    "workspace schema version",
  );
  assertEqual(
    LOCAL_AVATAR_WORKSPACE_DATABASE_NAME,
    "lvk-web-preview",
    "workspace database name",
  );
  assertEqual(
    LOCAL_AVATAR_WORKSPACE_DATABASE_VERSION,
    1,
    "workspace database version",
  );
  assertEqual(
    LOCAL_AVATAR_WORKSPACE_STORE_NAME,
    "local-avatar-workspace",
    "workspace store name",
  );
  assertEqual(
    LOCAL_AVATAR_WORKSPACE_ACTIVE_KEY,
    "active",
    "workspace active key",
  );
  assertEqual(
    MAX_LOCAL_AVATAR_GLB_BYTES,
    50 * 1024 * 1024,
    "workspace 50 MiB byte limit",
  );

  const defaultFramingA = createDefaultLocalAvatarFraming();
  const defaultFramingB = createDefaultLocalAvatarFraming();
  defaultFramingA.uniformScale = 2;
  assertEqual(
    defaultFramingB.uniformScale,
    1,
    "framing defaults are fresh objects",
  );
  for (const framing of [
    { uniformScale: 1, verticalOffset: 0, yawDegrees: 0 },
    { uniformScale: 0.25, verticalOffset: -2, yawDegrees: -180 },
    { uniformScale: 3, verticalOffset: 2, yawDegrees: 180 },
  ])
    assert(
      parseLocalAvatarFraming(framing) !== null,
      "framing parser accepts valid boundary values",
    );
  for (const framing of [
    { uniformScale: 0.24, verticalOffset: 0, yawDegrees: 0 },
    { uniformScale: 3.01, verticalOffset: 0, yawDegrees: 0 },
    { uniformScale: 1, verticalOffset: -2.01, yawDegrees: 0 },
    { uniformScale: 1, verticalOffset: 2.01, yawDegrees: 0 },
    { uniformScale: 1, verticalOffset: 0, yawDegrees: -181 },
    { uniformScale: 1, verticalOffset: 0, yawDegrees: 181 },
    { uniformScale: Number.NaN, verticalOffset: 0, yawDegrees: 0 },
    {
      uniformScale: Number.POSITIVE_INFINITY,
      verticalOffset: 0,
      yawDegrees: 0,
    },
    {
      uniformScale: Number.NEGATIVE_INFINITY,
      verticalOffset: 0,
      yawDegrees: 0,
    },
    { uniformScale: "1", verticalOffset: 0, yawDegrees: 0 },
    { uniformScale: 1, verticalOffset: 0 },
    [1, 0, 0],
    null,
  ])
    assert(
      parseLocalAvatarFraming(framing) === null,
      "framing parser rejects invalid values",
    );

  for (const [input, expected] of [
    ["avatar.glb", "avatar.glb"],
    ["avatar.GLB", "avatar.GLB"],
    [" C:\\private\\models\\a.glb ", "a.glb"],
    ["/home/user/model.glb", "model.glb"],
    ["  trimmed.glb  ", "trimmed.glb"],
  ])
    assertEqual(
      sanitizeLocalAvatarFileName(input),
      expected,
      `file-name sanitizer ${input}`,
    );
  for (const invalidName of [
    "avatar.vrm",
    ".glb",
    "bad\u0000name.glb",
    `${"a".repeat(256)}.glb`,
    null,
  ])
    assert(
      sanitizeLocalAvatarFileName(invalidName) === null,
      "file-name sanitizer rejects unsafe input",
    );

  const bytes = new ArrayBuffer(4);
  new Uint8Array(bytes).set([1, 2, 3, 4]);
  const validWorkspace = createLocalAvatarWorkspace({
    fileName: "avatar.glb",
    mimeType: "model/gltf-binary",
    glbBytes: bytes,
    framing: { uniformScale: 1, verticalOffset: 0, yawDegrees: 0 },
  });
  assert(
    validWorkspace !== null,
    "workspace parser accepts a valid v1 candidate",
  );
  assert(
    createLocalAvatarWorkspace({
      fileName: "a.glb",
      mimeType: "application/octet-stream",
      glbBytes: bytes,
      framing: validWorkspace.framing,
    }) !== null,
    "workspace parser accepts octet-stream MIME",
  );
  assert(
    createLocalAvatarWorkspace({
      fileName: "a.glb",
      mimeType: null,
      glbBytes: bytes,
      framing: validWorkspace.framing,
    }) !== null,
    "workspace parser accepts null MIME",
  );
  assert(
    createLocalAvatarWorkspace({
      fileName: "a.glb",
      mimeType: "text/plain",
      glbBytes: bytes,
      framing: validWorkspace.framing,
    }) === null,
    "workspace parser rejects unsupported MIME",
  );
  assert(
    parsePersistedLocalAvatarWorkspace({ ...validWorkspace, version: 2 }) ===
      null,
    "workspace parser rejects unknown version",
  );
  assert(
    createLocalAvatarWorkspace({
      fileName: "a.glb",
      mimeType: null,
      framing: validWorkspace.framing,
    }) === null,
    "workspace parser rejects missing bytes",
  );
  assert(
    createLocalAvatarWorkspace({
      fileName: "a.glb",
      mimeType: null,
      glbBytes: [1],
      framing: validWorkspace.framing,
    }) === null,
    "workspace parser rejects wrong byte type",
  );
  assert(
    createLocalAvatarWorkspace({
      fileName: "a.glb",
      mimeType: null,
      glbBytes: new ArrayBuffer(0),
      framing: validWorkspace.framing,
    }) === null,
    "workspace parser rejects zero bytes",
  );
  assert(
    parsePersistedLocalAvatarWorkspace({
      ...validWorkspace,
      byteLength: 99,
    }) === null,
    "workspace parser rejects byte-length mismatch",
  );
  let oversizeBytes = new ArrayBuffer(MAX_LOCAL_AVATAR_GLB_BYTES + 1);
  assert(
    createLocalAvatarWorkspace({
      fileName: "a.glb",
      mimeType: null,
      glbBytes: oversizeBytes,
      framing: validWorkspace.framing,
    }) === null,
    "workspace parser rejects oversized bytes",
  );
  oversizeBytes = null;
  assert(
    createLocalAvatarWorkspace({
      fileName: "a.vrm",
      mimeType: null,
      glbBytes: bytes,
      framing: validWorkspace.framing,
    }) === null,
    "workspace parser rejects unsafe file name",
  );
  assert(
    createLocalAvatarWorkspace({
      fileName: "a.glb",
      mimeType: null,
      glbBytes: bytes,
      framing: { uniformScale: 9, verticalOffset: 0, yawDegrees: 0 },
    }) === null,
    "workspace parser rejects invalid framing",
  );
  new Uint8Array(bytes)[0] = 9;
  assertArrayBufferBytes(
    validWorkspace.glbBytes,
    [1, 2, 3, 4],
    "workspace creation defensively clones input bytes",
  );
  const clonedWorkspace = cloneLocalAvatarWorkspace(validWorkspace);
  new Uint8Array(clonedWorkspace.glbBytes)[1] = 9;
  clonedWorkspace.framing.uniformScale = 3;
  assertArrayBufferBytes(
    validWorkspace.glbBytes,
    [1, 2, 3, 4],
    "workspace clone defensively clones bytes",
  );
  assertEqual(
    validWorkspace.framing.uniformScale,
    1,
    "workspace clone defensively clones framing",
  );

  let opener = createMemoryRecordStoreOpener(undefined);
  assertEqual(
    (await createLocalAvatarWorkspaceStorage(opener).load()).status,
    "empty",
    "storage load empty result",
  );
  assert(
    opener.openedStores[0].closed,
    "storage load closes store on empty result",
  );
  opener = createMemoryRecordStoreOpener(validWorkspace);
  const readyResult = await createLocalAvatarWorkspaceStorage(opener).load();
  assertEqual(readyResult.status, "ready", "storage load ready result");
  new Uint8Array(readyResult.workspace.glbBytes)[0] = 7;
  assertArrayBufferBytes(
    opener.getStoredRecord().glbBytes,
    [1, 2, 3, 4],
    "storage load returns defensive byte clone",
  );
  opener = createMemoryRecordStoreOpener({ version: 1 });
  assertEqual(
    (await createLocalAvatarWorkspaceStorage(opener).load()).status,
    "invalid",
    "storage load invalid result",
  );
  opener = createMemoryRecordStoreOpener(undefined, { openThrows: true });
  assertEqual(
    (await createLocalAvatarWorkspaceStorage(opener).load()).status,
    "unavailable",
    "storage load opener failure result",
  );
  opener = createMemoryRecordStoreOpener(validWorkspace, { readThrows: true });
  assertEqual(
    (await createLocalAvatarWorkspaceStorage(opener).load()).status,
    "failed",
    "storage load read failure result",
  );
  assert(
    opener.openedStores[0].closed,
    "storage load closes store on read failure",
  );

  opener = createMemoryRecordStoreOpener(undefined);
  assertEqual(
    (await createLocalAvatarWorkspaceStorage(opener).save(validWorkspace))
      .status,
    "saved",
    "storage save success result",
  );
  assert(opener.openedStores[0].closed, "storage save closes store on success");
  assertArrayBufferBytes(
    opener.getStoredRecord().glbBytes,
    [1, 2, 3, 4],
    "storage save writes cloned normalized bytes",
  );
  new Uint8Array(validWorkspace.glbBytes)[2] = 8;
  assertArrayBufferBytes(
    opener.getStoredRecord().glbBytes,
    [1, 2, 3, 4],
    "storage save is not mutable through retained workspace bytes",
  );
  opener = createMemoryRecordStoreOpener(undefined);
  assertEqual(
    (await createLocalAvatarWorkspaceStorage(opener).save({ version: 1 }))
      .status,
    "invalid",
    "storage save invalid result",
  );
  assertEqual(
    opener.openedStores.length,
    0,
    "storage save invalid input does not open store",
  );
  opener = createMemoryRecordStoreOpener(undefined, { openThrows: true });
  assertEqual(
    (await createLocalAvatarWorkspaceStorage(opener).save(validWorkspace))
      .status,
    "unavailable",
    "storage save opener failure result",
  );
  opener = createMemoryRecordStoreOpener(validWorkspace, { writeThrows: true });
  assertEqual(
    (await createLocalAvatarWorkspaceStorage(opener).save(validWorkspace))
      .status,
    "failed",
    "storage save write failure result",
  );
  assert(
    opener.getStoredRecord() === validWorkspace,
    "storage failed replacement preserves previous record",
  );
  assert(
    opener.openedStores[0].closed,
    "storage save closes store on write failure",
  );

  opener = createMemoryRecordStoreOpener(validWorkspace);
  assertEqual(
    (await createLocalAvatarWorkspaceStorage(opener).clear()).status,
    "cleared",
    "storage clear success result",
  );
  assertEqual(
    opener.getStoredRecord(),
    undefined,
    "storage clear removes active record",
  );
  assert(
    opener.openedStores[0].closed,
    "storage clear closes store on success",
  );
  opener = createMemoryRecordStoreOpener(validWorkspace, { openThrows: true });
  assertEqual(
    (await createLocalAvatarWorkspaceStorage(opener).clear()).status,
    "unavailable",
    "storage clear opener failure result",
  );
  opener = createMemoryRecordStoreOpener(validWorkspace, {
    deleteThrows: true,
  });
  assertEqual(
    (await createLocalAvatarWorkspaceStorage(opener).clear()).status,
    "failed",
    "storage clear delete failure result",
  );
  assert(
    opener.getStoredRecord() === validWorkspace,
    "storage failed clear preserves previous record",
  );
  assert(
    opener.openedStores[0].closed,
    "storage clear closes store on delete failure",
  );

  await withFakeIndexedDB(createManualIndexedDBOpenFake(), async () => {
    const fakeIndexedDB = globalThis.indexedDB;
    const blockedOpenPromise = openIndexedDBLocalAvatarWorkspaceRecordStore();
    assertEqual(
      fakeIndexedDB.requests.length,
      1,
      "fake IndexedDB blocked lifecycle starts exactly one open request",
    );
    const request = fakeIndexedDB.requests[0];
    request.onblocked();
    const blockedResult = await blockedOpenPromise.then(
      () => "resolved",
      (error) => error?.name,
    );
    assertEqual(
      blockedResult,
      "LocalAvatarWorkspaceIndexedDBUnavailable",
      "fake IndexedDB blocked lifecycle rejects as unavailable",
    );
    const lateDatabase = createFakeOpenDatabase();
    request.result = lateDatabase;
    request.onsuccess();
    assertEqual(
      lateDatabase.closeCalls,
      1,
      "fake IndexedDB blocked lifecycle closes late successful abandoned database",
    );
  });

  await withFakeIndexedDB(createManualIndexedDBOpenFake(), async () => {
    const fakeIndexedDB = globalThis.indexedDB;
    const openPromise = openIndexedDBLocalAvatarWorkspaceRecordStore();
    const request = fakeIndexedDB.requests[0];
    const openedDatabase = createFakeOpenDatabase();
    request.result = openedDatabase;
    request.onsuccess();
    const recordStore = await openPromise;
    assertEqual(
      openedDatabase.closeCalls,
      0,
      "fake IndexedDB normal open keeps database open until record store close",
    );
    recordStore.close();
    assertEqual(
      openedDatabase.closeCalls,
      1,
      "fake IndexedDB normal open closes database through returned store",
    );
  });

  assert(
    Object.getOwnPropertyDescriptor(globalThis, "indexedDB") === undefined,
    "fake IndexedDB open regression restores original global indexedDB",
  );

  assert(
    workspaceSource.includes("globalThis.indexedDB") &&
      workspaceSource.includes("indexedDBFactory.open"),
    "workspace module references built-in IndexedDB",
  );
  assertNotContainsAny(
    workspaceSource,
    [
      "react",
      "@react-three/fiber",
      "three",
      "@lvk/motion-protocol",
      "MotionFrame",
      "localStorage",
      "sessionStorage",
      "fetch(",
      "WebSocket(",
      "BroadcastChannel",
      "FileSystemFileHandle",
      "window.electron",
      "ipcRenderer",
      "http://",
      "https://",
    ],
    "local-only dependency-free workspace boundary",
  );
  assertNotContainsAny(
    JSON.stringify(webPackage.dependencies) +
      JSON.stringify(webPackage.devDependencies),
    ["fake-indexeddb", '"idb"', "dexie"],
    "no storage dependency added",
  );

  console.log(
    `Web Preview local avatar contract check passed.\n  - extracted framing contract remains shared with AvatarPreview and keeps exact v0.11.0 bounds
  - versioned v1 workspace validation, defensive cloning, and the 50 MiB GLB byte limit are covered
  - bounded IndexedDB load/save/clear results are covered with an injected dependency-free record store
  - blocked IndexedDB opens reject once and close delayed successful abandoned database handles
  - local-only and dependency-free storage boundary assertions are present
  - scale, vertical offset, yaw degree controls, and reset framing remain wired to renderer-owned memory-only state\n  - yaw is displayed/stored in degrees and converted to radians exactly once for the loaded-GLB path\n  - static framing remains separated from MotionFrame root/head motion before the parsed GLB primitive\n  - manual ownership is preserved across the root, static framing, head motion, scale, and primitive nodes\n  - local .glb lifecycle preservation remains covered: local-only loading, fallback, replacement retention, stale cleanup, reset invalidation, and unmount disposal\n  - dummy/native source selection remains independent\n  - local avatar controls remain excluded from OBS output while Canvas/AvatarScene remain renderable\n  - OBS alpha canvas, transparent shell/canvas, and full-viewport contracts remain present\n  - checker registration is exact-once through the Web Preview test chain\n  - automated source/unit evidence only\n  NOTE: source/unit checker evidence only; NOT real browser IndexedDB persistence, reload restoration, representative GLB, GPU, OBS application, Electron GUI, Native Core runtime, webcam, or hardware validation.`,
  );
};

runCheck().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
