import { useState } from "react";
import { useI18n } from "../../useI18n";
import { ConfirmDialog } from "../dsh-routing/ConfirmDialog";

export const REQUIRED_COMPONENT_WARNING_DISMISSED_KEY = "dsh-desk.required-component-warning-dismissed";

export function shouldWarnRequiredComponent(): boolean {
  try {
    return localStorage.getItem(REQUIRED_COMPONENT_WARNING_DISMISSED_KEY) !== "1";
  } catch {
    return true;
  }
}

function dismissRequiredComponentWarning() {
  try {
    localStorage.setItem(REQUIRED_COMPONENT_WARNING_DISMISSED_KEY, "1");
  } catch {
    // The warning remains enabled when browser storage is unavailable.
  }
}

export function RequiredComponentWarningDialog({ componentName, packageName, onCancel, onConfirm }: {
  componentName: string;
  packageName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [dontRemind, setDontRemind] = useState(false);
  return <ConfirmDialog
    title={t("dshResources.componentWarningTitle", "Override a required component?")}
    cancelLabel={t("common.cancel", "Cancel")}
    confirmLabel={t("dshResources.componentWarningConfirm", "Apply override")}
    danger
    onCancel={onCancel}
    onConfirm={() => {
      if (dontRemind) dismissRequiredComponentWarning();
      onConfirm();
    }}
  >
    <div className="dsh-required-component-warning">
      <p>{t("dshResources.componentWarningMessage", "{component} belongs to the required bundle {package}. Forcing its state may affect DSH startup or features.", { component: componentName, package: packageName })}</p>
      <label className="dsh-required-component-warning-option">
        <input type="checkbox" checked={dontRemind} onChange={event => setDontRemind(event.target.checked)} />
        <span>{t("dshResources.componentWarningDontRemind", "Don't remind me again")}</span>
      </label>
    </div>
  </ConfirmDialog>;
}
