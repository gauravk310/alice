import {
  createElement,
  createIcons,
  ShieldCheck,
  Database,
  LogOut,
  Gamepad2,
  Sparkles,
  User,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Zap,
  type IconNode,
} from "lucide";

export {
  createIcons,
  ShieldCheck,
  Database,
  LogOut,
  Gamepad2,
  Sparkles,
  User,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Zap,
};

/**
 * Render any Lucide icon to an SVG string for template interpolation
 */
export function renderLucideIcon(
  icon: IconNode,
  attributes: Record<string, string | number> = {}
): string {
  const defaultAttrs: Record<string, string | number> = {
    width: 16,
    height: 16,
    "stroke-width": 2,
    class: "lucide",
  };

  const merged = { ...defaultAttrs, ...attributes };
  const element = createElement(icon, merged);
  return element.outerHTML;
}

/**
 * Scan DOM for elements with data-lucide attributes and replace with Lucide SVGs
 */
export function refreshLucideIcons(root?: Element | Document): void {
  createIcons({
    root: root || document.body,
    icons: {
      ShieldCheck,
      Database,
      LogOut,
      Gamepad2,
      Sparkles,
      User,
      CheckCircle2,
      AlertTriangle,
      Wifi,
      WifiOff,
      Zap,
    },
    attrs: {
      "stroke-width": "2",
    },
  });
}
