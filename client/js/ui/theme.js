// ui/theme.js — Covenant dark-fantasy art direction tokens.
// Palette mirror of css/style.css :root. applyTheme() pushes values onto
// documentElement so runtime overrides stay in sync with the stylesheet.

export const COVENANT_THEME = {
  bg: '#0a0712',
  bg2: '#100a1c',
  bg3: '#171026',
  panel: 'rgba(16, 11, 28, 0.94)',
  panelLine: 'rgba(212, 175, 55, 0.38)',
  gold: '#d4af37',
  goldHi: '#ffd700',
  goldSoft: '#f2be5c',
  goldDim: '#8a6d2b',
  parchment: '#f4e6c6',
  parchmentDim: '#cbb89d',
  violet: '#9d4edd',
  violetHi: '#e0aaff',
  violetDeep: '#2d144d',
  blood: '#b91c1c',
  bloodHi: '#ef4444',
  mana: '#7c6cf5',
  manaHi: '#b3a6ff',
  xp: '#a855f7',
  heal: '#34d399',
  ink: '#060309',
  fontDisplay: "'Cinzel', 'Times New Roman', Georgia, serif",
  fontBody: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
};

// Map camelCase token keys to the CSS variable names used in style.css.
const VAR_MAP = {
  bg: '--bg', bg2: '--bg-2', bg3: '--bg-3', panel: '--panel',
  panelLine: '--panel-line', gold: '--gold', goldHi: '--gold-hi',
  goldSoft: '--gold-soft', goldDim: '--gold-dim', parchment: '--parchment',
  parchmentDim: '--parchment-dim', violet: '--violet', violetHi: '--violet-hi',
  violetDeep: '--violet-deep', blood: '--blood', bloodHi: '--blood-hi',
  mana: '--mana', manaHi: '--mana-hi', xp: '--xp', heal: '--heal', ink: '--ink',
};

export function applyTheme(overrides = {}) {
  const root = document.documentElement;
  const merged = { ...COVENANT_THEME, ...overrides };
  for (const [key, cssVar] of Object.entries(VAR_MAP)) {
    if (merged[key] != null) root.style.setProperty(cssVar, merged[key]);
  }
  return merged;
}

export default { COVENANT_THEME, applyTheme };
