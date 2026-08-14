/// <reference types="vite/client" />

interface Window {
  petAPI?: {
    onPetEvent: (callback: (event: import("./shared/events").PetEvent) => void) => () => void;
    onSnapshot: (callback: (snapshot: import("./preload").PetSnapshot) => void) => () => void;
    getSnapshot: () => Promise<import("./preload").PetSnapshot>;
    minimizePanel: () => Promise<void>;
    toggleMaximizePanel: () => Promise<void>;
    closePanel: () => Promise<void>;
  };
}
