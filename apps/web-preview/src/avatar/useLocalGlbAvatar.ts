import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createLocalGlbAvatarWorkspaceController,
  type LocalAvatarWorkspaceAccessMode,
  type LocalGlbAvatarLifecycleStatus,
  type LocalGlbAvatarPersistenceStatus,
  type LocalAvatarFramingPersistenceStatus,
  type LocalGlbAvatarWorkspaceController,
  type LocalGlbAvatarWorkspaceState,
} from "./localGlbAvatarWorkspaceController";
import {
  createDefaultLocalAvatarFraming,
  createLocalAvatarWorkspaceStorage,
  type LocalAvatarFraming,
} from "./localAvatarWorkspace";

export type LocalGlbAvatarAsset = {
  fileName: string;
  scene: THREE.Group;
};

export type LocalGlbAvatarController = {
  asset: LocalGlbAvatarAsset | null;
  errorMessage: string | null;
  pendingFileName: string | null;
  lifecycleStatus: LocalGlbAvatarLifecycleStatus;
  persistenceStatus: LocalGlbAvatarPersistenceStatus;
  framing: LocalAvatarFraming;
  framingStatus: LocalAvatarFramingPersistenceStatus;
  loadFile: (file: File) => Promise<void>;
  setFraming: (nextFraming: LocalAvatarFraming) => void;
  resetFraming: () => void;
  clearAvatar: () => Promise<void>;
};

export type UseLocalGlbAvatarOptions = {
  accessMode: LocalAvatarWorkspaceAccessMode;
};

const LOCAL_ONLY_RESOURCE_ERROR =
  "This GLB references external resources, which are blocked in local-only preview.";
const PARSE_ERROR = "Could not read this GLB. Select a valid local .glb file.";

const isAllowedGeneratedResourceUrl = (url: string) => {
  const normalizedUrl = url.trim().toLowerCase();

  return normalizedUrl.startsWith("blob:") || normalizedUrl.startsWith("data:");
};

const createLocalOnlyLoadingManager = () => {
  const loadingManager = new THREE.LoadingManager();

  loadingManager.setURLModifier((url) => {
    if (isAllowedGeneratedResourceUrl(url)) {
      return url;
    }

    throw new Error(LOCAL_ONLY_RESOURCE_ERROR);
  });

  return loadingManager;
};

const disposeTexture = (texture: THREE.Texture) => {
  texture.dispose();
};

const disposeMaterialTextures = (material: THREE.Material) => {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) {
      disposeTexture(value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry instanceof THREE.Texture) {
          disposeTexture(entry);
        }
      }
    }
  }
};

const disposeMaterial = (material: THREE.Material) => {
  disposeMaterialTextures(material);
  material.dispose();
};

const disposeObjectResources = (object: THREE.Object3D) => {
  const maybeMesh = object as THREE.Object3D & {
    geometry?: THREE.BufferGeometry;
    material?: THREE.Material | THREE.Material[];
  };

  maybeMesh.geometry?.dispose();

  if (Array.isArray(maybeMesh.material)) {
    for (const material of maybeMesh.material) {
      disposeMaterial(material);
    }
    return;
  }

  if (maybeMesh.material !== undefined) {
    disposeMaterial(maybeMesh.material);
  }
};

export const disposeLocalGlbAvatarAsset = (asset: LocalGlbAvatarAsset) => {
  asset.scene.traverse(disposeObjectResources);
};

// Single local-only GLB byte parser shared by user-selected files and restored
// IndexedDB bytes. It never fetches remote resources, blocks external resource
// references, does not mutate authored scene transforms, and maps failures to a
// user-safe message so raw Three.js errors are never surfaced.
export async function parseLocalGlbAvatarBytes(
  fileName: string,
  glbBytes: ArrayBuffer,
): Promise<LocalGlbAvatarAsset> {
  const loader = new GLTFLoader(createLocalOnlyLoadingManager());
  try {
    const gltf = await loader.parseAsync(glbBytes, "");
    return { fileName, scene: gltf.scene };
  } catch (error) {
    // Only the sanitized message is ever surfaced to the UI; the original error
    // is retained as `cause` for local debugging and never read for display.
    throw new Error(
      error instanceof Error && error.message === LOCAL_ONLY_RESOURCE_ERROR
        ? LOCAL_ONLY_RESOURCE_ERROR
        : PARSE_ERROR,
      { cause: error },
    );
  }
}

const createInitialControllerState =
  (): LocalGlbAvatarWorkspaceState<LocalGlbAvatarAsset> => ({
    asset: null,
    pendingFileName: null,
    lifecycleStatus: "checking",
    persistenceStatus: "none",
    framing: createDefaultLocalAvatarFraming(),
    framingStatus: "none",
    errorMessage: null,
  });

export function useLocalGlbAvatar({
  accessMode,
}: UseLocalGlbAvatarOptions): LocalGlbAvatarController {
  const [state, setState] = useState<
    LocalGlbAvatarWorkspaceState<LocalGlbAvatarAsset>
  >(createInitialControllerState);
  const controllerRef =
    useRef<LocalGlbAvatarWorkspaceController<LocalGlbAvatarAsset> | null>(null);

  useEffect(() => {
    // Both the standard Preview (interactive) and OBS routes (restore-only)
    // hydrate from the same browser-local workspace. Access mode determines
    // whether the controller may write; restore-only never mutates storage.
    //
    // Create a fresh controller for each Strict Mode setup so the simulated
    // cleanup disposes exactly this controller; the next setup starts a new one.
    // The controller pushes its initial state synchronously through start().
    const controller =
      createLocalGlbAvatarWorkspaceController<LocalGlbAvatarAsset>({
        storage: createLocalAvatarWorkspaceStorage(),
        parseBytes: parseLocalGlbAvatarBytes,
        disposeAsset: disposeLocalGlbAvatarAsset,
        onStateChange: setState,
        accessMode,
        scheduleTimeout: (callback, delayMs) =>
          window.setTimeout(callback, delayMs),
        cancelTimeout: (handle) => {
          window.clearTimeout(handle as number);
        },
      });
    controllerRef.current = controller;
    controller.start();

    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
  }, [accessMode]);

  const loadFile = useCallback(async (file: File) => {
    await controllerRef.current?.loadFile(file);
  }, []);

  const setFraming = useCallback((nextFraming: LocalAvatarFraming) => {
    controllerRef.current?.setFraming(nextFraming);
  }, []);

  const resetFraming = useCallback(() => {
    controllerRef.current?.resetFraming();
  }, []);

  const clearAvatar = useCallback(async () => {
    await controllerRef.current?.clearAvatar();
  }, []);

  return {
    asset: state.asset,
    errorMessage: state.errorMessage,
    pendingFileName: state.pendingFileName,
    lifecycleStatus: state.lifecycleStatus,
    persistenceStatus: state.persistenceStatus,
    framing: state.framing,
    framingStatus: state.framingStatus,
    loadFile,
    setFraming,
    resetFraming,
    clearAvatar,
  };
}
