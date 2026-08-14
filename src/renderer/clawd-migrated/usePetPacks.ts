import { useCallback, useEffect, useState } from "react";
import type { PetPackManifest } from "../../shared/petPack";

/**
 * Installed pet packs for the settings panel: loaded on mount, refreshed on
 * demand (after an install/remove initiated here) and whenever the main
 * process broadcasts a pack-store change.
 */
export function usePetPacks() {
  const [petPacks, setPetPacks] = useState<PetPackManifest[]>(() => window.companion.initialState?.petPacks ?? []);

  const refreshPetPacks = useCallback(() => {
    void window.companion.listPetPacks()
      .then(packs => setPetPacks(Array.isArray(packs) ? packs : []))
      .catch(() => setPetPacks([]));
  }, []);

  useEffect(() => {
    refreshPetPacks();
    const unsubscribe = window.companion.onPetPacksChanged?.(refreshPetPacks);
    return () => unsubscribe?.();
  }, [refreshPetPacks]);

  return { petPacks, refreshPetPacks };
}
