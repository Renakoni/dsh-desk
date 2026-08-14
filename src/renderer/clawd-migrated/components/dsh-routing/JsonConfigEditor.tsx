import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";

/**
 * CodeMirror-based JSON editor, mirroring cc-switch's settingsConfig editor.
 * Controlled component: external `value` changes replace the document unless
 * the editor itself produced them.
 *
 * Syntax theme follows the app's data-theme: the default (light) highlight
 * suits the light panel, and oneDark is layered in for dark mode — otherwise
 * CodeMirror's light-tuned token colors render garishly on the dark surface.
 * The theme lives in a Compartment so a data-theme flip reconfigures it in
 * place: the EditorState (cursor, selection, scroll, undo history) survives,
 * instead of the whole view being rebuilt mid-edit.
 */
function readDarkTheme(): boolean {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

/** oneDark for dark mode, nothing for light (the default highlight suits it). */
function themeExtension(dark: boolean) {
  return dark ? oneDark : [];
}

export function JsonConfigEditor({
  value,
  onChange,
  ariaLabel
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const lastEmittedRef = useRef(value);
  onChangeRef.current = onChange;
  valueRef.current = value;

  // Build the editor exactly once. The theme is a compartment (reconfigured
  // below); `value` sync is a separate effect — neither rebuilds the view.
  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          basicSetup,
          json(),
          EditorView.lineWrapping,
          themeCompartmentRef.current.of(themeExtension(readDarkTheme())),
          // Forced after the theme compartment so oneDark's near-black
          // background is overridden — the editor sits on the panel's
          // --ccs-editor-raised surface in both themes.
          EditorView.theme({
            "&": { backgroundColor: "transparent" },
            ".cm-scroller": { backgroundColor: "transparent" }
          }),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return;
            const text = update.state.doc.toString();
            lastEmittedRef.current = text;
            onChangeRef.current(text);
          })
        ]
      })
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Reconfigure only the theme compartment when data-theme flips — dispatched
  // onto the live view, so an in-progress edit keeps its cursor, selection,
  // scroll position, and undo history.
  useEffect(() => {
    const applyTheme = () => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: themeCompartmentRef.current.reconfigure(themeExtension(readDarkTheme())) });
    };
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value === lastEmittedRef.current) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    lastEmittedRef.current = value;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div className="ccs-json-editor" ref={containerRef} role="textbox" aria-label={ariaLabel} />;
}
