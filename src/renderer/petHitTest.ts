/**
 * True if `element` is the pet or lives inside it. Used to hit-test a native
 * double-click point (resolved with document.elementFromPoint) so the panel opens
 * only for the pet — never the status/notification bubble, the permission card,
 * Allow/Deny buttons, or the transparent background, which all sit outside `.pet`.
 * Because it tests the rendered `.pet` element, the boundary follows the actual pet
 * at any scale or imported-sprite height.
 */
export function isPetElement(element: Element | null): boolean {
  return Boolean(element?.closest(".pet"));
}
