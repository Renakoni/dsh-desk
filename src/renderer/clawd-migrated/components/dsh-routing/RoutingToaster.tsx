import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Toaster } from "sonner";

function readTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/**
 * Sonner toaster configured like cc-switch's (position top-center,
 * richColors, 2s default), with the theme following the app's
 * data-theme attribute. Portaled to <body> so ancestors with
 * backdrop-filter/transform cannot trap its fixed positioning.
 *
 * The top offset clears the frameless window's 52px titlebar: that strip is
 * a -webkit-app-region drag region, and Electron's drag hit-testing eats
 * clicks before the DOM sees them — sonner's default 32px offset put the
 * toast's close button (which overhangs the top-left corner) inside it.
 * 90-routing.css additionally carves the toast surface out of the drag
 * region as the structural guarantee.
 */
export const ROUTING_TOASTER_TOP_OFFSET_PX = 64;

export function RoutingToaster() {
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return createPortal(
    <Toaster
      position="top-center"
      offset={{ top: ROUTING_TOASTER_TOP_OFFSET_PX }}
      richColors
      theme={theme}
      toastOptions={{ duration: 2000 }}
    />,
    document.body
  );
}
