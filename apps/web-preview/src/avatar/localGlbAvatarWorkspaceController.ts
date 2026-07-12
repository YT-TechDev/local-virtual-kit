import {
  MAX_LOCAL_AVATAR_GLB_BYTES,
  createDefaultLocalAvatarFraming,
  createLocalAvatarWorkspace,
  parseLocalAvatarFraming,
  type LocalAvatarFraming,
  type LocalAvatarWorkspace,
  type LocalAvatarWorkspaceStorage,
} from "./localAvatarWorkspace";

// Lifecycle of the Web Preview local avatar workspace. The controller stays
// framework-independent so lifecycle ordering can be exercised without mounting
// React or opening real browser IndexedDB. React ownership, Three.js parsing,
// IndexedDB adapters, and the debounce scheduler are injected.
//
// The controller owns the durable avatar asset AND its framing (uniform scale,
// vertical offset, yaw) so a restored GLB and its stored framing commit in one
// coherent state transition, and so framing edits persist through the same
// serialized durable mutation queue that protects asset saves and clears.

export type LocalGlbAvatarLifecycleStatus =
  | "checking"
  | "restoring"
  | "empty"
  | "loading"
  | "ready"
  | "clearing"
  | "error";

export type LocalGlbAvatarPersistenceStatus =
  | "none"
  | "persisted"
  | "unsaved"
  | "unavailable"
  | "read_failed"
  | "write_failed"
  | "invalid"
  | "clear_failed";

// Explicit bounded status for the latest framing edit, kept separate from the
// asset persistence status so honest framing states are never conflated with
// asset lifecycle transitions.
//   none        : no active avatar / default fallback
//   saved       : current framing matches the confirmed durable workspace
//   dirty       : in-memory framing changed and a trailing save is pending
//   saving      : a durable framing save is executing
//   save_failed : latest framing remains in memory but is not durable
//   memory_only : the active avatar itself is unsaved, so framing cannot persist
export type LocalAvatarFramingPersistenceStatus =
  | "none"
  | "saved"
  | "dirty"
  | "saving"
  | "save_failed"
  | "memory_only";

// Interactive: standard Preview may restore, select, save, update framing, reset
// framing, and clear. Restore-only: OBS may load and render the durable GLB and
// apply its persisted framing, but never saves, clears, or schedules writes.
export type LocalAvatarWorkspaceAccessMode = "interactive" | "restore-only";

export type LocalGlbAvatarWorkspaceState<Asset> = {
  asset: Asset | null;
  pendingFileName: string | null;
  lifecycleStatus: LocalGlbAvatarLifecycleStatus;
  persistenceStatus: LocalGlbAvatarPersistenceStatus;
  framing: LocalAvatarFraming;
  framingStatus: LocalAvatarFramingPersistenceStatus;
  errorMessage: string | null;
};

