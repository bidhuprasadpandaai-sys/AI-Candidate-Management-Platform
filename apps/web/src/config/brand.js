// The one place for platform defaults and design tokens. Company-specific values (name, logo, colours,
// details) come from the API (`GET /branding`) and are applied on top of these by stores/branding.js.
// See docs/UIStyleGuide.md.
export const PLATFORM = {
  name: "TalentOS",
  tagline: "AI-assisted recruiting",
  primaryColor: "#4f46e5",
  accentColor: "#0ea5e9"
};

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

export function hexToRgb(hex) {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : PLATFORM.primaryColor.slice(1);
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
}

const toHex = (rgb) => `#${rgb.map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;

// amount 0..1 moves the colour towards `target` ([255,255,255] lightens, [0,0,0] darkens)
function mix(hex, target, amount) {
  const rgb = hexToRgb(hex);
  return toHex(rgb.map((channel, i) => channel + (target[i] - channel) * amount));
}

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

// Readable text colour on top of a background colour
export function textOn(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#0f172a" : "#ffffff";
}

// Builds every colour variable the app uses from the two brand colours.
// `--primary-*` names are the ones PrimeVue's theme reads, so components follow the brand too.
export function buildThemeVars(primary = PLATFORM.primaryColor, accent = PLATFORM.accentColor) {
  const p = /^#[0-9a-f]{6}$/i.test(primary) ? primary : PLATFORM.primaryColor;
  const a = /^#[0-9a-f]{6}$/i.test(accent) ? accent : PLATFORM.accentColor;
  return {
    "--primary-color": p,
    "--primary-color-text": textOn(p),
    "--primary-50": mix(p, WHITE, 0.94),
    "--primary-100": mix(p, WHITE, 0.86),
    "--primary-200": mix(p, WHITE, 0.7),
    "--primary-300": mix(p, WHITE, 0.5),
    "--primary-400": mix(p, WHITE, 0.25),
    "--primary-500": p,
    "--primary-600": mix(p, BLACK, 0.12),
    "--primary-700": mix(p, BLACK, 0.28),
    "--primary-800": mix(p, BLACK, 0.44),
    "--primary-900": mix(p, BLACK, 0.6),
    "--accent-color": a,
    "--accent-soft": mix(a, WHITE, 0.88),
    "--brand-gradient": `linear-gradient(135deg, ${p} 0%, ${a} 100%)`
  };
}

export function applyThemeVars(vars, root = document.documentElement) {
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}

export const initialsOf = (name) =>
  String(name || PLATFORM.name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "T";
