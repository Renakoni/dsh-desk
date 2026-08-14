// Presentation state machine for the custom tray popup, extracted from the
// Electron wiring so the races it must survive are unit-testable:
//
//  - a cold-start right-click that has to wait for the renderer handshake
//    instead of flashing an empty window;
//  - a dismissal (left-click / click-away / Escape) that must cancel a
//    QUEUED cold-open and an IN-FLIGHT presentation, so a later ready signal
//    or paint signal can never reopen a menu the user already dismissed;
//  - the paint handshake that reveals the window only once it has real
//    pixels (a plain show() after a hide flashes an evicted GPU surface).
//
// index.ts supplies the side effects (position+send, reveal, conceal, timer
// cancels); this module owns only the boolean state and the transitions.

export interface TrayMenuEffects {
  /**
   * Position the window at the cursor, push fresh state to the renderer, and
   * arm the present fallback timer (which must call onPresentSettled). The
   * window is NOT made visible here — that waits for onPresentSettled.
   */
  present: () => void;
  /** Reveal the already-composited window (opacity 1 + show + focus). */
  reveal: () => void;
  /** Alpha-hide the window (opacity 0 + click-through + blur). */
  conceal: () => void;
  /** Cancel the present fallback timer armed by present(). */
  clearPresentFallback: () => void;
  /** Cancel the deferred blur-hide timer. */
  clearBlurHide: () => void;
}

export interface TrayMenuControllerState {
  rendererReady: boolean;
  showPending: boolean;
  presentPending: boolean;
  open: boolean;
}

export interface TrayMenuController {
  /** Tray right-click: open the menu, or queue it if the renderer isn't ready. */
  requestShow: () => void;
  /** The window committed and painted fresh state (renderer signal or the
   *  fallback timer): reveal it. */
  onPresentSettled: () => void;
  /** Dismiss the menu. Cancels any queued or in-flight presentation. */
  dismiss: () => void;
  /** The renderer subscribed and is ready to receive state. */
  notifyRendererReady: () => void;
  /** The renderer started (re)loading; its subscription is invalid until it
   *  handshakes again. */
  notifyReloading: () => void;
  /** The window was destroyed: reset all state. */
  reset: () => void;
  snapshot: () => TrayMenuControllerState;
}

export function createTrayMenuController(effects: TrayMenuEffects): TrayMenuController {
  let rendererReady = false;
  let showPending = false;
  let presentPending = false;
  let open = false;

  function beginPresent() {
    effects.clearBlurHide();
    presentPending = true;
    effects.present();
  }

  return {
    requestShow() {
      if (!rendererReady) {
        // Cold open (or mid-reload): queue until the renderer handshakes, so
        // we never reveal an empty, unsubscribed window.
        showPending = true;
        return;
      }
      beginPresent();
    },
    onPresentSettled() {
      if (!presentPending) return;
      presentPending = false;
      effects.clearPresentFallback();
      open = true;
      effects.reveal();
    },
    dismiss() {
      effects.clearBlurHide();
      // A dismissal always wins. Clearing showPending here (before the
      // open check) is the fix for the cold-open race: a right-click queued
      // while the renderer was still loading, then dismissed by a tray
      // left-click, must NOT reopen when the ready handshake finally lands.
      showPending = false;
      presentPending = false;
      effects.clearPresentFallback();
      if (!open) return;
      open = false;
      effects.conceal();
    },
    notifyRendererReady() {
      rendererReady = true;
      if (showPending) {
        showPending = false;
        beginPresent();
      }
    },
    notifyReloading() {
      rendererReady = false;
    },
    reset() {
      effects.clearBlurHide();
      effects.clearPresentFallback();
      rendererReady = false;
      showPending = false;
      presentPending = false;
      open = false;
    },
    snapshot() {
      return { rendererReady, showPending, presentPending, open };
    }
  };
}
