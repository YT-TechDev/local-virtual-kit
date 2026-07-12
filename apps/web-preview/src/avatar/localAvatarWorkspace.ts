export const DEFAULT_LOCAL_AVATAR_SCALE = 1;
export const MIN_LOCAL_AVATAR_SCALE = 0.25;
export const MAX_LOCAL_AVATAR_SCALE = 3;
export const LOCAL_AVATAR_SCALE_STEP = 0.05;
export const DEFAULT_LOCAL_AVATAR_VERTICAL_OFFSET = 0;
export const MIN_LOCAL_AVATAR_VERTICAL_OFFSET = -2;
export const MAX_LOCAL_AVATAR_VERTICAL_OFFSET = 2;
export const LOCAL_AVATAR_VERTICAL_OFFSET_STEP = 0.05;
export const DEFAULT_LOCAL_AVATAR_YAW_DEGREES = 0;
export const MIN_LOCAL_AVATAR_YAW_DEGREES = -180;
export const MAX_LOCAL_AVATAR_YAW_DEGREES = 180;
export const LOCAL_AVATAR_YAW_STEP_DEGREES = 1;

export const LOCAL_AVATAR_WORKSPACE_SCHEMA_VERSION = 1;
export const LOCAL_AVATAR_WORKSPACE_DATABASE_NAME = "lvk-web-preview";
export const LOCAL_AVATAR_WORKSPACE_DATABASE_VERSION = 1;
export const LOCAL_AVATAR_WORKSPACE_STORE_NAME = "local-avatar-workspace";
export const LOCAL_AVATAR_WORKSPACE_ACTIVE_KEY = "active";
export const MAX_LOCAL_AVATAR_GLB_BYTES = 50 * 1024 * 1024;

const MAX_LOCAL_AVATAR_FILE_NAME_LENGTH = 255;

export type LocalAvatarFraming = {
  uniformScale: number;
  verticalOffset: number;
  yawDegrees: number;
};

export type LocalAvatarWorkspace = {
  version: 1;
  fileName: string;
  mimeType: "model/gltf-binary" | "application/octet-stream" | null;
  byteLength: number;
  glbBytes: ArrayBuffer;
  framing: LocalAvatarFraming;
};

export type LocalAvatarWorkspaceLoadResult =
  | { status: "empty" }
  | { status: "ready"; workspace: LocalAvatarWorkspace }
  | { status: "invalid" }
  | { status: "unavailable" }
  | { status: "failed" };

export type LocalAvatarWorkspaceSaveResult =
  | { status: "saved" }
  | { status: "invalid" }
  | { status: "unavailable" }
  | { status: "failed" };

export type LocalAvatarWorkspaceClearResult =
  | { status: "cleared" }
  | { status: "unavailable" }
  | { status: "failed" };

export interface LocalAvatarWorkspaceStorage {
  load(): Promise<LocalAvatarWorkspaceLoadResult>;
  save(
    workspace: LocalAvatarWorkspace,
  ): Promise<LocalAvatarWorkspaceSaveResult>;
  clear(): Promise<LocalAvatarWorkspaceClearResult>;
}

export interface LocalAvatarWorkspaceRecordStore {
  read(): Promise<unknown | undefined>;
  write(value: LocalAvatarWorkspace): Promise<void>;
  delete(): Promise<void>;
  close(): void;
}

export type OpenLocalAvatarWorkspaceRecordStore =
  () => Promise<LocalAvatarWorkspaceRecordStore>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteInRange = (
  value: unknown,
  min: number,
  max: number,
): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

export const createDefaultLocalAvatarFraming = (): LocalAvatarFraming => ({
  uniformScale: DEFAULT_LOCAL_AVATAR_SCALE,
  verticalOffset: DEFAULT_LOCAL_AVATAR_VERTICAL_OFFSET,
  yawDegrees: DEFAULT_LOCAL_AVATAR_YAW_DEGREES,
});

