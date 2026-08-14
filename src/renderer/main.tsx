import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyCompanionAppearance } from "./clawd-migrated/appearance";

const view = new URLSearchParams(window.location.search).get("view");

async function render() {
  const root = createRoot(document.getElementById("root")!);

  if (view === "panel") {
    const initialAppearance = window.companion?.initialState?.settings;
    if (initialAppearance) applyCompanionAppearance(initialAppearance);
    const [{ ClawdSettingsRoot }, { installClawdCompat }] = await Promise.all([
      import("./clawd-migrated/main"),
      import("./clawdCompat")
    ]);
    installClawdCompat();
    const fallbackAppearance = window.companion?.initialState?.settings;
    if (!initialAppearance && fallbackAppearance) applyCompanionAppearance(fallbackAppearance);
    root.render(<ClawdSettingsRoot />);
    return;
  }

  if (view === "traymenu") {
    await import("./trayMenu.css");
    const { default: TrayMenuApp } = await import("./TrayMenuApp");
    root.render(
      <StrictMode>
        <TrayMenuApp />
      </StrictMode>
    );
    return;
  }

  await import("./styles.css");
  const { default: App } = await import("./App");
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void render();
