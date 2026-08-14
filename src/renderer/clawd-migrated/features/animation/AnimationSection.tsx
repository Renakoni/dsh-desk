// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Clock3, FlaskConical, Repeat2, RotateCcw, Shuffle, Sparkles, Wand2, X } from "lucide-react";
import type { CompanionSettings, IdleAnimConfig } from "../../../shared/events";
import { defaultSettings } from "../../../shared/events";
import { useI18n } from "../../useI18n";
import { petAnimationAssets } from "../../utils/petAnimationAssets";
import { normalizeAnimationKey, normalizeAnimationKeys, petAnimationMappableOptionsForCatalog, petAnimationOptionsForCatalog, toggleIdlePoolSprite, type PetAnimationKey } from "../../utils/petAnimations";
import { displayedMappingKey, mappingRowMeta, stateMappingRowsFor } from "../../utils/stateMappingRows";
import { MINATO_AQUA_CATALOG, normalizeMappableAnimationKey } from "../../../../shared/petThemeCatalog";
import { SpritesheetSprite } from "../../../components/SpritesheetSprite";
import { displayedSpriteHeight } from "../../../../shared/spriteFrame";

function AnimationSectionInner({ settings, updateSettings, catalog = MINATO_AQUA_CATALOG, spritesheet = null, active = true }: {
  settings: CompanionSettings;
  updateSettings: (settings: Partial<CompanionSettings>) => void;
  catalog?: any;
  spritesheet?: any;
  active?: boolean;
}) {
  const { t } = useI18n();
  // Drag-only locomotion keys are not standalone actions: the idle pool and
  // mapping pickers offer the mappable subset, while the Animation Test still
  // previews every row the theme provides.
  const options = useMemo(() => petAnimationOptionsForCatalog(catalog), [catalog]);
  const actionOptions = useMemo(() => petAnimationMappableOptionsForCatalog(catalog), [catalog]);

  return (
    <div className="animation-page animation-workbench">
      <AnimationPanel icon={<Sparkles size={17} />} title={t("sections.idleAnimation", "待机动画")} meta={catalog.source === "codex-pet-pack" ? t("petImport.importedTheme", "导入宠物") : "Aqua 动作库"}>
        <IdleAnimSettings config={settings.idleAnim ?? defaultSettings.idleAnim!} onChange={cfg => updateSettings({ idleAnim: cfg })} catalog={catalog} options={actionOptions} spritesheet={spritesheet} />
      </AnimationPanel>

      <div className="animation-page-secondary">
        <AnimationPanel icon={<Wand2 size={17} />} title={t("sections.actionMapping", "动作映射")}>
          <StateAnimSettings stateAnimations={settings.stateAnimations ?? {}} onChange={sa => updateSettings({ stateAnimations: sa })} catalog={catalog} options={actionOptions} spritesheet={spritesheet} />
        </AnimationPanel>

        <AnimationPanel icon={<FlaskConical size={17} />} title={t("sections.animationTest", "动画测试")}>
          <AnimationTestBlock active={active} options={options} spritesheet={spritesheet} />
        </AnimationPanel>
      </div>
    </div>
  );
}

