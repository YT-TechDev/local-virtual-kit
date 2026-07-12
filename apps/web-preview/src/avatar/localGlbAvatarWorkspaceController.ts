import {
  MAX_LOCAL_AVATAR_GLB_BYTES,
  createDefaultLocalAvatarFraming,
  createLocalAvatarWorkspace,
  type LocalAvatarWorkspace,
  type LocalAvatarWorkspaceStorage,
} from "./localAvatarWorkspace";

// Lifecycle of the standard (non-OBS) Web Preview local avatar workspace. The
// controller stays framework-independent so lifecycle ordering can be exercised
// without mounting React or opening real browser IndexedDB. React ownership,
// Three.js parsing, and IndexedDB adapters are injected.

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

export type LocalGlbAvatarWorkspaceState<Asset> = {
  asset: Asset | null;
  pendingFileName: string | null;
  lifecycleStatus: LocalGlbAvatarLifecycleStatus;
  persistenceStatus: LocalGlbAvatarPersistenceStatus;
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

export type LocalGlbAvatarWorkspaceControllerOptions<Asset extends object> = {
  storage: LocalAvatarWorkspaceStorage;
  parseBytes: ParseLocalGlbAvatarBytes<Asset>;
  disposeAsset: (asset: Asset) => void;
  onStateChange: (state: LocalGlbAvatarWorkspaceState<Asset>) => void;
};

export type LocalGlbAvatarWorkspaceController<Asset extends object> = {
  getState: () => LocalGlbAvatarWorkspaceState<Asset>;
  start: () => void;
  loadFile: (file: LocalGlbAvatarFileInput) => Promise<void>;
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
  const { storage, parseBytes, disposeAsset, onStateChange } = options;

  // Every distinct operation (restore start, selection, clear, dispose) claims a
  // new generation. Async results check their captured generation before
  // committing so stale restores/selections/clears cannot mutate live state.
  let generation = 0;
  let disposed = false;

  let activeAsset: Asset | null = null;
  let pendingFileName: string | null = null;
  let lifecycleStatus: LocalGlbAvatarLifecycleStatus = "checking";
  let persistenceStatus: LocalGlbAvatarPersistenceStatus = "none";
  let errorMessage: string | null = null;

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
    errorMessage,
  });

  const emit = () => {
    if (disposed) return;
    onStateChange(getState());
  };

  const isStale = (operationGeneration: number) =>
    disposed || operationGeneration !== generation;

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
    const clearResult = await runClear(operationGeneration);
    if (isStale(operationGeneration)) return;
    activeAsset = null;
    pendingFileName = null;
    lifecycleStatus = "empty";
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

      activeAsset = restoredAsset;
      persistedWorkspaceRef = workspace;
      pendingFileName = null;
      lifecycleStatus = "ready";
      persistenceStatus = "persisted";
      errorMessage = null;
      emit();
    })();
  };

  const failSelectionValidation = (message: string) => {
    // Preserve any current asset; only surface the validation error.
    pendingFileName = null;
    lifecycleStatus = "error";
    errorMessage = message;
    emit();
  };

  const loadFile = async (file: LocalGlbAvatarFileInput) => {
    generation += 1;
    const operationGeneration = generation;

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

    // Keep the current asset rendered while a replacement is pending.
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

    const workspace = createLocalAvatarWorkspace({
      fileName: file.name,
      mimeType: normalizeFileMimeType(file.type),
      glbBytes,
      framing: createDefaultLocalAvatarFraming(),
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
      errorMessage = null;
      emit();
      return;
    }

    const unavailable = saveResult.status === "unavailable";

    if (!hadActiveAvatar && !hadDurableAvatar) {
      // First valid selection with no prior avatar: keep it explicitly unsaved
      // rather than discarding the user's work. No durable record is created.
      activeAsset = candidate;
      persistedWorkspaceRef = null;
      pendingCandidates.delete(candidate);
      pendingFileName = null;
      lifecycleStatus = "ready";
      persistenceStatus = "unsaved";
      errorMessage = null;
      emit();
      return;
    }

    // Failed replacement: preserve the active avatar and its durable record.
    retireAsset(candidate);
    pendingFileName = null;
    lifecycleStatus = "error";
    persistenceStatus = unavailable ? "unavailable" : "write_failed";
    errorMessage = replacementFailureMessage(file.name, unavailable);
    emit();
  };

  const clearAvatar = async () => {
    generation += 1;
    const operationGeneration = generation;

    const assetToRetire = activeAsset;
    // Keep the current asset rendered while the durable clear is pending.
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
      errorMessage = null;
      emit();
      if (assetToRetire !== null) retireAsset(assetToRetire);
      return;
    }

    // Clear failed: preserve the active asset and durable record.
    lifecycleStatus = "error";
    persistenceStatus = "clear_failed";
    errorMessage = CLEAR_FAILED_MESSAGE;
    emit();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    const owned = new Set<Asset>(pendingCandidates);
    if (activeAsset !== null) owned.add(activeAsset);
    activeAsset = null;
    pendingCandidates.clear();
    for (const asset of owned) retireAsset(asset);
  };

  return { getState, start, loadFile, clearAvatar, dispose };
};