export const parseLocalAvatarFraming = (
  value: unknown,
): LocalAvatarFraming | null => {
  if (!isRecord(value)) return null;
  const { uniformScale, verticalOffset, yawDegrees } = value;
  if (
    !isFiniteInRange(
      uniformScale,
      MIN_LOCAL_AVATAR_SCALE,
      MAX_LOCAL_AVATAR_SCALE,
    )
  )
    return null;
  if (
    !isFiniteInRange(
      verticalOffset,
      MIN_LOCAL_AVATAR_VERTICAL_OFFSET,
      MAX_LOCAL_AVATAR_VERTICAL_OFFSET,
    )
  )
    return null;
  if (
    !isFiniteInRange(
      yawDegrees,
      MIN_LOCAL_AVATAR_YAW_DEGREES,
      MAX_LOCAL_AVATAR_YAW_DEGREES,
    )
  )
    return null;
  return { uniformScale, verticalOffset, yawDegrees };
};

export const sanitizeLocalAvatarFileName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_LOCAL_AVATAR_FILE_NAME_LENGTH
  )
    return null;
  if (/\p{Cc}/u.test(trimmed)) return null;
  const segments = trimmed.split(/[\\/]+/u);
  const baseName = segments.at(-1) ?? "";
  if (
    baseName.length === 0 ||
    baseName.length > MAX_LOCAL_AVATAR_FILE_NAME_LENGTH
  )
    return null;
  if (baseName.toLowerCase() === ".glb") return null;
  if (!baseName.toLowerCase().endsWith(".glb")) return null;
  if (baseName.includes("/") || baseName.includes("\\")) return null;
  return baseName;
};

const normalizeLocalAvatarMimeType = (
  value: unknown,
): LocalAvatarWorkspace["mimeType"] | undefined => {
  if (value === null) return null;
  if (value === "model/gltf-binary" || value === "application/octet-stream")
    return value;
  return undefined;
};

const cloneArrayBuffer = (value: ArrayBuffer) => value.slice(0);

export const createLocalAvatarWorkspace = (input: {
  fileName: unknown;
  mimeType: unknown;
  glbBytes: unknown;
  framing: unknown;
}): LocalAvatarWorkspace | null => {
  const fileName = sanitizeLocalAvatarFileName(input.fileName);
  const mimeType = normalizeLocalAvatarMimeType(input.mimeType);
  const framing = parseLocalAvatarFraming(input.framing);
  if (fileName === null || mimeType === undefined || framing === null)
    return null;
  if (!(input.glbBytes instanceof ArrayBuffer)) return null;
  const byteLength = input.glbBytes.byteLength;
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > MAX_LOCAL_AVATAR_GLB_BYTES
  )
    return null;
  return {
    version: LOCAL_AVATAR_WORKSPACE_SCHEMA_VERSION,
    fileName,
    mimeType,
    byteLength,
    glbBytes: cloneArrayBuffer(input.glbBytes),
    framing,
  };
};

export const parsePersistedLocalAvatarWorkspace = (
  value: unknown,
): LocalAvatarWorkspace | null => {
  if (
    !isRecord(value) ||
    value.version !== LOCAL_AVATAR_WORKSPACE_SCHEMA_VERSION
  )
    return null;
  const workspace = createLocalAvatarWorkspace({
    fileName: value.fileName,
    mimeType: value.mimeType,
    glbBytes: value.glbBytes,
    framing: value.framing,
  });
  if (workspace === null || value.byteLength !== workspace.byteLength)
    return null;
  return workspace;
};

export const cloneLocalAvatarWorkspace = (
  workspace: LocalAvatarWorkspace,
): LocalAvatarWorkspace => ({
  version: LOCAL_AVATAR_WORKSPACE_SCHEMA_VERSION,
  fileName: workspace.fileName,
  mimeType: workspace.mimeType,
  byteLength: workspace.byteLength,
  glbBytes: cloneArrayBuffer(workspace.glbBytes),
  framing: { ...workspace.framing },
});

const isIndexedDBUnavailableError = (error: unknown) =>
  error instanceof Error &&
  error.name === "LocalAvatarWorkspaceIndexedDBUnavailable";

const createUnavailableError = () =>
  new DOMException(
    "IndexedDB unavailable",
    "LocalAvatarWorkspaceIndexedDBUnavailable",
  );

const waitForRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("IndexedDB request failed"));
  });

const waitForTransaction = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(new Error("IndexedDB transaction aborted"));
  });