function AnimationPanel({ icon, title, meta, children }: { icon?: React.ReactNode; title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="animation-panel">
      <header className="animation-panel-header">
        <div className="animation-panel-title">
          {icon ? <span className="animation-panel-icon">{icon}</span> : null}
          <h3>{title}</h3>
        </div>
        {meta ? <span className="animation-panel-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

function IdleAnimSettings({ config, onChange, catalog, options, spritesheet }: { config: IdleAnimConfig; onChange: (cfg: IdleAnimConfig) => void; catalog: any; options: any[]; spritesheet: any }) {
  const { t } = useI18n();
  // Honest count: a persisted empty pool displays as 0 selected instead of
  // falling back to "everything selected". Validated against the active
  // theme's catalog — foreign keys neither display nor count.
  const selectedSprites = normalizeAnimationKeys(config.selectedSprites, catalog);

  function toggleSprite(key: PetAnimationKey) {
    const next = toggleIdlePoolSprite(selectedSprites, key);
    if (next !== selectedSprites) onChange({ ...config, selectedSprites: next });
  }

  return (
    <div className="idle-anim-settings">
      <section className="animation-master-row">
        <div className="animation-master-copy">
          <strong>{t("data.enableIdleRandom", "启用待机随机动画")}</strong>
          <span>{config.enabled ? t("animation.randomEnabled", "从动画池中轮换播放") : t("animation.randomDisabled", "保持固定待机表现")}</span>
        </div>
        <SwitchButton checked={config.enabled} onChange={enabled => onChange({ ...config, enabled })} label={t("data.enableIdleRandom", "启用待机随机动画")} />
      </section>

      <div className="animation-summary-row">
        <AnimationStat label={t("animation.pool", "动画池")} value={`${selectedSprites.length}/${options.length}`} />
        <AnimationStat icon={<Clock3 size={14} />} label={t("data.playInterval", "播放间隔")} value={formatRange(config.intervalMin, config.intervalMax, value => `${value}s`)} />
        <AnimationStat icon={<Repeat2 size={14} />} label={t("data.repeatCount", "每次播放")} value={formatRange(config.repeatMin, config.repeatMax, value => `${value}x`)} />
      </div>

      <section className="animation-section-block">
        <SectionHead title={t("data.optionalPool", "可选动画池")} meta={t("animation.selectedCount", "已选 {count}").replace("{count}", String(selectedSprites.length))} />
        <div className="idle-sprite-grid">
          {options.map(option => (
            <SpriteOptionButton
              key={option.key}
              spriteKey={option.key}
              label={spriteLabel(t, option.key, options)}
              selected={selectedSprites.includes(option.key)}
              onClick={() => toggleSprite(option.key)}
              spritesheet={spritesheet}
            />
          ))}
        </div>
      </section>

      <section className="animation-section-block animation-ranges">
        <RangeSlider
          label={t("data.playInterval", "播放间隔")}
          min={5}
          max={120}
          step={5}
          low={config.intervalMin}
          high={config.intervalMax}
          format={value => `${value} ${t("common.seconds", "秒")}`}
          onChange={(low, high) => onChange({ ...config, intervalMin: low, intervalMax: high })}
        />
        <RangeSlider
          label={t("data.repeatCount", "每次播放次数")}
          min={1}
          max={5}
          step={1}
          low={config.repeatMin}
          high={config.repeatMax}
          format={value => `${value} ${t("common.times", "次")}`}
          onChange={(low, high) => onChange({ ...config, repeatMin: low, repeatMax: high })}
        />
      </section>
    </div>
  );
}

function StateAnimSettings({ stateAnimations, onChange, catalog, options, spritesheet }: { stateAnimations: Record<string, string>; onChange: (sa: Record<string, string>) => void; catalog: any; options: any[]; spritesheet: any }) {
  const { t } = useI18n();
  const formatText = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Role-accurate rows for the active theme: a dedicated error row when the
  // theme has one, merged rows when fallback chains share a slot key.
  const mappingRows = stateMappingRowsFor(catalog);

  function selectSprite(state: string, sprite: string, fallback: string) {
    onChange({ ...stateAnimations, [state]: normalizeMappableAnimationKey(catalog, sprite, fallback) });
    setOpenKey(null);
  }

  function resetState(state: string) {
    const next = { ...stateAnimations };
    delete next[state];
    onChange(next);
    setOpenKey(null);
  }

  const openRow = openKey ? mappingRows.find(row => row.key === openKey) : null;

  return (
    <div className="state-anim-settings">
      <div className="state-anim-list">
        {mappingRows.map(row => {
          // Displayed exactly as the live pet resolves it: catalog-validated,
          // so a stale or foreign mapping shows the real fallback animation.
          const currentSprite = displayedMappingKey(catalog, stateAnimations, row);
          const isOpen = openKey === row.key;
          return (
            <div key={row.key} className="state-anim-row">
              <div className="state-anim-meta">
                <strong>{t(row.labelKey, row.labelFallback)}</strong>
                <span>{mappingRowMeta(row, t)}</span>
              </div>
              <AssignmentButton
                spriteKey={currentSprite}
                label={spriteLabel(t, currentSprite, options)}
                open={isOpen}
                onClick={() => setOpenKey(isOpen ? null : row.key)}
                spritesheet={spritesheet}
              />
            </div>
          );
        })}
      </div>
      {openKey && openRow && (
        <SpritePicker
          title={formatText(t("data.chooseActionAnimation", "选择「{name}」的动画"), { name: t(openRow.labelKey, openRow.labelFallback) })}
          currentSprite={displayedMappingKey(catalog, stateAnimations, openRow)}
          options={options}
          spritesheet={spritesheet}
          onSelect={sprite => selectSprite(openKey, sprite, openRow.key)}
          onReset={() => resetState(openKey)}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  );
}

function AnimationTestBlock({ options, spritesheet, active }: { options: any[]; spritesheet: any; active: boolean }) {
  const { t } = useI18n();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => () => {
    void window.companion.previewPetAnimation("__clear_preview");
  }, []);

  useEffect(() => {
    if (active || !activeKey) return;
    setActiveKey(null);
    void window.companion.previewPetAnimation("__clear_preview");
  }, [active, activeKey]);

  function previewAnimation(key: PetAnimationKey) {
    setActiveKey(key);
    void window.companion.previewPetAnimation(key);
  }

  function stopPreview() {
    setActiveKey(null);
    void window.companion.previewPetAnimation("__clear_preview");
  }

  return (
    <div className="animation-test-settings">
      <section className="animation-section-block">
        <SectionHead title={t("animation.testBlock", "点击测试姿势")} meta={t("animation.temporaryPreview", "临时预览")} />
        <div className="idle-sprite-grid animation-test-grid">
          {options.map(option => (
            <SpriteOptionButton
              key={option.key}
              spriteKey={option.key}
              label={spriteLabel(t, option.key, options)}
              selected={activeKey === option.key}
              onClick={() => previewAnimation(option.key)}
              spritesheet={spritesheet}
            />
          ))}
        </div>
        <div className="animation-test-actions">
          <button type="button" className="animation-test-stop" onClick={stopPreview} disabled={!activeKey}>{t("animation.stopTest", "停止测试")}</button>
        </div>
      </section>
    </div>
  );
}

function SwitchButton({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" className={`animation-switch ${checked ? "on" : ""}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span className="animation-switch-track"><span className="animation-switch-knob" /></span>
    </button>
  );
}

function AnimationStat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="animation-stat">
      {icon ? <span className="animation-stat-icon">{icon}</span> : null}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <header className="animation-section-head">
      <h3 className="panel-subtitle">{title}</h3>
      {meta ? <span>{meta}</span> : null}
    </header>
  );
}

function AssignmentButton({ spriteKey, label, open, onClick, spritesheet }: { spriteKey: string; label: string; open: boolean; onClick: () => void; spritesheet: any }) {
  return (
    <button type="button" className={`animation-assignment-button ${open ? "open" : ""}`} onClick={onClick} title={label}>
      <SpriteFigure spriteKey={spriteKey} spritesheet={spritesheet} />
      <span>{label}</span>
      <ChevronDown size={15} />
    </button>
  );
}

function SpritePicker({ title, currentSprite, options, spritesheet, includeRandom, onSelect, onReset, onClose }: {
  title: string;
  currentSprite: string;
  options: any[];
  spritesheet: any;
  includeRandom?: boolean;
  onSelect: (sprite: string) => void;
  onReset?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const normalizedCurrent = currentSprite === "random" ? "random" : normalizeAnimationKey(currentSprite, "running");

  return (
    <div className="state-anim-picker">
      <div className="state-anim-picker-title">
        <span>{title}</span>
        <button type="button" className="state-anim-picker-close" onClick={onClose} aria-label={t("common.close", "关闭")}><X size={16} /></button>
      </div>
      <div className="state-anim-picker-grid">
        {includeRandom ? (
          <SpriteOptionButton
            spriteKey="random"
            label={t("common.random", "随机")}
            selected={normalizedCurrent === "random"}
            onClick={() => onSelect("random")}
            spritesheet={spritesheet}
          />
        ) : null}
        {options.map(option => (
          <SpriteOptionButton
            key={option.key}
            spriteKey={option.key}
            label={spriteLabel(t, option.key, options)}
            selected={normalizedCurrent === option.key}
            onClick={() => onSelect(option.key)}
            spritesheet={spritesheet}
          />
        ))}
        {onReset ? (
          <button type="button" className="idle-sprite-preview reset" onClick={onReset}>
            <span className="sprite-reset-mark"><RotateCcw size={18} /></span>
            <span className="idle-sprite-label">{t("common.resetDefault", "重置默认")}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SpriteOptionButton({ spriteKey, label, selected, onClick, spritesheet }: { spriteKey: string; label: string; selected: boolean; onClick: () => void; spritesheet: any }) {
  return (
    <button type="button" className={`idle-sprite-preview ${selected ? "checked" : ""}`} onClick={onClick} aria-pressed={selected} title={label}>
      <SpriteFigure spriteKey={spriteKey} spritesheet={spritesheet} />
      <span className="idle-sprite-label">{label}</span>
      {selected ? <span className="sprite-selected-mark"><Check size={12} /></span> : null}
    </button>
  );
}

// The sprite preview (spritesheet-driven animation or clip image) is the
// expensive leaf. Memoize it on its two real inputs so a re-render of the
// button wrapper (its onClick is a fresh closure each render) or an unrelated
// slider drag doesn't re-render every sprite in the grid.
const SpriteFigure = React.memo(function SpriteFigure({ spriteKey, spritesheet }: { spriteKey: string; spritesheet: any }) {
  if (spriteKey === "random") {
    return (
      <span className="sprite-preview-box random">
        <Shuffle size={22} />
      </span>
    );
  }

  const key = normalizeAnimationKey(spriteKey, "running");

  // Pack themes preview straight from the installed spritesheet — and only
  // from it. A key the pack does not provide renders an empty box rather
  // than falling through to a built-in Aqua clip inside an imported theme.
  if (spritesheet) {
    const packAnimation = spritesheet.animations?.[key];
    if (!packAnimation) return <span className="sprite-preview-box" />;
    const width = 44;
    const height = displayedSpriteHeight(spritesheet.cellWidth, spritesheet.cellHeight, width);
    return (
      <span className="sprite-preview-box">
        <SpritesheetSprite
          sheetUrl={spritesheet.sheetUrl}
          columns={spritesheet.columns}
          rows={spritesheet.rows}
          row={packAnimation.row}
          frameCount={packAnimation.frameCount}
          frameDurationMs={packAnimation.frameDurationMs}
          width={width}
          height={height}
          alt=""
        />
      </span>
    );
  }

  const clip = petAnimationAssets[key];
  return (
    <span className="sprite-preview-box">
      {clip ? <img className="sprite-preview-image" src={clip} alt="" draggable={false} /> : null}
    </span>
  );
});

function RangeSlider({ label, min, max, step, low, high, format, onChange }: {
  label: string; min: number; max: number; step: number;
  low: number; high: number; format: (value: number) => string;
  onChange: (low: number, high: number) => void;
}) {
  const range = max - min;
  const leftPercent = ((low - min) / range) * 100;
  const rightPercent = ((high - min) / range) * 100;

  return (
    <label className="range-slider-row">
      <span className="range-slider-copy">
        <span>{label}</span>
        <b>{format(low)} - {format(high)}</b>
      </span>
      <div className="range-track" style={{ "--range-left": `${leftPercent}%`, "--range-width": `${rightPercent - leftPercent}%` } as React.CSSProperties}>
        <div className="range-fill-boundary">
          <div className="range-fill" />
        </div>
        <input
          type="range" min={min} max={max} step={step} value={low}
          onChange={event => { const value = Number(event.target.value); if (value <= high) onChange(value, high); }}
        />
        <input
          type="range" min={min} max={max} step={step} value={high}
          onChange={event => { const value = Number(event.target.value); if (value >= low) onChange(low, value); }}
        />
      </div>
    </label>
  );
}

function spriteLabel(t: (key: string, fallback?: string) => string, key: string, options: any[]) {
  if (key === "random") return t("common.random", "随机");
  const normalized = normalizeAnimationKey(key, "running");
  const option = options.find(item => item.key === normalized);
  return option ? t(option.labelKey, option.fallback) : key;
}

function formatRange(low: number, high: number, format: (value: number) => string) {
  return `${format(low)} - ${format(high)}`;
}

// This section reads exactly two slices of `settings` — `idleAnim` and
// `stateAnimations`. But every settings save round-trips through IPC
// (`saveSettings` → `ipcRenderer.invoke`), which structured-clones the reply, so
// those nested objects get a brand-new identity on *every* save even when their
// value is unchanged. A default shallow compare would therefore re-render this
// hidden section on unrelated changes (e.g. dragging a slider on the Settings
// tab). Compare the two slices by value so it bails unless the animation config
// itself actually changed; the expensive sprite leaves are additionally guarded
// by the memoized SpriteFigure above.
function arraysEqual(a: unknown[] | undefined, b: unknown[] | undefined) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

function idleAnimEqual(a: any, b: any) {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return a.enabled === b.enabled
    && a.intervalMin === b.intervalMin
    && a.intervalMax === b.intervalMax
    && a.repeatMin === b.repeatMin
    && a.repeatMax === b.repeatMax
    && arraysEqual(a.selectedSprites, b.selectedSprites);
}

function stateAnimationsEqual(a: Record<string, string> = {}, b: Record<string, string> = {}) {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(key => a[key] === b[key]);
}

function animationPropsEqual(prev: any, next: any) {
  return prev.active === next.active
    && prev.updateSettings === next.updateSettings
    && prev.catalog === next.catalog
    && prev.spritesheet === next.spritesheet
    && idleAnimEqual(prev.settings?.idleAnim, next.settings?.idleAnim)
    && stateAnimationsEqual(prev.settings?.stateAnimations, next.settings?.stateAnimations);
}

// Keep-mounted under the tab container: memoized so an unrelated slider drag or
// a tab switch doesn't re-render the whole sprite grid.
export const AnimationSection = React.memo(AnimationSectionInner, animationPropsEqual);
