import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Small confirm dialog matching cc-switch's ConfirmDialog usage:
 * delete confirmation and soft-validation "save anyway" prompts.
 * Portaled to <body> so transformed/filtered ancestors cannot trap it.
 *
 * It gates destructive deletes, so it behaves as a proper modal: Esc cancels,
 * Tab is trapped within it, focus lands on the safe (Cancel) action on open, and
 * returns to whatever opened it on close. The dialog is mounted only while open,
 * so all of this lives in a single mount/unmount effect.
 */
export function ConfirmDialog({
  title,
  children,
  cancelLabel,
  confirmLabel,
  danger,
  onCancel,
  onConfirm
}: {
  title: string;
  children: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // Keep the latest onCancel so the key handler never goes stale without
  // re-running (and re-binding) the mount effect.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    // Remember whoever opened us so focus can return there on close; a keyboard
    // user whose focus is inside the dialog would otherwise be dropped on <body>.
    openerRef.current = document.activeElement as HTMLElement | null;
    // Land on the safe action: Esc/Tab now act on the dialog, and a stray Enter
    // cancels rather than confirming a destructive delete.
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation(); // don't also close an ancestor panel
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Trap Tab inside the dialog: wrap at the ends and pull stray focus back in.
      if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // The dialog is already unmounted by the time this passive cleanup runs, so
      // restoring focus synchronously is safe (no inert-panel race to fight).
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && typeof opener.focus === "function") opener.focus();
    };
  }, []);

  return createPortal(
    <div className="ccs-confirm-backdrop" role="presentation" onClick={onCancel}>
      <div ref={dialogRef} className="ccs-confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
        <h3>{title}</h3>
        <div className="ccs-confirm-body">{children}</div>
        <footer>
          <button ref={cancelRef} type="button" className="ccs-panel-cancel" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={danger ? "ccs-confirm-danger" : "ccs-save-button"} onClick={onConfirm}>{confirmLabel}</button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
