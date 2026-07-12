#!/usr/bin/env node
import { readFile } from "node:fs/promises";

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

const runCheck = async () => {
  const [
    rootPackageSource,
    webPackageSource,
    loaderSource,
    loadedSource,
    previewSource,
    cssSource,
  ] = await Promise.all([
    readFile(ROOT_PACKAGE_URL, "utf8"),
    readFile(WEB_PACKAGE_URL, "utf8"),
    readFile(LOCAL_AVATAR_URL, "utf8"),
    readFile(LOADED_GLB_URL, "utf8"),
    readFile(AVATAR_PREVIEW_URL, "utf8"),
    readFile(APP_CSS_URL, "utf8"),
  ]);
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
    "const DEFAULT_LOCAL_AVATAR_SCALE = 1",
    "const MIN_LOCAL_AVATAR_SCALE = 0.25",
    "const MAX_LOCAL_AVATAR_SCALE = 3",
    "const LOCAL_AVATAR_SCALE_STEP = 0.05",
    "const DEFAULT_LOCAL_AVATAR_VERTICAL_OFFSET = 0",
    "const MIN_LOCAL_AVATAR_VERTICAL_OFFSET = -2",
    "const MAX_LOCAL_AVATAR_VERTICAL_OFFSET = 2",
    "const LOCAL_AVATAR_VERTICAL_OFFSET_STEP = 0.05",
    "const DEFAULT_LOCAL_AVATAR_YAW_DEGREES = 0",
    "const MIN_LOCAL_AVATAR_YAW_DEGREES = -180",
    "const MAX_LOCAL_AVATAR_YAW_DEGREES = 180",
    "const LOCAL_AVATAR_YAW_STEP_DEGREES = 1",
  ])
    assert(
      previewSource.includes(constantNeedle),
      `local avatar scale control: missing ${constantNeedle}`,
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

  console.log(
    `Web Preview local avatar contract check passed.\n  - scale, vertical offset, yaw degree controls, and reset framing remain wired to renderer-owned memory-only state\n  - yaw is displayed/stored in degrees and converted to radians exactly once for the loaded-GLB path\n  - static framing remains separated from MotionFrame root/head motion before the parsed GLB primitive\n  - manual ownership is preserved across the root, static framing, head motion, scale, and primitive nodes\n  - local .glb lifecycle preservation remains covered: local-only loading, fallback, replacement retention, stale cleanup, reset invalidation, and unmount disposal\n  - dummy/native source selection remains independent\n  - local avatar controls remain excluded from OBS output while Canvas/AvatarScene remain renderable\n  - OBS alpha canvas, transparent shell/canvas, and full-viewport contracts remain present\n  - checker registration is exact-once through the Web Preview test chain\n  - automated source/contract evidence only\n  NOTE: source/behavior checker evidence only; NOT browser, representative GLB, GPU, OBS application, webcam, Electron GUI, or native runtime validation.`,
  );
};

runCheck().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
