import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createLocalGlbAvatarWorkspaceController,
  type LocalGlbAvatarLifecycleStatus,
  type LocalGlbAvatarPersistenceStatus,
  type LocalGlbAvatarWorkspaceController,
  type LocalGlbAvatarWorkspaceState,
} from "./localGlbAvatarWorkspaceController";
import { createLocalAvatarWorkspaceStorage } from "./localAvatarWorkspace";

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
  loadFile: (file: File) => Promise<void>;
  clearAvatar: () => Promise<void>;
};

export type UseLocalGlbAvatarOptions = {
  workspaceEnabled: boolean;
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
    errorMessage: null,
  });

const DISABLED_CONTROLLER_STATE: LocalGlbAvatarWorkspaceState<LocalGlbAvatarAsset> =
  {
    asset: null,
    pendingFileName: null,
    lifecycleStatus: "empty",
    persistenceStatus: "none",
    errorMessage: null,
  };

export function useLocalGlbAvatar({
  workspaceEnabled,
}: UseLocalGlbAvatarOptions): LocalGlbAvatarController {
  const [state, setState] = useState<
    LocalGlbAvatarWorkspaceState<LocalGlbAvatarAsset>
  >(createInitialControllerState);
  const controllerRef =
    useRef<LocalGlbAvatarWorkspaceController<LocalGlbAvatarAsset> | null>(null);

  useEffect(() => {
    // Persistence is scoped to the standard non-OBS Preview. OBS routes keep the
    // built-in primitive and never touch browser-local storage for this issue.
    if (!workspaceEnabled) {
      controllerRef.current = null;
      return undefined;
    }

    // Create a fresh controller for each Strict Mode setup so the simulated
    // cleanup disposes exactly this controller; the next setup starts a new one.
    // The controller pushes its initial state synchronously through start().
    const controller =
      createLocalGlbAvatarWorkspaceController<LocalGlbAvatarAsset>({
        storage: createLocalAvatarWorkspaceStorage(),
        parseBytes: parseLocalGlbAvatarBytes,
        disposeAsset: disposeLocalGlbAvatarAsset,
        onStateChange: setState,
      });
    controllerRef.current = controller;
    controller.start();

    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
  }, [workspaceEnabled]);

  const loadFile = useCallback(async (file: File) => {
    await controllerRef.current?.loadFile(file);
  }, []);

  const clearAvatar = useCallback(async () => {
    await controllerRef.current?.clearAvatar();
  }, []);

  // When the workspace is disabled (OBS), ignore any controller state and keep
  // the built-in primitive without a synchronous in-effect state update.
  const effectiveState = workspaceEnabled ? state : DISABLED_CONTROLLER_STATE;

  return {
    asset: effectiveState.asset,
    errorMessage: effectiveState.errorMessage,
    pendingFileName: effectiveState.pendingFileName,
    lifecycleStatus: effectiveState.lifecycleStatus,
    persistenceStatus: effectiveState.persistenceStatus,
    loadFile,
    clearAvatar,
  };
}