export const openIndexedDBLocalAvatarWorkspaceRecordStore: OpenLocalAvatarWorkspaceRecordStore =
  async () => {
    const indexedDBFactory = globalThis.indexedDB;
    if (indexedDBFactory === undefined) throw createUnavailableError();

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      let abandoned = false;
      const rejectUnavailable = () => {
        if (settled) return;
        settled = true;
        abandoned = true;
        reject(createUnavailableError());
      };
      const request = indexedDBFactory.open(
        LOCAL_AVATAR_WORKSPACE_DATABASE_NAME,
        LOCAL_AVATAR_WORKSPACE_DATABASE_VERSION,
      );
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(LOCAL_AVATAR_WORKSPACE_STORE_NAME)) {
          db.createObjectStore(LOCAL_AVATAR_WORKSPACE_STORE_NAME);
        }
      };
      request.onsuccess = () => {
        const openedDatabase = request.result;
        if (abandoned || settled) {
          openedDatabase.close();
          return;
        }
        settled = true;
        resolve(openedDatabase);
      };
      request.onerror = rejectUnavailable;
      request.onblocked = rejectUnavailable;
    });

    return {
      async read() {
        const transaction = database.transaction(
          LOCAL_AVATAR_WORKSPACE_STORE_NAME,
          "readonly",
        );
        const store = transaction.objectStore(
          LOCAL_AVATAR_WORKSPACE_STORE_NAME,
        );
        const requestResult = await waitForRequest(
          store.get(LOCAL_AVATAR_WORKSPACE_ACTIVE_KEY),
        );
        await waitForTransaction(transaction);
        return requestResult;
      },
      async write(value) {
        const transaction = database.transaction(
          LOCAL_AVATAR_WORKSPACE_STORE_NAME,
          "readwrite",
        );
        const store = transaction.objectStore(
          LOCAL_AVATAR_WORKSPACE_STORE_NAME,
        );
        store.put(
          cloneLocalAvatarWorkspace(value),
          LOCAL_AVATAR_WORKSPACE_ACTIVE_KEY,
        );
        await waitForTransaction(transaction);
      },
      async delete() {
        const transaction = database.transaction(
          LOCAL_AVATAR_WORKSPACE_STORE_NAME,
          "readwrite",
        );
        const store = transaction.objectStore(
          LOCAL_AVATAR_WORKSPACE_STORE_NAME,
        );
        store.delete(LOCAL_AVATAR_WORKSPACE_ACTIVE_KEY);
        await waitForTransaction(transaction);
      },
      close() {
        database.close();
      },
    };
  };

export const createLocalAvatarWorkspaceStorage = (
  openStore: OpenLocalAvatarWorkspaceRecordStore = openIndexedDBLocalAvatarWorkspaceRecordStore,
): LocalAvatarWorkspaceStorage => ({
  async load() {
    let store: LocalAvatarWorkspaceRecordStore | null = null;
    try {
      store = await openStore();
      const record = await store.read();
      if (record === undefined) return { status: "empty" };
      const workspace = parsePersistedLocalAvatarWorkspace(record);
      if (workspace === null) return { status: "invalid" };
      return {
        status: "ready",
        workspace: cloneLocalAvatarWorkspace(workspace),
      };
    } catch (error) {
      return {
        status:
          store === null || isIndexedDBUnavailableError(error)
            ? "unavailable"
            : "failed",
      };
    } finally {
      store?.close();
    }
  },
  async save(workspace) {
    const normalized = parsePersistedLocalAvatarWorkspace(workspace);
    if (normalized === null) return { status: "invalid" };
    let store: LocalAvatarWorkspaceRecordStore | null = null;
    try {
      store = await openStore();
      await store.write(normalized);
      return { status: "saved" };
    } catch (error) {
      return {
        status:
          store === null || isIndexedDBUnavailableError(error)
            ? "unavailable"
            : "failed",
      };
    } finally {
      store?.close();
    }
  },
  async clear() {
    let store: LocalAvatarWorkspaceRecordStore | null = null;
    try {
      store = await openStore();
      await store.delete();
      return { status: "cleared" };
    } catch (error) {
      return {
        status:
          store === null || isIndexedDBUnavailableError(error)
            ? "unavailable"
            : "failed",
      };
    } finally {
      store?.close();
    }
  },
});
