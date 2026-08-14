import { useMemo } from "react";
import { getIcon, getIconMetadata, getIconUrl, hasIcon, isUrlIcon } from "./icons";

/**
 * Brand icon for a provider, ported from cc-switch's ProviderIcon:
 * inline SVG (colored via currentColor + metadata defaultColor), URL-based
 * raster/large assets as <img>, and an initials fallback.
 */
export function ProviderIcon({
  icon,
  name,
  color,
  size = 20
}: {
  icon?: string;
  name: string;
  color?: string;
  size?: number;
}) {
  const iconSvg = useMemo(() => (icon && !isUrlIcon(icon) && hasIcon(icon) ? getIcon(icon) : ""), [icon]);
  const iconUrl = useMemo(() => (icon && isUrlIcon(icon) ? getIconUrl(icon) : ""), [icon]);

  const effectiveColor = useMemo(() => {
    if (color && color.trim()) return color;
    if (icon) {
      const metadata = getIconMetadata(icon);
      if (metadata?.defaultColor && metadata.defaultColor !== "currentColor") return metadata.defaultColor;
    }
    return undefined;
  }, [color, icon]);

  const sizeStyle = { width: size, height: size, fontSize: size, lineHeight: 1 };

  if (iconSvg) {
    return (
      <span
        className="ccs-brand-icon"
        title={name}
        style={{ ...sizeStyle, color: effectiveColor }}
        dangerouslySetInnerHTML={{ __html: iconSvg }}
      />
    );
  }

  if (iconUrl) {
    return <img className="ccs-brand-icon" src={iconUrl} alt={name} title={name} style={{ width: size, height: size }} loading="lazy" />;
  }

  const initials = name
    .split(" ")
    .map(word => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <span className="ccs-brand-icon ccs-brand-icon-fallback" title={name} style={{ ...sizeStyle, color: effectiveColor }}>
      <span style={{ fontSize: Math.max(size * 0.5, 11) }}>{initials || "?"}</span>
    </span>
  );
}
