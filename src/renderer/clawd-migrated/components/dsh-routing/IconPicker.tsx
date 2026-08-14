import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "../../useI18n";
import { iconList } from "./icons";
import { getIconMetadata, searchIcons } from "./icons/metadata";
import { ProviderIcon } from "./ProviderIcon";

/**
 * Fullscreen icon picker ported from cc-switch: back button + title header,
 * keyword search, icon grid with display names, Done button at the end.
 */
export function IconPicker({
  value,
  onSelect,
  onClose
}: {
  value?: string;
  onSelect: (icon: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const filteredIcons = useMemo(() => (query.trim() ? searchIcons(query.trim()) : iconList), [query]);

  return createPortal(
    <div className="ccs-fullscreen-panel ccs-icon-picker-panel">
      <header className="ccs-fullscreen-header">
        <button className="ccs-back-button" type="button" onClick={onClose} aria-label={t("common.back", "返回")} title={t("common.back", "返回")}><ArrowLeft size={18} /></button>
        <div className="ccs-fullscreen-title">
          <h2>{t("routing.iconPickerTitle", "选择图标")}</h2>
        </div>
      </header>
      <main className="ccs-fullscreen-body">
        <div className="ccs-icon-picker-content">
          <label className="ccs-icon-picker-search">
            <span>{t("routing.iconPickerSearchLabel", "搜索图标")}</span>
            <input
              autoFocus
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t("routing.iconPickerSearch", "输入图标名称…")}
            />
          </label>
          <div className="ccs-icon-picker-grid">
            {filteredIcons.map(iconName => {
              const meta = getIconMetadata(iconName);
              return (
                <button
                  key={iconName}
                  type="button"
                  className={`ccs-icon-picker-item ${value === iconName ? "active" : ""}`}
                  title={meta?.displayName || iconName}
                  onClick={() => onSelect(iconName)}
                >
                  <ProviderIcon icon={iconName} name={meta?.displayName || iconName} size={32} />
                  <span>{meta?.displayName || iconName}</span>
                </button>
              );
            })}
          </div>
          {filteredIcons.length === 0 ? (
            <div className="ccs-icon-picker-empty">{t("routing.iconPickerNoResults", "未找到匹配的图标")}</div>
          ) : null}
        </div>
      </main>
      <footer className="ccs-fullscreen-footer">
        <button className="ccs-panel-cancel" type="button" onClick={onClose}>{t("common.done", "完成")}</button>
      </footer>
    </div>,
    document.body
  );
}
