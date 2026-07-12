import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type LocalGlbAvatarAsset = {
  fileName: string;
  scene: THREE.Group;
};

export type LocalGlbAvatarLoadStatus = "idle" | "loading" | "ready" | "error";

export type LocalGlbAvatarController = {
  asset: LocalGlbAvatarAsset | null;
  errorMessage: string | null;
  pendingFileName: string | null;
  status: LocalGlbAvatarLoadStatus;
  loadFile: (file: File) => Promise<void>;
  reset: () => void;
};

const UNSUPPORTED_FILE_ERROR = "Select a single local .glb file.";
const LOCAL_ONLY_RESOURCE_ERROR =
  "This GLB references external resources, which are blocked in local-only preview.";
const PARSE_ERROR = "Could not read this GLB. Select a valid local .glb file.";

const hasGlbExtension = (fileName: string) =>
  fileName.toLowerCase().endsWith(".glb");

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

export function useLocalGlbAvatar(): LocalGlbAvatarController {
  const [asset, setAsset] = useState<LocalGlbAvatarAsset | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<LocalGlbAvatarLoadStatus>("idle");
  const assetRef = useRef<LocalGlbAvatarAsset | null>(null);
  const requestGenerationRef = useRef(0);

  const replaceAsset = useCallback((nextAsset: LocalGlbAvatarAsset | null) => {
    const previousAsset = assetRef.current;
    assetRef.current = nextAsset;
    setAsset(nextAsset);

    if (previousAsset !== null) {
      disposeLocalGlbAvatarAsset(previousAsset);
    }
  }, []);

  const reset = useCallback(() => {
    requestGenerationRef.current += 1;
    replaceAsset(null);
    setErrorMessage(null);
    setPendingFileName(null);
    setStatus("idle");
  }, [replaceAsset]);

  const loadFile = useCallback(
    async (file: File) => {
      if (!hasGlbExtension(file.name)) {
        setErrorMessage(UNSUPPORTED_FILE_ERROR);
        setPendingFileName(null);
        setStatus("error");
        return;
      }

      const requestGeneration = requestGenerationRef.current + 1;
      requestGenerationRef.current = requestGeneration;
      setErrorMessage(null);
      setPendingFileName(file.name);
      setStatus("loading");

      try {
        const fileBytes = await file.arrayBuffer();
        const loader = new GLTFLoader(createLocalOnlyLoadingManager());
        const gltf = await loader.parseAsync(fileBytes, "");
        const nextAsset = { fileName: file.name, scene: gltf.scene };

        if (requestGenerationRef.current !== requestGeneration) {
          disposeLocalGlbAvatarAsset(nextAsset);
          return;
        }

        replaceAsset(nextAsset);
        setErrorMessage(null);
        setPendingFileName(null);
        setStatus("ready");
      } catch (error) {
        if (requestGenerationRef.current !== requestGeneration) {
          return;
        }

        setErrorMessage(
          error instanceof Error && error.message === LOCAL_ONLY_RESOURCE_ERROR
            ? LOCAL_ONLY_RESOURCE_ERROR
            : PARSE_ERROR,
        );
        setPendingFileName(null);
        setStatus("error");
      }
    },
    [replaceAsset],
  );

  useEffect(() => {
    return () => {
      requestGenerationRef.current += 1;
      if (assetRef.current !== null) {
        disposeLocalGlbAvatarAsset(assetRef.current);
        assetRef.current = null;
      }
    };
  }, []);

  return {
    asset,
    errorMessage,
    pendingFileName,
    status,
    loadFile,
    reset,
  };
}