// Minimal structural view of a browser File. The real File satisfies this and
// fakes can implement it without a DOM. Absolute paths are never exposed.
export type LocalGlbAvatarFileInput = {
  name: string;
  size: number;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type ParseLocalGlbAvatarBytes<Asset> = (
  fileName: string,
  glbBytes: ArrayBuffer,
) => Promise<Asset>;

// Injected scheduler so the trailing framing debounce stays deterministic in
// Node tests. The hook supplies window.setTimeout / window.clearTimeout; the
// contract checker supplies a manual scheduler with no fake timers.
export type LocalGlbAvatarTimeoutHandle = unknown;
export type ScheduleLocalGlbAvatarTimeout = (
  callback: () => void,
  delayMs: number,
) => LocalGlbAvatarTimeoutHandle;
export type CancelLocalGlbAvatarTimeout = (
  handle: LocalGlbAvatarTimeoutHandle,
) => void;

// Trailing debounce window for durable framing saves. One explicit constant.
export const LOCAL_AVATAR_FRAMING_SAVE_DEBOUNCE_MS = 200;

export type LocalGlbAvatarWorkspaceControllerOptions<Asset extends object> = {
  storage: LocalAvatarWorkspaceStorage;
  parseBytes: ParseLocalGlbAvatarBytes<Asset>;
  disposeAsset: (asset: Asset) => void;
  onStateChange: (state: LocalGlbAvatarWorkspaceState<Asset>) => void;
  accessMode: LocalAvatarWorkspaceAccessMode;
  scheduleTimeout: ScheduleLocalGlbAvatarTimeout;
  cancelTimeout: CancelLocalGlbAvatarTimeout;
};

export type LocalGlbAvatarWorkspaceController<Asset extends object> = {
  getState: () => LocalGlbAvatarWorkspaceState<Asset>;
  start: () => void;
  loadFile: (file: LocalGlbAvatarFileInput) => Promise<void>;
  setFraming: (nextFraming: LocalAvatarFraming) => void;
  resetFraming: () => void;
  clearAvatar: () => Promise<void>;
  dispose: () => void;
};

const UNSUPPORTED_FILE_MESSAGE = "Select a single local .glb file.";
const EMPTY_FILE_MESSAGE =
  "This file is empty. Select a valid local .glb file.";
const OVERSIZE_FILE_MESSAGE =
  "This GLB is larger than the 50 MB local avatar limit.";
const PARSE_FALLBACK_MESSAGE =
  "Could not read this GLB. Select a valid local .glb file.";
const RESTORE_UNAVAILABLE_MESSAGE =
  "Browser-local storage is unavailable, so the built-in avatar is shown.";
const RESTORE_READ_FAILED_MESSAGE =
  "Could not read browser-local storage, so the built-in avatar is shown.";
const RESTORE_INVALID_CLEARED_MESSAGE =
  "The saved avatar data was invalid and has been cleared; the built-in avatar is shown.";
const RESTORE_INVALID_CLEAR_FAILED_MESSAGE =
  "The saved avatar data was invalid and could not be cleared automatically; the built-in avatar is shown.";
const CLEAR_FAILED_MESSAGE =
  "Could not remove the saved avatar from browser-local storage; it is still loaded.";

const hasGlbExtension = (fileName: string) =>
  fileName.toLowerCase().endsWith(".glb");

const normalizeFileMimeType = (
  type: string,
): "model/gltf-binary" | "application/octet-stream" | null =>
  type === "model/gltf-binary" || type === "application/octet-stream"
    ? type
    : null;

const framingEquals = (a: LocalAvatarFraming, b: LocalAvatarFraming) =>
  a.uniformScale === b.uniformScale &&
  a.verticalOffset === b.verticalOffset &&
  a.yawDegrees === b.yawDegrees;

const replacementFailureMessage = (
  fileName: string,
  unavailable: boolean,
): string =>
  unavailable
    ? "Browser-local storage is unavailable, so the current avatar is kept."
    : `Could not save "${fileName}" to browser-local storage, so the current avatar is kept.`;

export const createLocalGlbAvatarWorkspaceController = <Asset extends object>(
  options: LocalGlbAvatarWorkspaceControllerOptions<Asset>,
): LocalGlbAvatarWorkspaceController<Asset> => {
  const {
    storage,
    parseBytes,
    disposeAsset,
    onStateChange,
    accessMode,
    scheduleTimeout,
    cancelTimeout,
  } = options;

  const isInteractive = accessMode === "interactive";

  // Every distinct asset operation (restore start, selection, clear, dispose)
  // claims a new generation. Async results check their captured generation
  // before committing so stale restores/selections/clears cannot mutate live
  // state.
  let generation = 0;
  let disposed = false;

  let activeAsset: Asset | null = null;
  let pendingFileName: string | null = null;
  let lifecycleStatus: LocalGlbAvatarLifecycleStatus = "checking";
  let persistenceStatus: LocalGlbAvatarPersistenceStatus = "none";
  let errorMessage: string | null = null;

  // Renderer-owned framing lives here so a restored asset and its stored framing
  // commit together, and so framing edits reconcile through the same durable
  // queue as asset saves/clears.
  let framing: LocalAvatarFraming = createDefaultLocalAvatarFraming();
  let framingStatus: LocalAvatarFramingPersistenceStatus = "none";

  // A monotonically increasing revision for framing writes. Each valid framing
  // change bumps this; scheduled and in-flight framing saves only commit while
  // their captured revision is still current, so newer framing always wins.
  let framingSaveRevision = 0;
  let framingTimer: LocalGlbAvatarTimeoutHandle | null = null;

  // The durable workspace that SHOULD be in storage for the current committed
  // avatar. It is tracked separately from the parsed asset so a stale async
  // save/clear can be reconciled back to the intended record.
  let persistedWorkspaceRef: LocalAvatarWorkspace | null = null;

  // Assets owned but not yet committed (in-flight parse candidates). Unmount
  // disposes any leftover candidates alongside the active asset. This stays a
  // strong Set because entries are actively owned and removed on commit/retire.
  const pendingCandidates = new Set<Asset>();
  // Exact-once disposal guard. A WeakSet so retired assets are not strongly
  // retained: once GPU resources are released the JS scene graph can be
  // garbage-collected even though we still guard against double disposal.
  const disposedAssets = new WeakSet<Asset>();

  let mutationQueue: Promise<void> = Promise.resolve();

  const retireAsset = (asset: Asset) => {
    if (disposedAssets.has(asset)) return;
    disposedAssets.add(asset);
    pendingCandidates.delete(asset);
    disposeAsset(asset);
  };

  const getState = (): LocalGlbAvatarWorkspaceState<Asset> => ({
    asset: activeAsset,
    pendingFileName,
    lifecycleStatus,
    persistenceStatus,
    framing: { ...framing },
    framingStatus,
    errorMessage,
  });

  const emit = () => {
    if (disposed) return;
    onStateChange(getState());
  };

  const isStale = (operationGeneration: number) =>
    disposed || operationGeneration !== generation;

  // Cancel any scheduled framing write and invalidate in-flight framing saves by
  // bumping the revision. Called whenever a newer operation (selection, clear,
  // reset, restore commit, dispose) supersedes pending framing work.
  const cancelScheduledFramingSave = () => {
    if (framingTimer !== null) {
      cancelTimeout(framingTimer);
      framingTimer = null;
    }
    framingSaveRevision += 1;
  };

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(task);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  // After a queued mutation runs, if a newer operation has superseded it the
  // durable record may now be wrong. Reconcile storage back to the intended
  // durable workspace before the queue advances to later work.
  const reconcile = async (operationGeneration: number) => {
    if (disposed) return;
    if (operationGeneration === generation) return;
    const desired = persistedWorkspaceRef;
    try {
      if (desired === null) {
        await storage.clear();
      } else {
        await storage.save(desired);
      }
    } catch {
      // Best-effort reconciliation; storage errors are non-fatal here.
    }
  };

  const runSave = (
    workspace: LocalAvatarWorkspace,
    operationGeneration: number,
  ) =>
    enqueue(async () => {
      const result = await storage.save(workspace);
      await reconcile(operationGeneration);
      return result;
    });

  const runClear = (operationGeneration: number) =>
    enqueue(async () => {
      const result = await storage.clear();
      await reconcile(operationGeneration);
      return result;
    });

  const settleInvalidPersistedRecord = async (operationGeneration: number) => {
    // Restore-only access never mutates storage: keep the primitive and default
    // framing without clearing another page's durable record.
    if (!isInteractive) {
      if (isStale(operationGeneration)) return;
      activeAsset = null;
      pendingFileName = null;
      lifecycleStatus = "empty";
      persistenceStatus = "invalid";
      framing = createDefaultLocalAvatarFraming();
      framingStatus = "none";
      errorMessage = RESTORE_INVALID_CLEARED_MESSAGE;
      emit();
      return;
    }

    const clearResult = await runClear(operationGeneration);
    if (isStale(operationGeneration)) return;
    activeAsset = null;
    pendingFileName = null;
    lifecycleStatus = "empty";
    framing = createDefaultLocalAvatarFraming();
    framingStatus = "none";
    if (clearResult.status === "cleared") {
      persistedWorkspaceRef = null;
      persistenceStatus = "invalid";
      errorMessage = RESTORE_INVALID_CLEARED_MESSAGE;
    } else {
      persistenceStatus = "clear_failed";
      errorMessage = RESTORE_INVALID_CLEAR_FAILED_MESSAGE;
    }
    emit();
  };

  const start = () => {
    if (disposed) return;
    const operationGeneration = generation;
    activeAsset = null;
    pendingFileName = null;
    lifecycleStatus = "checking";
    persistenceStatus = "none";
    framing = createDefaultLocalAvatarFraming();
    framingStatus = "none";
    errorMessage = null;
    emit();

    void (async () => {
      const loadResult = await storage.load();
      if (isStale(operationGeneration)) return;

      if (loadResult.status === "empty") {
        lifecycleStatus = "empty";
        persistenceStatus = "none";
        errorMessage = null;
        emit();
        return;
      }

      if (loadResult.status === "unavailable") {
        lifecycleStatus = "empty";
        persistenceStatus = "unavailable";
        errorMessage = RESTORE_UNAVAILABLE_MESSAGE;
        emit();
        return;
      }

      if (loadResult.status === "failed") {
        lifecycleStatus = "empty";
        persistenceStatus = "read_failed";
        errorMessage = RESTORE_READ_FAILED_MESSAGE;
        emit();
        return;
      }

      if (loadResult.status === "invalid") {
        await settleInvalidPersistedRecord(operationGeneration);
        return;
      }

      const workspace = loadResult.workspace;
      lifecycleStatus = "restoring";
      pendingFileName = workspace.fileName;
      persistenceStatus = "none";
      // Framing stays at its default while the matching GLB parses; the stored
      // framing is applied only in the single coherent commit below.
      errorMessage = null;
      emit();

      let restoredAsset: Asset;
      try {
        restoredAsset = await parseBytes(
          workspace.fileName,
          workspace.glbBytes,
        );
      } catch {
        if (isStale(operationGeneration)) return;
        // Valid record but unparseable bytes / blocked external resources.
        await settleInvalidPersistedRecord(operationGeneration);
        return;
      }

      if (isStale(operationGeneration)) {
        retireAsset(restoredAsset);
        return;
      }

      // Coherent commit: parsed asset and its validated stored framing together
      // in one emitted state. The storage boundary already rejected corrupt
      // framing, so the stored value is trusted here without re-clamping.
      activeAsset = restoredAsset;
      persistedWorkspaceRef = workspace;
      pendingFileName = null;
      lifecycleStatus = "ready";
      persistenceStatus = "persisted";
      framing = { ...workspace.framing };
      framingStatus = "saved";
      errorMessage = null;
      emit();
    })();
  };

  const failSelectionValidation = (message: string) => {
    // Preserve any current asset and framing; only surface the validation error.
    pendingFileName = null;
    lifecycleStatus = "error";
    errorMessage = message;
    emit();
  };

  const loadFile = async (file: LocalGlbAvatarFileInput) => {
    if (!isInteractive) return;
    generation += 1;
    const operationGeneration = generation;
    // A new selection supersedes any pending framing write for the old avatar.
    cancelScheduledFramingSave();

    if (!hasGlbExtension(file.name)) {
      failSelectionValidation(UNSUPPORTED_FILE_MESSAGE);
      return;
    }
    if (file.size <= 0) {
      failSelectionValidation(EMPTY_FILE_MESSAGE);
      return;
    }
    if (file.size > MAX_LOCAL_AVATAR_GLB_BYTES) {
      failSelectionValidation(OVERSIZE_FILE_MESSAGE);
      return;
    }

    // Keep the current asset and framing rendered while a replacement pends.
    pendingFileName = file.name;
    lifecycleStatus = "loading";
    errorMessage = null;
    emit();

    let glbBytes: ArrayBuffer;
    try {
      glbBytes = await file.arrayBuffer();
    } catch {
      if (isStale(operationGeneration)) return;
      failSelectionValidation(PARSE_FALLBACK_MESSAGE);
      return;
    }
    if (isStale(operationGeneration)) return;

    // Enforce the application limit on the actual returned buffer, not only the
    // reported file.size, before parsing. Preserves the current active avatar
    // and durable record.
    if (glbBytes.byteLength === 0) {
      failSelectionValidation(EMPTY_FILE_MESSAGE);
      return;
    }
    if (glbBytes.byteLength > MAX_LOCAL_AVATAR_GLB_BYTES) {
      failSelectionValidation(OVERSIZE_FILE_MESSAGE);
      return;
    }

    let candidate: Asset;
    try {
      candidate = await parseBytes(file.name, glbBytes);
    } catch (error) {
      if (isStale(operationGeneration)) return;
      failSelectionValidation(
        error instanceof Error && error.message
          ? error.message
          : PARSE_FALLBACK_MESSAGE,
      );
      return;
    }

    if (isStale(operationGeneration)) {
      retireAsset(candidate);
      return;
    }
    pendingCandidates.add(candidate);

    // Persist the candidate GLB with the current in-memory framing so framing is
    // stable across a replacement; framing is captured here at save time.
    const capturedFraming: LocalAvatarFraming = { ...framing };
    const workspace = createLocalAvatarWorkspace({
      fileName: file.name,
      mimeType: normalizeFileMimeType(file.type),
      glbBytes,
      framing: capturedFraming,
    });
    if (workspace === null) {
      retireAsset(candidate);
      if (isStale(operationGeneration)) return;
      failSelectionValidation(PARSE_FALLBACK_MESSAGE);
      return;
    }

    const hadActiveAvatar = activeAsset !== null;
    const hadDurableAvatar = persistedWorkspaceRef !== null;

    const saveResult = await runSave(workspace, operationGeneration);

    if (isStale(operationGeneration)) {
      // A newer operation superseded this one; the queue reconciled the durable
      // record, so only the parsed candidate needs disposal here.
      retireAsset(candidate);
      return;
    }

    if (saveResult.status === "saved") {
      const previous = activeAsset;
      activeAsset = candidate;
      persistedWorkspaceRef = workspace;
      pendingCandidates.delete(candidate);
      if (previous !== null && previous !== candidate) retireAsset(previous);
      pendingFileName = null;
      lifecycleStatus = "ready";
      persistenceStatus = "persisted";
      // The saved workspace holds capturedFraming. If the user changed framing
      // while the save was pending, in-memory framing has moved on: keep the
      // asset durable but honestly schedule the newer framing for this avatar.
      if (framingEquals(framing, workspace.framing)) {
        framingStatus = "saved";
      } else {
        framingStatus = "dirty";
        framingSaveRevision += 1;
        scheduleFramingSave(framingSaveRevision, operationGeneration);
      }
      errorMessage = null;
      emit();
      return;
    }

    const unavailable = saveResult.status === "unavailable";

    if (!hadActiveAvatar && !hadDurableAvatar) {
      // First valid selection with no prior avatar: keep it explicitly unsaved
      // rather than discarding the user's work. No durable record is created,
      // so framing changes stay memory-only and never claim to survive reload.
      activeAsset = candidate;
      persistedWorkspaceRef = null;
      pendingCandidates.delete(candidate);
      pendingFileName = null;
      lifecycleStatus = "ready";
      persistenceStatus = "unsaved";
      framingStatus = "memory_only";
      errorMessage = null;
      emit();
      return;
    }

    // Failed replacement: preserve the active avatar, its framing, and its
    // durable record.
    retireAsset(candidate);
    pendingFileName = null;
    lifecycleStatus = "error";
    persistenceStatus = unavailable ? "unavailable" : "write_failed";
    errorMessage = replacementFailureMessage(file.name, unavailable);
    emit();
  };

  // Build the durable workspace for a framing-only save from the existing
  // durable GLB metadata/bytes plus the captured framing. Parsed Three.js
  // objects are never persisted.
  const buildFramingWorkspace = (
    durable: LocalAvatarWorkspace,
    capturedFraming: LocalAvatarFraming,
  ): LocalAvatarWorkspace | null =>
    createLocalAvatarWorkspace({
      fileName: durable.fileName,
      mimeType: durable.mimeType,
      glbBytes: durable.glbBytes,
      framing: capturedFraming,
    });

  // Serialized framing save. Both the pre-save decision and the durable-
  // reference commit happen inside the queued task, guarded by the operation
  // generation (selection/clear) and the framing revision, so a later queued
  // task never observes an obsolete durable workspace and a stale save can never
  // recreate or overwrite a newer record.
  const runFramingSave = (
    workspace: LocalAvatarWorkspace,
    operationGeneration: number,
    revision: number,
  ) =>
    enqueue(async () => {
      const superseded = () =>
        disposed ||
        operationGeneration !== generation ||
        revision !== framingSaveRevision ||
        persistedWorkspaceRef === null;
      if (superseded()) {
        await reconcile(operationGeneration);
        return { superseded: true as const };
      }
      const result = await storage.save(workspace);
      if (result.status === "saved" && !superseded()) {
        // Commit the durable reference before the queue advances so later
        // queued mutations read the intended record.
        persistedWorkspaceRef = workspace;
        return { superseded: false as const, status: result.status };
      }
      await reconcile(operationGeneration);
      return { superseded: false as const, status: result.status };
    });

  const commitFramingSave = async (
    revision: number,
    operationGeneration: number,
  ) => {
    framingTimer = null;
    if (disposed || !isInteractive) return;
    if (revision !== framingSaveRevision) return;
    if (operationGeneration !== generation) return;
    const durable = persistedWorkspaceRef;
    if (durable === null || activeAsset === null) return;

    const capturedFraming: LocalAvatarFraming = { ...framing };
    const workspace = buildFramingWorkspace(durable, capturedFraming);
    if (workspace === null) return;

    framingStatus = "saving";
    emit();

    const result = await runFramingSave(
      workspace,
      operationGeneration,
      revision,
    );

    if (disposed) return;
    if (revision !== framingSaveRevision) return;
    if (operationGeneration !== generation) return;
    if (result.superseded) return;

    if (result.status === "saved") {
      framingStatus = "saved";
    } else {
      // Retain safe in-memory framing and the last confirmed durable workspace;
      // never claim the failed values will reach OBS/reload.
      framingStatus = "save_failed";
    }
    emit();
  };

  function scheduleFramingSave(revision: number, operationGeneration: number) {
    framingTimer = scheduleTimeout(() => {
      void commitFramingSave(revision, operationGeneration);
    }, LOCAL_AVATAR_FRAMING_SAVE_DEBOUNCE_MS);
  }

  // Apply a validated framing update immediately, then decide persistence. Only
  // a durable avatar under interactive access schedules a trailing write.
  const applyFraming = (validated: LocalAvatarFraming) => {
    framing = validated;
    cancelScheduledFramingSave();
    const revision = framingSaveRevision;

    if (!isInteractive || activeAsset === null) {
      framingStatus = activeAsset === null ? "none" : "memory_only";
      emit();
      return;
    }
    if (persistedWorkspaceRef === null) {
      // Active but unsaved avatar: framing stays memory-only.
      framingStatus = "memory_only";
      emit();
      return;
    }
    framingStatus = "dirty";
    scheduleFramingSave(revision, generation);
    emit();
  };

  const setFraming = (nextFraming: LocalAvatarFraming) => {
    if (disposed || !isInteractive) return;
    const validated = parseLocalAvatarFraming(nextFraming);
    if (validated === null) return;
    applyFraming(validated);
  };

  const resetFraming = () => {
    if (disposed || !isInteractive) return;
    applyFraming(createDefaultLocalAvatarFraming());
  };

  const clearAvatar = async () => {
    if (!isInteractive) return;
    generation += 1;
    const operationGeneration = generation;
    // A clear supersedes any pending framing write; no stale framing save may
    // recreate the record after a successful clear.
    cancelScheduledFramingSave();

    const assetToRetire = activeAsset;
    // Keep the current asset and framing rendered while the durable clear pends.
    lifecycleStatus = "clearing";
    errorMessage = null;
    emit();

    const clearResult = await runClear(operationGeneration);
    if (isStale(operationGeneration)) return;

    if (clearResult.status === "cleared") {
      activeAsset = null;
      persistedWorkspaceRef = null;
      pendingFileName = null;
      lifecycleStatus = "empty";
      persistenceStatus = "none";
      framing = createDefaultLocalAvatarFraming();
      framingStatus = "none";
      errorMessage = null;
      emit();
      if (assetToRetire !== null) retireAsset(assetToRetire);
      return;
    }

    // Clear failed: preserve the active asset, framing, and durable record.
    lifecycleStatus = "error";
    persistenceStatus = "clear_failed";
    errorMessage = CLEAR_FAILED_MESSAGE;
    emit();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    if (framingTimer !== null) {
      cancelTimeout(framingTimer);
      framingTimer = null;
    }
    const owned = new Set<Asset>(pendingCandidates);
    if (activeAsset !== null) owned.add(activeAsset);
    activeAsset = null;
    pendingCandidates.clear();
    for (const asset of owned) retireAsset(asset);
  };

  return {
    getState,
    start,
    loadFile,
    setFraming,
    resetFraming,
    clearAvatar,
    dispose,
  };
};
