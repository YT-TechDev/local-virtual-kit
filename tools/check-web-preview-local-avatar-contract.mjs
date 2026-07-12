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
const LOCAL_GLB_CONTROLLER_URL = new URL(
  "../apps/web-preview/src/avatar/localGlbAvatarWorkspaceController.ts",
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

const transpileToEsm = (source, fileName) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName,
  }).outputText;

// Transpile the dependency-free workspace module and the pure lifecycle
// controller into a single temporary directory so both can be executed together
// without React, Three.js, or real browser IndexedDB. The controller imports the
// workspace module by extensionless bundler specifier, so it is rewritten to the
// emitted .mjs sibling for Node ESM resolution.
const loadModules = async () => {
  const workspaceOut = transpileToEsm(
    await readFile(LOCAL_AVATAR_WORKSPACE_URL, "utf8"),
    "localAvatarWorkspace.ts",
  );
  const controllerOut = transpileToEsm(
    await readFile(LOCAL_GLB_CONTROLLER_URL, "utf8"),
    "localGlbAvatarWorkspaceController.ts",
  ).replace(
    /(["'])\.\/localAvatarWorkspace\1/g,
    '"./localAvatarWorkspace.mjs"',
  );
  const tempDir = await mkdtemp(join(tmpdir(), "lvk-local-avatar-workspace-"));
  const workspacePath = join(tempDir, "localAvatarWorkspace.mjs");
  const controllerPath = join(tempDir, "localGlbAvatarWorkspaceController.mjs");
  await writeFile(workspacePath, workspaceOut, "utf8");
  await writeFile(controllerPath, controllerOut, "utf8");
  try {
    const workspaceModule = await import(pathToFileURL(workspacePath).href);
    const controllerModule = await import(pathToFileURL(controllerPath).href);
    return { workspaceModule, controllerModule };
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
    controllerSource,
  ] = await Promise.all([
    readFile(ROOT_PACKAGE_URL, "utf8"),
    readFile(WEB_PACKAGE_URL, "utf8"),
    readFile(LOCAL_AVATAR_URL, "utf8"),
    readFile(LOADED_GLB_URL, "utf8"),
    readFile(AVATAR_PREVIEW_URL, "utf8"),
    readFile(APP_CSS_URL, "utf8"),
    readFile(LOCAL_AVATAR_WORKSPACE_URL, "utf8"),
    readFile(LOCAL_GLB_CONTROLLER_URL, "utf8"),
  ]);
  const { workspaceModule, controllerModule } = await loadModules();
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
      "const localAvatarScale = localGlbAvatar.framing.uniformScale;",
    ),
    "local avatar scale control: scale must be read from the workspace controller framing",
  );
  assert(
    previewSource.includes(
      "const localAvatarScaleValueText = `${localAvatarScale.toFixed(2)}×`;",
    ),
    "local avatar scale control: current value text must format scale as multiplier",
  );
  for (const stateNeedle of [
    "const localAvatarVerticalOffset = localGlbAvatar.framing.verticalOffset;",
    "const localAvatarYawDegrees = localGlbAvatar.framing.yawDegrees;",
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
    scaleHandler.includes("localGlbAvatar.setFraming({") &&
      scaleHandler.includes("uniformScale: event.target.valueAsNumber,"),
    "local avatar scale control: range handler must update framing scale through the controller",
  );
  const verticalOffsetHandler = sliceBetween(
    previewSource,
    "const handleLocalAvatarVerticalOffsetChange",
    "const handleLocalAvatarYawChange",
    "local avatar vertical offset control",
  ).slice;
  assert(
    verticalOffsetHandler.includes("localGlbAvatar.setFraming({") &&
      verticalOffsetHandler.includes(
        "verticalOffset: event.target.valueAsNumber,",
      ),
    "local avatar vertical offset control: range handler must update framing vertical offset through the controller",
  );
  const yawHandler = sliceBetween(
    previewSource,
    "const handleLocalAvatarYawChange",
    "const handleResetLocalAvatarFraming",
    "local avatar yaw control",
  ).slice;
  assert(
    yawHandler.includes("localGlbAvatar.setFraming({") &&
      yawHandler.includes("yawDegrees: event.target.valueAsNumber,"),
    "local avatar yaw control: range handler must update framing yaw through the controller",
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
    "const handleClearLocalAvatar",
    "local avatar scale control",
  ).slice;
  assert(
    resetFramingHandler.includes("localGlbAvatar.resetFraming()"),
    "local avatar framing controls: reset framing must restore defaults through the controller reset action",
  );
  assert(
    panel.includes("disabled={resetLocalAvatarFramingDisabled}"),
    "local avatar framing controls: reset button must use the resetLocalAvatarFramingDisabled expression",
  );
  assert(
    resetFramingHandler.includes("localGlbAvatar.resetFraming()") &&
      !resetFramingHandler.includes("clearAvatar"),
    "local avatar framing controls: reset framing must stay separate from the durable clear action",
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
    previewSource.includes(
      'accessMode: isObsMode ? "restore-only" : "interactive"',
    ),
    "standard/OBS scope: standard Preview uses interactive access and OBS uses restore-only access",
  );
  const guidance = sliceBetween(
    panel,
    "preview-local-avatar-panel__guidance",
    "</p>",
    "browser-local storage guidance",
  ).slice;
  assert(
    !guidance.includes("memory only") && !guidance.includes("in memory"),
    "browser-local storage guidance: memory-only wording must be removed",
  );
  assert(
    guidance.includes("browser-local storage") &&
      guidance.includes("external resources are blocked") &&
      guidance.includes("nothing is uploaded"),
    "browser-local storage guidance: must explain local persistence while keeping local-only and external-resource-blocking reassurance",
  );
  const localAvatarCopy = sliceBetween(
    previewSource,
    "const localAvatarStatusText = (() => {",
    "const showCalibrationFeedback =",
    "local avatar privacy-safe status copy",
  ).slice;
  for (const expectedCopyMarker of [
    "Checking browser-local storage",
    "Restoring",
    "Saved avatar data was invalid",
    "Ready ·",
    "Loaded locally · not saved",
    "Browser-local storage save failed",
    "Framing kept locally · save failed",
    "Framing kept in memory",
  ]) {
    assert(
      localAvatarCopy.includes(expectedCopyMarker),
      `local avatar privacy-safe status copy: missing bounded marker ${expectedCopyMarker}`,
    );
  }
  assertNotContainsAny(
    localAvatarCopy,
    [
      "error.stack",
      "error.message",
      "String(error",
      "LOCAL_AVATAR_WORKSPACE_DATABASE_NAME",
      "LOCAL_AVATAR_WORKSPACE_STORE_NAME",
      "LOCAL_AVATAR_WORKSPACE_ACTIVE_KEY",
      "glbBytes",
      "ArrayBuffer",
      "byteLength",
      "generation",
      "revision",
      "indexedDB",
      "C:\\",
      "/home/",
    ],
    "local avatar privacy-safe status copy must not expose raw exceptions, IndexedDB identifiers, binary details, internal revisions, or absolute path examples",
  );

  // ---- Local-only GLB byte parser (useLocalGlbAvatar.ts) ----
  assert(
    loaderSource.includes('from "three/examples/jsm/loaders/GLTFLoader.js"'),
    "existing GLTFLoader path: must import Three.js GLTFLoader directly",
  );
  assert(
    loaderSource.includes("export async function parseLocalGlbAvatarBytes("),
    "reusable byte parser: must expose parseLocalGlbAvatarBytes for selected and restored bytes",
  );
  const parseFn = sliceBetween(
    loaderSource,
    "export async function parseLocalGlbAvatarBytes(",
    "const createInitialControllerState",
    "reusable byte parser",
  ).slice;
  assert(
    parseFn.includes("fileName: string") &&
      parseFn.includes("glbBytes: ArrayBuffer"),
    "reusable byte parser: must accept a file name and already-read ArrayBuffer bytes",
  );
  assert(
    parseFn.includes('loader.parseAsync(glbBytes, "")'),
    "existing GLTFLoader path: parser must parse ArrayBuffer bytes with parseAsync",
  );
  assert(
    parseFn.includes("new GLTFLoader(createLocalOnlyLoadingManager())"),
    "remote/external resource blocking: parser must use the local-only LoadingManager",
  );
  assert(
    parseFn.includes("error.message === LOCAL_ONLY_RESOURCE_ERROR") &&
      parseFn.includes("PARSE_ERROR"),
    "reusable byte parser: parse failures must map to user-safe messages only",
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
  assertNotContainsAny(
    loaderSource,
    ["loader.load(", "loader.loadAsync(", "fetch("],
    "remote/external resource blocking",
  );
  assert(
    !/https?:\/\//.test(loaderSource),
    "remote/external resource blocking: parser must not introduce http(s) avatar-loading literals",
  );

  // ---- Disposal helpers preserved ----
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

  // ---- Strict Mode-safe workspace hook wiring ----
  assert(
    loaderSource.includes("accessMode") &&
      loaderSource.includes("UseLocalGlbAvatarOptions"),
    "standard/OBS scope: hook must accept an accessMode option",
  );
  const hookEffect = sliceBetween(
    loaderSource,
    "useEffect(() => {",
    "const loadFile = useCallback",
    "Strict Mode-safe controller lifecycle",
  ).slice;
  assert(
    hookEffect.includes("accessMode,") &&
      hookEffect.includes("scheduleTimeout:") &&
      hookEffect.includes("cancelTimeout:"),
    "standard/OBS scope: controller must receive the access mode and an injected debounce scheduler",
  );
  assert(
    !loaderSource.includes("DISABLED_CONTROLLER_STATE"),
    "standard/OBS scope: OBS now restores through the controller, so no disabled-state shortcut remains",
  );
  assert(
    /\[accessMode\]\)/.test(hookEffect) ||
      loaderSource.includes("}, [accessMode]);"),
    "standard/OBS scope: controller lifecycle effect must depend on accessMode",
  );
  assert(
    hookEffect.includes(
      "createLocalGlbAvatarWorkspaceController<LocalGlbAvatarAsset>",
    ),
    "Strict Mode-safe controller lifecycle: effect setup must create a fresh controller",
  );
  assert(
    hookEffect.includes("storage: createLocalAvatarWorkspaceStorage()") &&
      hookEffect.includes("parseBytes: parseLocalGlbAvatarBytes") &&
      hookEffect.includes("disposeAsset: disposeLocalGlbAvatarAsset") &&
      hookEffect.includes("onStateChange: setState"),
    "Strict Mode-safe controller lifecycle: controller must be dependency-injected with storage, parser, disposer, and state sink",
  );
  assert(
    hookEffect.includes("controller.start()"),
    "restore lifecycle: hook effect must start restoration",
  );
  assert(
    hookEffect.includes("return () => {") &&
      hookEffect.includes("controller.dispose()") &&
      hookEffect.indexOf("controller.start()") <
        hookEffect.indexOf("controller.dispose()"),
    "Strict Mode-safe controller lifecycle: cleanup must dispose the controller created during setup",
  );
  assert(
    loaderSource.includes("clearAvatar") && !loaderSource.includes("reset:"),
    "clear behavior: hook must expose an explicit clearAvatar action rather than a memory-only reset",
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
    "renderer parser/hook must not embed storage adapters directly",
  );

  const controllerSurface = sliceBetween(
    loaderSource,
    "export type LocalGlbAvatarController",
    "};",
    "renderer-owned controller surface",
  ).slice;
  for (const member of [
    "asset",
    "errorMessage",
    "pendingFileName",
    "lifecycleStatus",
    "persistenceStatus",
    "framing",
    "framingStatus",
    "loadFile",
    "setFraming",
    "resetFraming",
    "clearAvatar",
  ])
    assert(
      controllerSurface.includes(member),
      `renderer-owned controller surface: controller missing ${member}`,
    );

  // ---- Pure lifecycle controller source boundary ----
  assert(
    controllerSource.includes('from "./localAvatarWorkspace"'),
    "controller boundary: controller must reuse the versioned workspace module",
  );
  assert(
    controllerSource.includes("createDefaultLocalAvatarFraming") &&
      controllerSource.includes("createLocalAvatarWorkspace") &&
      controllerSource.includes("MAX_LOCAL_AVATAR_GLB_BYTES"),
    "controller boundary: controller must reuse workspace framing, normalization, and byte-limit helpers",
  );
  assert(
    controllerSource.includes('fileName.toLowerCase().endsWith(".glb")'),
    "file selection validation: controller must require a case-insensitive .glb suffix",
  );
  assert(
    controllerSource.includes("file.size <= 0"),
    "file selection validation: controller must reject zero-byte files",
  );
  assert(
    controllerSource.includes("file.size > MAX_LOCAL_AVATAR_GLB_BYTES"),
    "file selection validation: controller must reject oversized files before reading bytes",
  );
  const sizeGuardIndex = controllerSource.indexOf(
    "file.size > MAX_LOCAL_AVATAR_GLB_BYTES",
  );
  const bytesReadIndex = controllerSource.indexOf("file.arrayBuffer()");
  assert(
    sizeGuardIndex !== -1 &&
      bytesReadIndex !== -1 &&
      sizeGuardIndex < bytesReadIndex,
    "file selection validation: size guard must run before reading bytes",
  );
  assert(
    controllerSource.includes('"model/gltf-binary"') &&
      controllerSource.includes('"application/octet-stream"'),
    "file selection validation: controller must preserve supported MIME metadata",
  );
  assert(
    controllerSource.includes("createDefaultLocalAvatarFraming()"),
    "framing ownership: controller must build default framing through the shared workspace helper",
  );
  assert(
    controllerSource.includes("parseLocalAvatarFraming") &&
      controllerSource.includes("setFraming") &&
      controllerSource.includes("resetFraming") &&
      controllerSource.includes("framingStatus"),
    "framing ownership: controller must own validated framing state with set and reset actions",
  );
  assert(
    controllerSource.includes("LOCAL_AVATAR_FRAMING_SAVE_DEBOUNCE_MS = 200"),
    "framing debounce: controller must define the ~200 ms trailing debounce constant",
  );
  assert(
    controllerSource.includes("scheduleTimeout") &&
      controllerSource.includes("cancelTimeout") &&
      !controllerSource.includes("setTimeout(") &&
      !controllerSource.includes("setInterval(") &&
      !controllerSource.includes("clearTimeout("),
    "framing debounce: controller must use injected scheduler functions rather than real timers",
  );
  assert(
    controllerSource.includes("framingSaveRevision"),
    "framing debounce: controller must track a framing save revision to invalidate stale writes",
  );
  assert(
    controllerSource.includes("persistedWorkspaceRef") &&
      controllerSource.includes("mutationQueue") &&
      controllerSource.includes("const reconcile ="),
    "durable mutation ordering: controller must serialize mutations and track the durable workspace for reconciliation",
  );
  assert(
    controllerSource.includes("disposedAssets"),
    "resource ownership: controller must guard against repeated disposal",
  );
  assert(
    controllerSource.includes("const disposedAssets = new WeakSet<Asset>()"),
    "resource ownership: disposed registry must be a non-owning WeakSet so retired assets are not strongly retained",
  );
  assert(
    !controllerSource.includes("const disposedAssets = new Set<Asset>()") &&
      !controllerSource.includes("const disposedAssets = new Set("),
    "resource ownership: disposed registry must not be a strong Set that retains retired assets",
  );
  assert(
    controllerSource.includes("const pendingCandidates = new Set<Asset>()"),
    "resource ownership: pending candidates remain a strong Set of actively owned assets",
  );
  assert(
    controllerSource.includes("<Asset extends object>"),
    "resource ownership: controller must constrain Asset to object so the WeakSet disposal guard is valid",
  );
  const actualByteGuardIndex = controllerSource.indexOf(
    "glbBytes.byteLength > MAX_LOCAL_AVATAR_GLB_BYTES",
  );
  const emptyBufferGuardIndex = controllerSource.indexOf(
    "glbBytes.byteLength === 0",
  );
  const parseBytesIndex = controllerSource.lastIndexOf("await parseBytes(");
  assert(
    emptyBufferGuardIndex !== -1 &&
      actualByteGuardIndex !== -1 &&
      parseBytesIndex !== -1 &&
      emptyBufferGuardIndex < parseBytesIndex &&
      actualByteGuardIndex < parseBytesIndex,
    "file selection validation: the actual returned buffer length must be validated before parsing",
  );
  assertNotContainsAny(
    controllerSource,
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
      "postMessage",
      "FileSystemFileHandle",
      "window.electron",
      "ipcRenderer",
      "http://",
      "https://",
    ],
    "controller boundary: pure controller must stay framework- and network-free",
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
    'case "checking"',
    'case "restoring"',
    'case "empty"',
    'case "loading"',
    'case "ready"',
    'case "clearing"',
    'case "error"',
  ])
    assert(
      statusLogic.includes(caseNeedle),
      `lifecycle status copy: missing ${caseNeedle}`,
    );
  for (const marker of [
    "built-in primitive avatar",
    "built-in primitive remains rendered",
    "Error · built-in primitive is rendered",
    "keeping",
    "replacement GLB",
    "Checking browser-local storage",
    "Restoring",
    "saved in browser-local storage",
    "could not save it",
    "Clearing the saved avatar",
  ])
    assert(
      statusLogic.includes(marker),
      `lifecycle status copy: status copy missing semantic marker ${marker}`,
    );
  assert(
    panel.includes("onClick={handleClearLocalAvatar}") &&
      panel.includes("Clear local avatar"),
    "clear behavior: panel must expose an explicit Clear local avatar action",
  );
  assert(
    !panel.includes("onClick={localGlbAvatar.reset}") &&
      !panel.includes("Reset local avatar"),
    "clear behavior: the memory-only Reset local avatar action must be replaced by the durable clear action",
  );
  const clearHandler = sliceBetween(
    previewSource,
    "const handleClearLocalAvatar",
    "const handleLocalAvatarFileChange",
    "clear behavior",
  ).slice;
  assert(
    clearHandler.includes("localGlbAvatar.clearAvatar()") &&
      !clearHandler.includes("setLocalAvatarScale") &&
      !clearHandler.includes("setLocalAvatarVerticalOffset") &&
      !clearHandler.includes("setLocalAvatarYawDegrees"),
    "clear behavior: clear must run the durable clear and stay separate from framing reset",
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
      controls.slice.includes("onClick={handleClearLocalAvatar}"),
    "local controls inside !isObsMode: file input, exactly three framing ranges, reset framing, and clear local avatar must remain inside OBS exclusion gate",
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
  assert(
    JSON.stringify(Object.keys(validWorkspace).sort()) ===
      JSON.stringify(
        [
          "byteLength",
          "fileName",
          "framing",
          "glbBytes",
          "mimeType",
          "version",
        ].sort(),
      ),
    "workspace durable record contains only schema, metadata, bytes, and framing fields",
  );
  assertNotContainsAny(
    Object.keys(validWorkspace).join("\n"),
    ["scene", "object", "three", "gltf", "parser", "runtime"],
    "workspace durable record must not persist parsed Three.js/runtime object fields",
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

  // ---- Issue #524 scope boundary ----
  assert(
    workspaceSource.includes("LOCAL_AVATAR_WORKSPACE_SCHEMA_VERSION = 1"),
    "Issue #524 scope: workspace schema version must remain 1 (no schema change)",
  );
  assertNotContainsAny(
    previewSource,
    ["BroadcastChannel", 'addEventListener("storage"'],
    "Issue #524 scope: no live cross-window synchronization",
  );

  // ---- Pure lifecycle controller behavioral tests ----
  // Fakes, counted disposal, and deferred Promises exercise lifecycle ordering
  // without React or real browser IndexedDB.
  const {
    createLocalGlbAvatarWorkspaceController,
    LOCAL_AVATAR_FRAMING_SAVE_DEBOUNCE_MS,
  } = controllerModule;

  assertEqual(
    LOCAL_AVATAR_FRAMING_SAVE_DEBOUNCE_MS,
    200,
    "framing debounce: exported trailing debounce constant is 200 ms",
  );

  // Manual, dependency-free scheduler standing in for window.setTimeout /
  // clearTimeout so the trailing framing debounce is deterministic. No fake
  // timers, jsdom, or test dependency is introduced.
  const createManualScheduler = () => {
    let nextId = 1;
    let lastDelay = null;
    const timers = new Map();
    return {
      schedule: (callback, delayMs) => {
        const id = nextId;
        nextId += 1;
        lastDelay = delayMs;
        timers.set(id, callback);
        return id;
      },
      cancel: (handle) => {
        timers.delete(handle);
      },
      pending: () => timers.size,
      lastDelay: () => lastDelay,
      flush: () => {
        const callbacks = [...timers.values()];
        timers.clear();
        for (const callback of callbacks) callback();
      },
    };
  };

  const createDeferred = () => {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const settle = async (rounds = 8) => {
    for (let i = 0; i < rounds; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  const buildBytes = (seed) => {
    const bytes = new ArrayBuffer(8);
    new Uint8Array(bytes).set([seed, 2, 3, 4, 5, 6, 7, 8]);
    return bytes;
  };
  const buildWorkspace = (fileName, seed = 1) =>
    createLocalAvatarWorkspace({
      fileName,
      mimeType: "model/gltf-binary",
      glbBytes: buildBytes(seed),
      framing: createDefaultLocalAvatarFraming(),
    });
  const makeFile = (name, opts = {}) => {
    const bytes = opts.bytes ?? buildBytes(opts.seed ?? 1);
    return {
      name,
      size: opts.size ?? bytes.byteLength,
      type: opts.type ?? "",
      arrayBuffer: async () => bytes,
    };
  };
  const createDisposer = () => {
    const counts = new Map();
    return {
      dispose: (asset) => counts.set(asset, (counts.get(asset) ?? 0) + 1),
      countFor: (asset) => counts.get(asset) ?? 0,
    };
  };
  const createParser = () => {
    const calls = [];
    const responders = [];
    return {
      calls,
      program: (fn) => responders.push(fn),
      parse: async (fileName, glbBytes) => {
        calls.push({ fileName, glbBytes });
        if (responders.length) return responders.shift()(fileName, glbBytes);
        return { fileName };
      },
    };
  };
  const createStorage = (initialDurable) => {
    let durable = initialDurable;
    const calls = { load: 0, save: [], clear: 0 };
    const loadResponders = [];
    const saveResponders = [];
    const clearResponders = [];
    return {
      calls,
      getDurable: () => durable,
      programLoad: (fn) => loadResponders.push(fn),
      programSave: (fn) => saveResponders.push(fn),
      programClear: (fn) => clearResponders.push(fn),
      async load() {
        calls.load += 1;
        if (loadResponders.length) return loadResponders.shift()(durable);
        return durable === undefined
          ? { status: "empty" }
          : { status: "ready", workspace: durable };
      },
      async save(workspace) {
        calls.save.push(workspace);
        if (saveResponders.length) {
          const result = await saveResponders.shift()(workspace);
          if (result.status === "saved") durable = workspace;
          return result;
        }
        durable = workspace;
        return { status: "saved" };
      },
      async clear() {
        calls.clear += 1;
        if (clearResponders.length) {
          const result = await clearResponders.shift()(durable);
          if (result.status === "cleared") durable = undefined;
          return result;
        }
        durable = undefined;
        return { status: "cleared" };
      },
    };
  };
  const createHarness = (options = {}) => {
    const storage = options.storage ?? createStorage(options.durable);
    const parser = options.parser ?? createParser();
    const disposer = options.disposer ?? createDisposer();
    const scheduler = options.scheduler ?? createManualScheduler();
    const states = [];
    const controller = createLocalGlbAvatarWorkspaceController({
      storage,
      parseBytes: parser.parse,
      disposeAsset: disposer.dispose,
      onStateChange: (state) => states.push(state),
      accessMode: options.accessMode ?? "interactive",
      scheduleTimeout: scheduler.schedule,
      cancelTimeout: scheduler.cancel,
    });
    return { controller, storage, parser, disposer, states, scheduler };
  };
  const isDefaultFraming = (framing) =>
    framing.uniformScale === 1 &&
    framing.verticalOffset === 0 &&
    framing.yawDegrees === 0;
  const framingsEqual = (a, b) =>
    a.uniformScale === b.uniformScale &&
    a.verticalOffset === b.verticalOffset &&
    a.yawDegrees === b.yawDegrees;
  const buildWorkspaceWithFraming = (fileName, framing, seed = 1) =>
    createLocalAvatarWorkspace({
      fileName,
      mimeType: "model/gltf-binary",
      glbBytes: buildBytes(seed),
      framing,
    });
  const framingA = { uniformScale: 2, verticalOffset: 1, yawDegrees: 45 };
  const framingB = { uniformScale: 0.5, verticalOffset: -1, yawDegrees: -90 };

  // Restoration --------------------------------------------------------------
  {
    const h = createHarness();
    const loadDeferred = createDeferred();
    h.storage.programLoad(() => loadDeferred.promise);
    h.controller.start();
    await settle();
    assertEqual(
      h.controller.getState().lifecycleStatus,
      "checking",
      "restore: checking while storage load pending",
    );
    assertEqual(
      h.controller.getState().asset,
      null,
      "restore: primitive rendered while storage load pending",
    );
    loadDeferred.resolve({ status: "empty" });
    await settle();
    assertEqual(
      h.controller.getState().lifecycleStatus,
      "empty",
      "restore: empty storage resolves to empty",
    );
  }
  {
    const workspaceP = buildWorkspace("avatar.glb", 11);
    const h = createHarness({ durable: workspaceP });
    const assetP = { tag: "P" };
    h.parser.program(() => assetP);
    h.controller.start();
    await settle();
    const s = h.controller.getState();
    assertEqual(
      s.lifecycleStatus,
      "ready",
      "restore: valid record restores to ready",
    );
    assertEqual(
      s.persistenceStatus,
      "persisted",
      "restore: restored asset marked persisted",
    );
    assertEqual(s.asset, assetP, "restore: restored asset committed");
    assertEqual(s.pendingFileName, null, "restore: pending file name cleared");
    assertEqual(h.parser.calls.length, 1, "restore: stored bytes parsed once");
    assertEqual(
      h.parser.calls[0].fileName,
      "avatar.glb",
      "restore: parser receives sanitized stored file name",
    );
    assertArrayBufferBytes(
      h.parser.calls[0].glbBytes,
      [11, 2, 3, 4, 5, 6, 7, 8],
      "restore: parser receives stored bytes",
    );
  }
  for (const [status, persistence] of [
    ["unavailable", "unavailable"],
    ["failed", "read_failed"],
  ]) {
    const h = createHarness();
    h.storage.programLoad(() => ({ status }));
    h.controller.start();
    await settle();
    const s = h.controller.getState();
    assertEqual(
      s.lifecycleStatus,
      "empty",
      `restore: ${status} keeps primitive`,
    );
    assertEqual(
      s.persistenceStatus,
      persistence,
      `restore: ${status} surfaced`,
    );
    assertEqual(s.asset, null, `restore: ${status} renders primitive`);
  }
  {
    const h = createHarness({ durable: buildWorkspace("x.glb") });
    h.storage.programLoad(() => ({ status: "invalid" }));
    h.controller.start();
    await settle();
    const s = h.controller.getState();
    assertEqual(
      s.lifecycleStatus,
      "empty",
      "restore: invalid falls back to primitive",
    );
    assertEqual(
      s.persistenceStatus,
      "invalid",
      "restore: invalid record cleared",
    );
    assertEqual(
      h.storage.getDurable(),
      undefined,
      "restore: invalid record durably cleared",
    );
    assert(
      h.storage.calls.clear >= 1,
      "restore: invalid record triggers best-effort clear",
    );
  }
  for (const message of [
    "bad glb",
    "This GLB references external resources, which are blocked in local-only preview.",
  ]) {
    const h = createHarness({ durable: buildWorkspace("bad.glb", 5) });
    h.parser.program(() => {
      throw new Error(message);
    });
    h.controller.start();
    await settle();
    const s = h.controller.getState();
    assertEqual(
      s.lifecycleStatus,
      "empty",
      "restore: unparseable persisted bytes fall back to primitive",
    );
    assertEqual(
      s.persistenceStatus,
      "invalid",
      "restore: unparseable persisted bytes cleared",
    );
    assertEqual(
      h.storage.getDurable(),
      undefined,
      "restore: unparseable persisted record durably cleared",
    );
  }
  {
    const h = createHarness({ durable: buildWorkspace("x.glb") });
    h.storage.programLoad(() => ({ status: "invalid" }));
    h.storage.programClear(() => ({ status: "failed" }));
    h.controller.start();
    await settle();
    const s = h.controller.getState();
    assertEqual(
      s.persistenceStatus,
      "clear_failed",
      "restore: invalid-record clear failure distinguished from success",
    );
    assertEqual(
      s.asset,
      null,
      "restore: invalid-record clear failure still renders primitive",
    );
  }
  {
    const h = createHarness({ durable: buildWorkspace("p.glb", 7) });
    const restoreDeferred = createDeferred();
    const assetP = { tag: "P" };
    const assetB = { tag: "B" };
    h.parser.program(() => restoreDeferred.promise.then(() => assetP));
    h.parser.program(() => assetB);
    h.controller.start();
    await settle();
    assertEqual(
      h.controller.getState().lifecycleStatus,
      "restoring",
      "restore: restoring while stored bytes parse",
    );
    await h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    restoreDeferred.resolve();
    await settle();
    assertEqual(
      h.controller.getState().asset,
      assetB,
      "restore: user selection supersedes an in-flight restore",
    );
    assertEqual(
      h.disposer.countFor(assetP),
      1,
      "restore: stale restore candidate disposed",
    );
  }

  // Selection ----------------------------------------------------------------
  {
    const h = createHarness();
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("model.txt"));
    const s = h.controller.getState();
    assertEqual(s.lifecycleStatus, "error", "selection: non-GLB rejected");
    assertEqual(s.asset, null, "selection: non-GLB keeps primitive");
    assertEqual(
      h.parser.calls.length,
      0,
      "selection: non-GLB rejected before parsing",
    );
    assertEqual(
      h.storage.calls.save.length,
      0,
      "selection: non-GLB rejected before saving",
    );
  }
  {
    const h = createHarness();
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("empty.glb", { size: 0 }));
    assertEqual(
      h.parser.calls.length,
      0,
      "selection: zero-byte rejected before parsing",
    );
    assertEqual(
      h.controller.getState().lifecycleStatus,
      "error",
      "selection: zero-byte rejected",
    );
  }
  {
    const h = createHarness();
    h.controller.start();
    await settle();
    await h.controller.loadFile(
      makeFile("big.glb", { size: MAX_LOCAL_AVATAR_GLB_BYTES + 1 }),
    );
    assertEqual(
      h.parser.calls.length,
      0,
      "selection: oversized rejected before reading bytes",
    );
    assertEqual(
      h.storage.calls.save.length,
      0,
      "selection: oversized rejected before saving",
    );
  }
  // The returned ArrayBuffer length is validated even when file.size looks OK.
  {
    const h = createHarness();
    const assetPrior = { tag: "prior" };
    h.parser.program(() => assetPrior);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("prior.glb"));
    const durablePrior = h.storage.getDurable();
    const parseCallsBefore = h.parser.calls.length;
    const saveCallsBefore = h.storage.calls.save.length;
    await h.controller.loadFile({
      name: "empty-buffer.glb",
      size: 8,
      type: "",
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    assertEqual(
      h.parser.calls.length,
      parseCallsBefore,
      "selection: empty returned buffer is not parsed",
    );
    assertEqual(
      h.storage.calls.save.length,
      saveCallsBefore,
      "selection: empty returned buffer is not saved",
    );
    assertEqual(
      h.controller.getState().asset,
      assetPrior,
      "selection: empty returned buffer preserves the active avatar",
    );
    assert(
      h.storage.getDurable() === durablePrior,
      "selection: empty returned buffer preserves the durable record",
    );
    assertEqual(
      h.controller.getState().lifecycleStatus,
      "error",
      "selection: empty returned buffer surfaces a validation error",
    );
    assertEqual(
      h.disposer.countFor(assetPrior),
      0,
      "selection: empty returned buffer disposes nothing",
    );
  }
  {
    const h = createHarness();
    const assetPrior = { tag: "prior" };
    h.parser.program(() => assetPrior);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("prior.glb"));
    const durablePrior = h.storage.getDurable();
    const parseCallsBefore = h.parser.calls.length;
    const saveCallsBefore = h.storage.calls.save.length;
    // A single oversize allocation is sufficient to exercise the guard.
    const oversizeBuffer = new ArrayBuffer(MAX_LOCAL_AVATAR_GLB_BYTES + 1);
    await h.controller.loadFile({
      name: "oversize-buffer.glb",
      size: 8,
      type: "",
      arrayBuffer: async () => oversizeBuffer,
    });
    assertEqual(
      h.parser.calls.length,
      parseCallsBefore,
      "selection: oversize returned buffer is not parsed",
    );
    assertEqual(
      h.storage.calls.save.length,
      saveCallsBefore,
      "selection: oversize returned buffer is not saved",
    );
    assertEqual(
      h.controller.getState().asset,
      assetPrior,
      "selection: oversize returned buffer preserves the active avatar",
    );
    assert(
      h.storage.getDurable() === durablePrior,
      "selection: oversize returned buffer preserves the durable record",
    );
    assertEqual(
      h.disposer.countFor(assetPrior),
      0,
      "selection: oversize returned buffer disposes nothing",
    );
  }
  // Exact-once disposal across two lifecycle end paths for the same asset.
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    await h.controller.clearAvatar();
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "resource ownership: cleared asset disposed exactly once",
    );
    h.controller.dispose();
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "resource ownership: an asset retired by clear is not disposed again on unmount",
    );
  }
  for (const [type, expected] of [
    ["model/gltf-binary", "model/gltf-binary"],
    ["application/octet-stream", "application/octet-stream"],
    ["text/plain", null],
    ["", null],
  ]) {
    const h = createHarness();
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb", { type }));
    assertEqual(
      h.controller.getState().persistenceStatus,
      "persisted",
      `selection: MIME ${type || "empty"} still persists a valid .glb`,
    );
    assertEqual(
      h.storage.getDurable().mimeType,
      expected,
      `selection: MIME ${type || "empty"} normalized to ${expected}`,
    );
  }
  {
    const sourceBytes = buildBytes(3);
    const h = createHarness();
    h.controller.start();
    await settle();
    await h.controller.loadFile({
      name: "a.glb",
      size: 8,
      type: "",
      arrayBuffer: async () => sourceBytes,
    });
    new Uint8Array(sourceBytes)[0] = 99;
    assertArrayBufferBytes(
      h.storage.getDurable().glbBytes,
      [3, 2, 3, 4, 5, 6, 7, 8],
      "selection: saved bytes are a private copy",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    const saveDeferred = createDeferred();
    h.storage.programSave(() => saveDeferred.promise);
    h.controller.start();
    await settle();
    const pending = h.controller.loadFile(makeFile("a.glb"));
    await settle();
    assertEqual(
      h.controller.getState().lifecycleStatus,
      "loading",
      "selection: loading while save pending",
    );
    assert(
      h.controller.getState().asset !== assetA,
      "selection: candidate not committed before save resolves",
    );
    saveDeferred.resolve({ status: "saved" });
    await pending;
    const s = h.controller.getState();
    assertEqual(
      s.asset,
      assetA,
      "selection: candidate committed after save succeeds",
    );
    assertEqual(
      s.persistenceStatus,
      "persisted",
      "selection: committed candidate persisted",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    const assetB = { tag: "B" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    assertEqual(
      h.controller.getState().asset,
      assetA,
      "selection: first selection committed",
    );
    h.parser.program(() => assetB);
    const saveDeferred = createDeferred();
    h.storage.programSave(() => saveDeferred.promise);
    const pending = h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    await settle();
    assertEqual(
      h.controller.getState().asset,
      assetA,
      "selection: current asset preserved while replacement save pending",
    );
    assertEqual(
      h.controller.getState().lifecycleStatus,
      "loading",
      "selection: replacement shows loading while pending",
    );
    saveDeferred.resolve({ status: "saved" });
    await pending;
    assertEqual(
      h.controller.getState().asset,
      assetB,
      "selection: replacement committed after save",
    );
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "selection: replaced asset disposed after successful replacement",
    );
  }
  for (const status of ["unavailable", "failed"]) {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.storage.programSave(() => ({ status }));
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    const s = h.controller.getState();
    assertEqual(
      s.lifecycleStatus,
      "ready",
      `selection: first save ${status} still renders the avatar`,
    );
    assertEqual(
      s.persistenceStatus,
      "unsaved",
      `selection: first save ${status} yields explicit unsaved state`,
    );
    assertEqual(
      s.asset,
      assetA,
      `selection: first save ${status} keeps the parsed asset`,
    );
    assertEqual(
      h.storage.getDurable(),
      undefined,
      `selection: first save ${status} creates no durable record`,
    );
    assertEqual(
      h.disposer.countFor(assetA),
      0,
      `selection: first save ${status} does not dispose the unsaved asset`,
    );
  }
  for (const [status, persistence] of [
    ["failed", "write_failed"],
    ["unavailable", "unavailable"],
  ]) {
    const h = createHarness();
    const assetA = { tag: "A" };
    const assetB = { tag: "B" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    const durableA = h.storage.getDurable();
    h.parser.program(() => assetB);
    h.storage.programSave(() => ({ status }));
    await h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    const s = h.controller.getState();
    assertEqual(
      s.asset,
      assetA,
      `selection: replacement ${status} preserves the active avatar`,
    );
    assertEqual(
      s.persistenceStatus,
      persistence,
      `selection: replacement ${status} surfaced`,
    );
    assertEqual(
      h.disposer.countFor(assetB),
      1,
      "selection: failed replacement candidate disposed",
    );
    assertEqual(
      h.disposer.countFor(assetA),
      0,
      "selection: preserved active avatar not disposed",
    );
    assert(
      h.storage.getDurable() === durableA,
      `selection: replacement ${status} preserves the durable record`,
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    const assetB = { tag: "B" };
    const parseDeferred = createDeferred();
    h.parser.program(() => parseDeferred.promise.then(() => assetA));
    h.parser.program(() => assetB);
    h.controller.start();
    await settle();
    const pendingA = h.controller.loadFile(makeFile("a.glb"));
    await settle();
    await h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    parseDeferred.resolve();
    await pendingA;
    await settle();
    assertEqual(
      h.controller.getState().asset,
      assetB,
      "selection: newer selection wins over a stale parse",
    );
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "selection: stale parsed candidate disposed",
    );
  }

  // Durable mutation ordering ------------------------------------------------
  {
    const h = createHarness();
    const assetP = { tag: "P" };
    const assetA = { tag: "A" };
    const assetB = { tag: "B" };
    h.parser.program(() => assetP);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("p.glb"));
    const saveDeferredA = createDeferred();
    h.parser.program(() => assetA);
    h.storage.programSave(() => saveDeferredA.promise);
    h.parser.program(() => assetB);
    const pendingA = h.controller.loadFile(makeFile("a.glb", { seed: 2 }));
    await settle();
    const pendingB = h.controller.loadFile(makeFile("b.glb", { seed: 3 }));
    await settle();
    saveDeferredA.resolve({ status: "saved" });
    await pendingA;
    await pendingB;
    await settle();
    assertEqual(
      h.storage.getDurable().fileName,
      "b.glb",
      "durable order: stale save cannot remain over the newer durable record",
    );
    assertEqual(
      h.controller.getState().asset,
      assetB,
      "durable order: newer successful save wins",
    );
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "durable order: stale replacement candidate disposed",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    const saveDeferredA = createDeferred();
    h.storage.programSave(() => saveDeferredA.promise);
    h.controller.start();
    await settle();
    const pendingA = h.controller.loadFile(makeFile("a.glb"));
    await settle();
    const pendingClear = h.controller.clearAvatar();
    await settle();
    saveDeferredA.resolve({ status: "saved" });
    await pendingA;
    await pendingClear;
    await settle();
    assertEqual(
      h.storage.getDurable(),
      undefined,
      "durable order: stale first save reconciled to empty",
    );
    assertEqual(
      h.controller.getState().asset,
      null,
      "durable order: stale first save leaves the primitive",
    );
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "durable order: stale first-save candidate disposed",
    );
  }
  {
    const h = createHarness();
    const assetP = { tag: "P" };
    h.parser.program(() => assetP);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("p.glb"));
    const clearDeferred = createDeferred();
    h.storage.programClear(() => clearDeferred.promise);
    const pendingClear = h.controller.clearAvatar();
    await settle();
    h.parser.program(() => {
      throw new Error("bad");
    });
    await h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    clearDeferred.resolve({ status: "cleared" });
    await pendingClear;
    await settle();
    assertEqual(
      h.storage.getDurable().fileName,
      "p.glb",
      "durable order: stale clear cannot permanently remove the desired durable workspace",
    );
    assertEqual(
      h.controller.getState().asset,
      assetP,
      "durable order: active avatar preserved after stale clear and failed selection",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    const assetB = { tag: "B" };
    h.parser.program(() => assetA);
    h.parser.program(() => assetB);
    const saveDeferredA = createDeferred();
    h.storage.programSave(() => saveDeferredA.promise);
    h.controller.start();
    await settle();
    const pendingA = h.controller.loadFile(makeFile("a.glb"));
    await settle();
    const pendingB = h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    await settle();
    assertEqual(
      h.storage.calls.save.length,
      1,
      "durable order: queued mutations execute serially",
    );
    saveDeferredA.resolve({ status: "saved" });
    await pendingA;
    await pendingB;
    await settle();
    assert(
      h.storage.calls.save.length >= 2,
      "durable order: later queued mutation runs after the earlier one settles",
    );
  }

  // Clear --------------------------------------------------------------------
  {
    const h = createHarness({ durable: buildWorkspace("p.glb", 7) });
    const restoreDeferred = createDeferred();
    const assetP = { tag: "P" };
    h.parser.program(() => restoreDeferred.promise.then(() => assetP));
    h.controller.start();
    await settle();
    assertEqual(
      h.controller.getState().lifecycleStatus,
      "restoring",
      "clear: restoring before clear",
    );
    const pendingClear = h.controller.clearAvatar();
    restoreDeferred.resolve();
    await pendingClear;
    await settle();
    assertEqual(
      h.controller.getState().asset,
      null,
      "clear: pending restore invalidated by clear",
    );
    assertEqual(
      h.disposer.countFor(assetP),
      1,
      "clear: stale restore candidate disposed after clear",
    );
    assertEqual(
      h.storage.getDurable(),
      undefined,
      "clear: durable record cleared",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    const saveDeferred = createDeferred();
    h.storage.programSave(() => saveDeferred.promise);
    h.controller.start();
    await settle();
    const pendingA = h.controller.loadFile(makeFile("a.glb"));
    await settle();
    const pendingClear = h.controller.clearAvatar();
    await settle();
    saveDeferred.resolve({ status: "saved" });
    await pendingA;
    await pendingClear;
    await settle();
    assertEqual(
      h.controller.getState().asset,
      null,
      "clear: pending selection invalidated by clear",
    );
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "clear: superseded selection candidate disposed",
    );
    assertEqual(
      h.storage.getDurable(),
      undefined,
      "clear: durable stays empty after an invalidated selection",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    const clearDeferred = createDeferred();
    h.storage.programClear(() => clearDeferred.promise);
    const pendingClear = h.controller.clearAvatar();
    await settle();
    assertEqual(
      h.controller.getState().lifecycleStatus,
      "clearing",
      "clear: clearing status while pending",
    );
    assertEqual(
      h.controller.getState().asset,
      assetA,
      "clear: active asset stays rendered while clear pending",
    );
    assertEqual(
      h.disposer.countFor(assetA),
      0,
      "clear: active asset not disposed until clear succeeds",
    );
    clearDeferred.resolve({ status: "cleared" });
    await pendingClear;
    await settle();
    const s = h.controller.getState();
    assertEqual(
      s.lifecycleStatus,
      "empty",
      "clear: success returns to primitive",
    );
    assertEqual(
      s.persistenceStatus,
      "none",
      "clear: success resets persistence",
    );
    assertEqual(s.asset, null, "clear: success removes active asset");
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "clear: success disposes the active asset",
    );
    assertEqual(
      h.storage.getDurable(),
      undefined,
      "clear: success durably clears the record",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    const durableA = h.storage.getDurable();
    h.storage.programClear(() => ({ status: "failed" }));
    await h.controller.clearAvatar();
    const s = h.controller.getState();
    assertEqual(s.asset, assetA, "clear: failure preserves the active asset");
    assertEqual(s.persistenceStatus, "clear_failed", "clear: failure surfaced");
    assertEqual(
      h.disposer.countFor(assetA),
      0,
      "clear: failure does not dispose the active asset",
    );
    assert(
      h.storage.getDurable() === durableA,
      "clear: failure preserves the durable record",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.storage.programSave(() => ({ status: "unavailable" }));
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    assertEqual(
      h.controller.getState().persistenceStatus,
      "unsaved",
      "clear: precondition unsaved avatar",
    );
    await h.controller.clearAvatar();
    const s = h.controller.getState();
    assertEqual(s.asset, null, "clear: unsaved avatar cleared safely");
    assertEqual(
      s.persistenceStatus,
      "none",
      "clear: unsaved avatar clear resets persistence",
    );
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "clear: unsaved avatar disposed on clear",
    );
  }

  // Unmount ------------------------------------------------------------------
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.dispose();
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "unmount: active asset disposed exactly once",
    );
    h.controller.dispose();
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "unmount: repeated dispose does not double-dispose",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    const saveDeferred = createDeferred();
    h.storage.programSave(() => saveDeferred.promise);
    h.controller.start();
    await settle();
    const pendingA = h.controller.loadFile(makeFile("a.glb"));
    await settle();
    const statesBefore = h.states.length;
    h.controller.dispose();
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "unmount: pending parsed candidate disposed",
    );
    saveDeferred.resolve({ status: "saved" });
    await pendingA;
    await settle();
    assertEqual(
      h.states.length,
      statesBefore,
      "unmount: disposed controller commits no further state",
    );
    assertEqual(
      h.disposer.countFor(assetA),
      1,
      "unmount: candidate not disposed twice after a late save",
    );
  }

  // Framing restoration ------------------------------------------------------
  {
    const h = createHarness();
    const loadDeferred = createDeferred();
    h.storage.programLoad(() => loadDeferred.promise);
    h.controller.start();
    await settle();
    assert(
      isDefaultFraming(h.controller.getState().framing),
      "framing restore: default framing while storage load pending",
    );
    assertEqual(
      h.controller.getState().framingStatus,
      "none",
      "framing restore: framing status none while load pending",
    );
    loadDeferred.resolve({ status: "empty" });
    await settle();
    assert(
      isDefaultFraming(h.controller.getState().framing),
      "framing restore: empty storage keeps default framing",
    );
  }
  for (const status of ["unavailable", "failed"]) {
    const h = createHarness();
    h.storage.programLoad(() => ({ status }));
    h.controller.start();
    await settle();
    assert(
      isDefaultFraming(h.controller.getState().framing),
      `framing restore: ${status} keeps default framing`,
    );
    assertEqual(
      h.controller.getState().framingStatus,
      "none",
      `framing restore: ${status} framing status none`,
    );
  }
  {
    const h = createHarness({
      durable: buildWorkspaceWithFraming("x.glb", framingA),
    });
    h.storage.programLoad(() => ({ status: "invalid" }));
    h.controller.start();
    await settle();
    assert(
      isDefaultFraming(h.controller.getState().framing),
      "framing restore: invalid record falls back to default framing",
    );
  }
  {
    // Coherent restore: asset and its stored framing commit together, and no
    // emitted state ever shows the restored asset with default/stale framing.
    const stored = buildWorkspaceWithFraming("a.glb", framingA, 5);
    const h = createHarness({ durable: stored });
    const parseDeferred = createDeferred();
    const assetP = { tag: "P" };
    h.parser.program(() => parseDeferred.promise.then(() => assetP));
    h.controller.start();
    await settle();
    assertEqual(
      h.controller.getState().lifecycleStatus,
      "restoring",
      "framing restore: restoring while stored bytes parse",
    );
    assert(
      isDefaultFraming(h.controller.getState().framing),
      "framing restore: framing stays default until the coherent commit",
    );
    parseDeferred.resolve();
    await settle();
    const s = h.controller.getState();
    assertEqual(s.asset, assetP, "framing restore: restored asset committed");
    assert(
      framingsEqual(s.framing, framingA),
      "framing restore: stored framing committed with the asset",
    );
    assertEqual(
      s.framingStatus,
      "saved",
      "framing restore: restored framing marked saved",
    );
    for (const state of h.states)
      if (state.asset !== null)
        assert(
          framingsEqual(state.framing, framingA),
          "framing restore: restored asset never emitted with default/stale framing",
        );
  }
  {
    // A newer selection supersedes both the restored asset and its framing.
    const stored = buildWorkspaceWithFraming("a.glb", framingA, 5);
    const h = createHarness({ durable: stored });
    const parseDeferred = createDeferred();
    const assetP = { tag: "P" };
    const assetB = { tag: "B" };
    h.parser.program(() => parseDeferred.promise.then(() => assetP));
    h.parser.program(() => assetB);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    parseDeferred.resolve();
    await settle();
    const s = h.controller.getState();
    assertEqual(
      s.asset,
      assetB,
      "framing restore: selection supersedes the restored asset",
    );
    assert(
      isDefaultFraming(s.framing),
      "framing restore: superseded restore never applies the stored framing",
    );
    assertEqual(
      h.disposer.countFor(assetP),
      1,
      "framing restore: superseded restore candidate disposed",
    );
    assert(
      isDefaultFraming(h.storage.getDurable().framing),
      "framing restore: selection persists with current (default) framing",
    );
  }
  {
    // A clear supersedes both the restored asset and its framing.
    const stored = buildWorkspaceWithFraming("a.glb", framingA, 5);
    const h = createHarness({ durable: stored });
    const parseDeferred = createDeferred();
    const assetP = { tag: "P" };
    h.parser.program(() => parseDeferred.promise.then(() => assetP));
    h.controller.start();
    await settle();
    const pendingClear = h.controller.clearAvatar();
    parseDeferred.resolve();
    await pendingClear;
    await settle();
    const s = h.controller.getState();
    assertEqual(
      s.asset,
      null,
      "framing restore: clear supersedes the restored asset",
    );
    assert(
      isDefaultFraming(s.framing),
      "framing restore: clear resets framing to defaults",
    );
    assertEqual(
      s.framingStatus,
      "none",
      "framing restore: clear leaves framing status none",
    );
    assertEqual(
      h.disposer.countFor(assetP),
      1,
      "framing restore: restore candidate disposed after clear",
    );
  }
  {
    // Restore-only (OBS) hydrates and applies framing without any write.
    const stored = buildWorkspaceWithFraming("a.glb", framingA, 5);
    const h = createHarness({ durable: stored, accessMode: "restore-only" });
    const assetP = { tag: "P" };
    h.parser.program(() => assetP);
    h.controller.start();
    await settle();
    const s = h.controller.getState();
    assertEqual(s.asset, assetP, "restore-only: valid durable record restored");
    assert(
      framingsEqual(s.framing, framingA),
      "restore-only: stored framing applied",
    );
    assertEqual(
      s.framingStatus,
      "saved",
      "restore-only: restored framing saved",
    );
    assertEqual(
      h.storage.calls.save.length,
      0,
      "restore-only: restoration performs no save",
    );
    assertEqual(
      h.storage.calls.clear,
      0,
      "restore-only: restoration performs no clear",
    );
    h.controller.setFraming(framingB);
    h.controller.resetFraming();
    await h.controller.loadFile(makeFile("c.glb", { seed: 3 }));
    await h.controller.clearAvatar();
    await settle();
    assertEqual(
      h.storage.calls.save.length,
      0,
      "restore-only: setFraming/loadFile perform no save",
    );
    assertEqual(
      h.storage.calls.clear,
      0,
      "restore-only: clearAvatar performs no clear",
    );
    assert(
      framingsEqual(h.controller.getState().framing, framingA),
      "restore-only: framing unchanged by no-op mutating actions",
    );
    assertEqual(
      h.scheduler.pending(),
      0,
      "restore-only: no framing write is ever scheduled",
    );
  }
  {
    // Restore-only never cleans up an invalid record.
    const h = createHarness({
      durable: buildWorkspaceWithFraming("x.glb", framingA),
      accessMode: "restore-only",
    });
    h.storage.programLoad(() => ({ status: "invalid" }));
    h.controller.start();
    await settle();
    assertEqual(
      h.controller.getState().asset,
      null,
      "restore-only: invalid record renders the primitive",
    );
    assert(
      isDefaultFraming(h.controller.getState().framing),
      "restore-only: invalid record keeps default framing",
    );
    assertEqual(
      h.storage.calls.clear,
      0,
      "restore-only: invalid record is not cleared",
    );
  }

  // Framing selection --------------------------------------------------------
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    const assetB = { tag: "B" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    assert(
      framingsEqual(h.controller.getState().framing, framingA),
      "framing selection: setFraming updates in-memory framing immediately",
    );
    h.parser.program(() => assetB);
    await h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    const durable = h.storage.getDurable();
    assertEqual(
      durable.fileName,
      "b.glb",
      "framing selection: replacement persisted",
    );
    assert(
      framingsEqual(durable.framing, framingA),
      "framing selection: replacement workspace includes current framing",
    );
    assertEqual(
      h.controller.getState().asset,
      assetB,
      "framing selection: replacement committed",
    );
    assert(
      framingsEqual(h.controller.getState().framing, framingA),
      "framing selection: framing preserved across replacement",
    );
    assertEqual(
      h.controller.getState().framingStatus,
      "saved",
      "framing selection: replacement framing marked saved",
    );
    assertEqual(
      h.scheduler.pending(),
      0,
      "framing selection: no framing timer lingers after coherent replacement",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    const assetB = { tag: "B" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    h.scheduler.flush();
    await settle();
    assert(
      framingsEqual(h.storage.getDurable().framing, framingA),
      "framing selection: framingA persisted for the active avatar",
    );
    h.parser.program(() => assetB);
    h.storage.programSave(() => ({ status: "failed" }));
    await h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    const s = h.controller.getState();
    assertEqual(
      s.asset,
      assetA,
      "framing selection: failed replacement preserves the active asset",
    );
    assert(
      framingsEqual(s.framing, framingA),
      "framing selection: failed replacement preserves in-memory framing",
    );
    assert(
      framingsEqual(h.storage.getDurable().framing, framingA),
      "framing selection: failed replacement preserves durable framing",
    );
    assertEqual(
      h.disposer.countFor(assetB),
      1,
      "framing selection: failed replacement candidate disposed",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.storage.programSave(() => ({ status: "unavailable" }));
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    assertEqual(
      h.controller.getState().persistenceStatus,
      "unsaved",
      "framing selection: first unsaved avatar",
    );
    assertEqual(
      h.controller.getState().framingStatus,
      "memory_only",
      "framing selection: unsaved avatar framing is memory-only",
    );
    const savesBefore = h.storage.calls.save.length;
    h.controller.setFraming(framingA);
    assert(
      framingsEqual(h.controller.getState().framing, framingA),
      "framing selection: unsaved avatar framing updates in memory",
    );
    assertEqual(
      h.controller.getState().framingStatus,
      "memory_only",
      "framing selection: unsaved avatar framing stays memory-only",
    );
    assertEqual(
      h.scheduler.pending(),
      0,
      "framing selection: unsaved avatar schedules no framing save",
    );
    h.scheduler.flush();
    await settle();
    assertEqual(
      h.storage.calls.save.length,
      savesBefore,
      "framing selection: unsaved avatar framing change writes nothing",
    );
  }

  // Framing debounce ---------------------------------------------------------
  {
    const h = createHarness();
    h.parser.program(() => ({ tag: "A" }));
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    const savesAfterLoad = h.storage.calls.save.length;
    h.controller.setFraming(framingA);
    assert(
      framingsEqual(h.controller.getState().framing, framingA),
      "framing debounce: in-memory framing changes immediately",
    );
    assertEqual(
      h.controller.getState().framingStatus,
      "dirty",
      "framing debounce: framing marked dirty while a save is pending",
    );
    assertEqual(
      h.scheduler.pending(),
      1,
      "framing debounce: one change schedules exactly one timer",
    );
    assertEqual(
      h.scheduler.lastDelay(),
      200,
      "framing debounce: trailing delay is 200 ms",
    );
    h.controller.setFraming(framingB);
    h.controller.setFraming(framingA);
    assertEqual(
      h.scheduler.pending(),
      1,
      "framing debounce: rapid changes cancel and replace the prior timer",
    );
    assertEqual(
      h.storage.calls.save.length,
      savesAfterLoad,
      "framing debounce: no save occurs before the trailing callback",
    );
    h.scheduler.flush();
    await settle();
    assertEqual(
      h.storage.calls.save.length,
      savesAfterLoad + 1,
      "framing debounce: exactly one framing save runs on the trailing callback",
    );
    assert(
      framingsEqual(h.storage.getDurable().framing, framingA),
      "framing debounce: only the latest framing is saved",
    );
    assertEqual(
      h.controller.getState().framingStatus,
      "saved",
      "framing debounce: framing saved after the trailing callback",
    );
  }
  {
    const h = createHarness();
    h.parser.program(() => ({ tag: "A" }));
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    assertEqual(
      h.scheduler.pending(),
      1,
      "framing debounce: timer scheduled before dispose",
    );
    h.controller.dispose();
    assertEqual(
      h.scheduler.pending(),
      0,
      "framing debounce: disposed controller cancels the pending timer",
    );
  }

  // Framing save results -----------------------------------------------------
  for (const status of ["unavailable", "failed"]) {
    const h = createHarness();
    h.parser.program(() => ({ tag: "A" }));
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    h.storage.programSave(() => ({ status }));
    h.scheduler.flush();
    await settle();
    const s = h.controller.getState();
    assertEqual(
      s.framingStatus,
      "save_failed",
      `framing save: ${status} marks the framing save failed`,
    );
    assert(
      framingsEqual(s.framing, framingA),
      `framing save: ${status} keeps the in-memory framing`,
    );
    assert(
      isDefaultFraming(h.storage.getDurable().framing),
      `framing save: ${status} preserves the last confirmed durable framing`,
    );
  }
  {
    // A stale save completion cannot mark a newer framing revision as saved, and
    // an older save finishing after a newer change cannot become durable.
    const h = createHarness();
    h.parser.program(() => ({ tag: "A" }));
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    const saveDeferredA = createDeferred();
    h.storage.programSave(() => saveDeferredA.promise);
    h.controller.setFraming(framingA);
    h.scheduler.flush();
    await settle();
    assertEqual(
      h.controller.getState().framingStatus,
      "saving",
      "framing save ordering: framing A save in flight",
    );
    h.controller.setFraming(framingB);
    h.scheduler.flush();
    saveDeferredA.resolve({ status: "saved" });
    await settle();
    const s = h.controller.getState();
    assert(
      framingsEqual(s.framing, framingB),
      "framing save ordering: in-memory framing is the newest value",
    );
    assert(
      framingsEqual(h.storage.getDurable().framing, framingB),
      "framing save ordering: the newest framing wins the durable record",
    );
    assertEqual(
      s.framingStatus,
      "saved",
      "framing save ordering: final framing status is saved for the newest value",
    );
  }

  {
    // A stale framing save that succeeds after a newer revision exists must be
    // repaired back to the last confirmed durable workspace even when the asset
    // generation has not changed; a later failed newest save must not leave the
    // stale revision durable.
    const h = createHarness();
    h.parser.program(() => ({ tag: "A" }));
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    const saveDeferredA = createDeferred();
    h.storage.programSave(() => saveDeferredA.promise);
    h.controller.setFraming(framingA);
    h.scheduler.flush();
    await settle();
    h.storage.programSave(() => ({ status: "saved" }));
    h.storage.programSave(() => ({ status: "failed" }));
    h.controller.setFraming(framingB);
    h.scheduler.flush();
    saveDeferredA.resolve({ status: "saved" });
    await settle();
    const s = h.controller.getState();
    assert(
      framingsEqual(s.framing, framingB),
      "framing stale repair: in-memory framing remains the newest value",
    );
    assertEqual(
      s.framingStatus,
      "save_failed",
      "framing stale repair: failed newest save is reported",
    );
    assert(
      isDefaultFraming(h.storage.getDurable().framing),
      "framing stale repair: durable framing returns to confirmed defaults",
    );
    assert(
      !framingsEqual(h.storage.getDurable().framing, framingA),
      "framing stale repair: stale framing A is not final durable state",
    );
  }
  for (const invalidFile of [
    makeFile("invalid.txt"),
    makeFile("zero.glb", { size: 0 }),
  ]) {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    assertEqual(
      h.scheduler.pending(),
      1,
      "framing recovery invalid selection: precondition dirty timer",
    );
    await h.controller.loadFile(invalidFile);
    const s = h.controller.getState();
    assertEqual(
      s.asset,
      assetA,
      "framing recovery invalid selection: active asset remains",
    );
    assert(
      framingsEqual(s.framing, framingA),
      "framing recovery invalid selection: framing remains",
    );
    assertEqual(
      s.framingStatus,
      "dirty",
      "framing recovery invalid selection: framing is dirty",
    );
    assertEqual(
      h.scheduler.pending(),
      1,
      "framing recovery invalid selection: exactly one retry timer",
    );
    h.scheduler.flush();
    await settle();
    assert(
      framingsEqual(h.storage.getDurable().framing, framingA),
      "framing recovery invalid selection: flush persists framing A",
    );
    assertEqual(
      h.controller.getState().framingStatus,
      "saved",
      "framing recovery invalid selection: flush marks saved",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    h.parser.program(() => {
      throw new Error("bad replacement");
    });
    await h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    assertEqual(
      h.controller.getState().asset,
      assetA,
      "framing recovery parser failure: previous asset remains",
    );
    assert(
      framingsEqual(h.controller.getState().framing, framingA),
      "framing recovery parser failure: framing remains",
    );
    assertEqual(
      h.scheduler.pending(),
      1,
      "framing recovery parser failure: one framing retry scheduled",
    );
    h.scheduler.flush();
    await settle();
    assertEqual(
      h.storage.getDurable().fileName,
      "a.glb",
      "framing recovery parser failure: previous GLB remains durable",
    );
    assert(
      framingsEqual(h.storage.getDurable().framing, framingA),
      "framing recovery parser failure: previous workspace gets framing A",
    );
  }
  for (const status of ["failed", "unavailable"]) {
    const h = createHarness();
    const assetA = { tag: "A" };
    const assetB = { tag: "B" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    h.parser.program(() => assetB);
    h.storage.programSave(() => ({ status }));
    await h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    assertEqual(
      h.controller.getState().asset,
      assetA,
      `framing recovery replacement ${status}: previous asset remains`,
    );
    assertEqual(
      h.disposer.countFor(assetB),
      1,
      `framing recovery replacement ${status}: candidate disposed once`,
    );
    assertEqual(
      h.scheduler.pending(),
      1,
      `framing recovery replacement ${status}: one framing retry scheduled`,
    );
    h.scheduler.flush();
    await settle();
    assertEqual(
      h.storage.getDurable().fileName,
      "a.glb",
      `framing recovery replacement ${status}: previous GLB remains durable`,
    );
    assert(
      framingsEqual(h.storage.getDurable().framing, framingA),
      `framing recovery replacement ${status}: previous GLB persisted with framing A`,
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    h.storage.programClear(() => ({ status: "failed" }));
    await h.controller.clearAvatar();
    assertEqual(
      h.controller.getState().asset,
      assetA,
      "framing recovery clear failure: active asset remains",
    );
    assert(
      framingsEqual(h.controller.getState().framing, framingA),
      "framing recovery clear failure: framing remains",
    );
    assert(
      h.controller.getState().framingStatus !== "saving",
      "framing recovery clear failure: not stuck saving",
    );
    assertEqual(
      h.scheduler.pending(),
      1,
      "framing recovery clear failure: exactly one retry timer",
    );
    h.scheduler.flush();
    await settle();
    assert(
      framingsEqual(h.storage.getDurable().framing, framingA),
      "framing recovery clear failure: flush persists framing A",
    );
    assertEqual(
      h.controller.getState().framingStatus,
      "saved",
      "framing recovery clear failure: flush marks saved",
    );
  }
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    const saveDeferred = createDeferred();
    h.storage.programSave(() => saveDeferred.promise);
    h.controller.setFraming(framingA);
    h.scheduler.flush();
    await settle();
    const clearDeferred = createDeferred();
    h.storage.programClear(() => clearDeferred.promise);
    const pendingClear = h.controller.clearAvatar();
    await settle();
    saveDeferred.resolve({ status: "saved" });
    clearDeferred.resolve({ status: "failed" });
    await pendingClear;
    await settle();
    const s = h.controller.getState();
    assertEqual(
      s.asset,
      assetA,
      "framing recovery in-flight clear failure: active asset remains",
    );
    assert(
      framingsEqual(s.framing, framingA),
      "framing recovery in-flight clear failure: framing remains coherent",
    );
    assert(
      s.framingStatus !== "saving",
      "framing recovery in-flight clear failure: not permanently saving",
    );
    assert(
      h.scheduler.pending() <= 1,
      "framing recovery in-flight clear failure: at most one retry timer",
    );
  }

  // Framing reset ------------------------------------------------------------
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    assertEqual(
      h.scheduler.pending(),
      1,
      "framing reset: a framing change scheduled a timer",
    );
    h.controller.resetFraming();
    assert(
      isDefaultFraming(h.controller.getState().framing),
      "framing reset: defaults apply immediately",
    );
    assertEqual(
      h.scheduler.pending(),
      1,
      "framing reset: the older timer is invalidated and replaced",
    );
    h.scheduler.flush();
    await settle();
    assert(
      isDefaultFraming(h.storage.getDurable().framing),
      "framing reset: a durable avatar persists the defaults",
    );
    assertEqual(
      h.controller.getState().asset,
      assetA,
      "framing reset: reset keeps the active avatar and stays separate from clear",
    );
    assertEqual(
      h.storage.calls.clear,
      0,
      "framing reset: reset does not clear the durable record",
    );
  }
  {
    const h = createHarness();
    h.parser.program(() => ({ tag: "A" }));
    h.storage.programSave(() => ({ status: "unavailable" }));
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    const savesBefore = h.storage.calls.save.length;
    h.controller.resetFraming();
    assert(
      isDefaultFraming(h.controller.getState().framing),
      "framing reset: unsaved avatar reset applies defaults in memory",
    );
    assertEqual(
      h.controller.getState().framingStatus,
      "memory_only",
      "framing reset: unsaved avatar reset stays memory-only",
    );
    assertEqual(
      h.scheduler.pending(),
      0,
      "framing reset: unsaved avatar reset schedules no write",
    );
    h.scheduler.flush();
    await settle();
    assertEqual(
      h.storage.calls.save.length,
      savesBefore,
      "framing reset: unsaved avatar reset writes nothing",
    );
  }

  // Framing clear + mutation ordering ----------------------------------------
  {
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    assertEqual(
      h.scheduler.pending(),
      1,
      "framing clear: a framing save was scheduled before clear",
    );
    await h.controller.clearAvatar();
    assertEqual(
      h.scheduler.pending(),
      0,
      "framing clear: clear cancels the scheduled framing save",
    );
    const s = h.controller.getState();
    assertEqual(s.asset, null, "framing clear: success removes the asset");
    assert(
      isDefaultFraming(s.framing),
      "framing clear: success resets framing to defaults",
    );
    assertEqual(
      s.framingStatus,
      "none",
      "framing clear: success sets framing status none",
    );
    assertEqual(
      h.storage.getDurable(),
      undefined,
      "framing clear: durable record removed",
    );
  }
  {
    // A stale in-flight framing save must not recreate a cleared workspace.
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    const saveDeferred = createDeferred();
    h.storage.programSave(() => saveDeferred.promise);
    h.controller.setFraming(framingA);
    h.scheduler.flush();
    await settle();
    assertEqual(
      h.controller.getState().framingStatus,
      "saving",
      "framing clear ordering: framing save is in flight",
    );
    const clearDeferred = createDeferred();
    h.storage.programClear(() => clearDeferred.promise);
    const pendingClear = h.controller.clearAvatar();
    await settle();
    saveDeferred.resolve({ status: "saved" });
    clearDeferred.resolve({ status: "cleared" });
    await pendingClear;
    await settle();
    assertEqual(
      h.storage.getDurable(),
      undefined,
      "framing clear ordering: a stale framing save cannot recreate the cleared workspace",
    );
    assertEqual(
      h.controller.getState().asset,
      null,
      "framing clear ordering: clear wins over the pending framing save",
    );
    assert(
      isDefaultFraming(h.controller.getState().framing),
      "framing clear ordering: framing is reset after the winning clear",
    );
  }
  {
    // A failed clear preserves a coherent current workspace.
    const h = createHarness();
    const assetA = { tag: "A" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    h.controller.setFraming(framingA);
    h.scheduler.flush();
    await settle();
    const durableBefore = h.storage.getDurable();
    assert(
      framingsEqual(durableBefore.framing, framingA),
      "framing clear failure: framingA persisted before clear",
    );
    h.storage.programClear(() => ({ status: "failed" }));
    await h.controller.clearAvatar();
    const s = h.controller.getState();
    assertEqual(
      s.asset,
      assetA,
      "framing clear failure: active asset preserved",
    );
    assert(
      framingsEqual(s.framing, framingA),
      "framing clear failure: in-memory framing preserved",
    );
    assert(
      h.storage.getDurable() === durableBefore,
      "framing clear failure: durable record preserved",
    );
  }
  {
    // Pending framing save followed by a successful replacement ends with the
    // replacement workspace carrying the current framing.
    const h = createHarness();
    const assetA = { tag: "A" };
    const assetB = { tag: "B" };
    h.parser.program(() => assetA);
    h.controller.start();
    await settle();
    await h.controller.loadFile(makeFile("a.glb"));
    const saveDeferred = createDeferred();
    h.storage.programSave(() => saveDeferred.promise);
    h.controller.setFraming(framingA);
    h.scheduler.flush();
    await settle();
    h.parser.program(() => assetB);
    const pendingB = h.controller.loadFile(makeFile("b.glb", { seed: 2 }));
    await settle();
    saveDeferred.resolve({ status: "saved" });
    await pendingB;
    await settle();
    assertEqual(
      h.controller.getState().asset,
      assetB,
      "framing ordering: replacement after a pending framing save wins",
    );
    assertEqual(
      h.storage.getDurable().fileName,
      "b.glb",
      "framing ordering: durable is the replacement workspace",
    );
    assert(
      framingsEqual(h.storage.getDurable().framing, framingA),
      "framing ordering: the replacement keeps the current framing",
    );
  }

  console.log(
    `Web Preview local avatar contract check passed.\n  - extracted framing contract remains shared with AvatarPreview and keeps exact v0.11.0 bounds
  - versioned v1 workspace validation, defensive cloning, and the 50 MiB GLB byte limit are covered
  - bounded IndexedDB load/save/clear results are covered with an injected dependency-free record store
  - blocked IndexedDB opens reject once and close delayed successful abandoned database handles
  - local-only and dependency-free storage boundary assertions are present
  - the local-only GLB byte parser is shared by selected and restored bytes with user-safe error mapping
  - the pure lifecycle controller stays framework-free and reuses the versioned workspace module
  - scale, vertical offset, and yaw framing are owned by the workspace controller and restored coherently with the GLB asset; framing persists through a 200 ms trailing debounce with an injected manual scheduler\n  - yaw is displayed/stored in degrees and converted to radians exactly once for the loaded-GLB path\n  - static framing remains separated from MotionFrame root/head motion before the parsed GLB primitive\n  - restore lifecycle, save-before-commit, first-selection unsaved fallback, failed-replacement preservation, durable mutation ordering with stale reconciliation, explicit durable clear, and Three.js resource ownership are behaviorally covered with fake storage/parser/assets and deferred Promises\n  - framing debounce correctness, stale/superseded framing-save invalidation, reset-to-default persistence, and framing/replacement/clear ordering are behaviorally covered\n  - standard Preview uses interactive read/write access; OBS uses restore-only access that hydrates the durable GLB and framing without ever mutating storage\n  - dummy/native source selection remains independent\n  - local avatar controls remain excluded from OBS output while Canvas/AvatarScene remain renderable\n  - OBS alpha canvas, transparent shell/canvas, and full-viewport contracts remain present\n  - checker registration is exact-once through the Web Preview test chain\n  NOTE: automated lifecycle/source evidence only; NOT real browser IndexedDB reload persistence, representative GLB, GPU, OBS application, Electron GUI, Native Core runtime, webcam, or hardware validation.`,
  );
};

runCheck().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
