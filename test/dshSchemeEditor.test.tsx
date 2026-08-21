/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DshResourceInventory } from "../src/shared/dshResources";
import { DshSchemeEditor } from "../src/renderer/clawd-migrated/components/plugins/DshSchemeEditor";
import { I18nProvider } from "../src/renderer/clawd-migrated/useI18n";

const inventory: DshResourceInventory = {
  skills: [],
  plugins: [{
    id: "plugin:package:ocean-theme",
    kind: "plugin",
    name: "Ocean Theme",
    packageName: "ocean-theme",
    enabled: true,
    manageable: true,
    appearance: { kind: "theme-bundle", components: ["base-theme"], themeId: "ocean.theme", active: false }
  }],
  scannedAt: 1,
  runtimeConnected: true
};

afterEach(cleanup);

function renderEditor(onSave = vi.fn()) {
  render(<I18nProvider initialLocale="zh"><DshSchemeEditor
    initial={{ id: "default", name: "默认", skills: [], plugins: [], pluginComponentOverrides: [] }}
    inventory={inventory}
    knownPluginIds={[]}
    protectedScheme
    canDelete
    busy={false}
    hideSensitiveContent={false}
    onCancel={vi.fn()}
    onSave={onSave}
    onDelete={vi.fn()}
  /></I18nProvider>);
  return onSave;
}

describe("DshSchemeEditor theme picker", () => {
  it("opens the renderer-owned menu and preserves the selected theme on save", () => {
    const onSave = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /默认主题/ }));

    expect(screen.getByRole("listbox", { name: "基础主题" })).not.toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Ocean Theme/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ themeId: "ocean.theme" }));
  });
});
