// @ts-nocheck
import { useEffect } from "react";
import type { CustomPlugin } from "../../shared/events";

export function PluginSpriteLoader({ plugins }: { plugins: CustomPlugin[] }) {
  useEffect(() => {
    const head = document.head;
    head.querySelectorAll('link[data-plugin-sprites="true"]').forEach(el => el.remove());
    for (const p of plugins) {
      if (p.enabled && p.trusted && p.resolvedAssets?.spritesCss) {
        const href = `file:///${p.resolvedAssets.spritesCss.replace(/\\/g, "/")}`;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.pluginSprites = "true";
        link.dataset.pluginId = p.id;
        head.appendChild(link);
      }
    }
  }, [plugins]);

  return null;
}

