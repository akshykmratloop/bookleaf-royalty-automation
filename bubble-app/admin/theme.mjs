// Design tokens and inline style presets, matching the Assignment 1 operations dashboard
// (apps/web/src/styles/tokens.css): coral brand, warm neutrals, 16px cards, 12px controls.
// Presets are plain Bubble property objects; builders spread them over an element's properties.

export const T = {
  bg: '#f6f5f7', panel: '#ffffff', panel2: '#faf8f9', inset: '#f4f1f3',
  border: '#ece7ea', borderStrong: '#ddd5d9',
  text1: '#2f2e2e', text2: '#5e5e5e', text3: '#8a8686',
  brand: '#d13f53', brandHover: '#b8334a', brandInk: '#c8384c', brandSoft: '#fdecee',
  navy: '#35465c', navySoft: '#eef1f5', accent: '#f59e0b', accentSoft: '#fff4dc',
};

/** Status tones: [text, background]. */
export const TONES = {
  success: ['#0f8a4f', '#e3f6ec'],
  warning: ['#b45309', '#fff3dc'],
  danger: ['#c42b2b', '#fdecec'],
  info: ['#2f6db5', '#e9f0fb'],
  brand: [T.brandInk, T.brandSoft],
  neutral: [T.text2, T.panel2],
};

export const fill = (color) => ({ background_style: 'bgcolor', bgcolor: color });
export const noFill = () => ({ background_style: 'none' });

export const border = (color = T.border, radius = 16, width = 1) => ({
  border_style: 'solid', border_width: width, border_color: color, border_roundness: radius,
});

/** Only the bottom (or another single) border, e.g. table row dividers. */
export const sideBorder = (side, color = T.border) => ({
  four_border_style: true,
  border_style_top: 'none', border_style_right: 'none', border_style_bottom: 'none', border_style_left: 'none',
  [`border_style_${side}`]: 'solid', [`border_width_${side}`]: 1, [`border_color_${side}`]: color,
});

const SHADOWS = {
  soft: [0, 1, 3, 0, 'rgba(47,46,46,0.08)'],
  lift: [0, 12, 28, -10, 'rgba(209,63,83,0.18)'],
  float: [0, 24, 64, -16, 'rgba(53,70,92,0.30)'],
};

export function shadow(kind = 'soft') {
  const [h, v, blur, spread, color] = SHADOWS[kind];
  return { boxshadow_style: 'outset', boxshadow_horizontal: h, boxshadow_vertical: v, boxshadow_blur: blur, boxshadow_spread: spread, boxshadow_color: color };
}

export const pad = (t, r = t, b = t, l = r) => ({ padding_top: t, padding_right: r, padding_bottom: b, padding_left: l });

/** font(13, 600, T.text2) -> size, weight and colour (weights as strings, the way Bubble stores them). */
export const font = (size, weight = 400, color = T.text1, extra = {}) => ({
  font_size: size, font_weight: String(weight), font_color: color, ...extra,
});

export const card = (extra = {}) => ({ ...fill(T.panel), ...border(), ...shadow('soft'), ...pad(20), ...extra });

/** Text presets used across the page. */
export const TYPE = {
  h1: font(24, 700, T.text1, { letter_spacing: -0.3 }),
  h2: font(16, 700, T.text1),
  h3: font(14, 700, T.text1),
  sub: font(13.5, 400, T.text2, { line_height: 1.45 }),
  body: font(13.5, 400, T.text1),
  cell: font(13, 400, T.text1),
  strong: font(13, 700, T.text1),
  hint: font(12, 400, T.text3, { line_height: 1.4 }),
  micro: font(11, 700, T.text3, { letter_spacing: 0.6 }),
  kpi: font(26, 800, T.text1, { letter_spacing: -0.4 }),
};

/** Buttons: 12px radius, 36-40px tall, colour per variant; hover handled by states. */
export const BUTTONS = {
  primary: { look: { ...fill(T.brand), ...border(T.brand, 12), ...font(13.5, 700, '#ffffff'), ...shadow('soft') }, hover: fill(T.brandHover) },
  secondary: { look: { ...fill(T.panel), ...border(T.borderStrong, 12), ...font(13.5, 700, T.text1) }, hover: { border_color: T.brand } },
  soft: { look: { ...fill(T.brandSoft), ...border(T.brandSoft, 12), ...font(13.5, 700, T.brandInk) }, hover: { border_color: T.brand } },
  ghost: { look: { ...fill('rgba(0,0,0,0)'), ...border('rgba(0,0,0,0)', 12), ...font(13, 600, T.text2) }, hover: { ...fill(T.panel2), font_color: T.text1 } },
  danger: { look: { ...fill(TONES.danger[1]), ...border(TONES.danger[1], 12), ...font(13.5, 700, TONES.danger[0]) }, hover: { border_color: TONES.danger[0] } },
};

/** Old style names used by the sections map onto variants. */
export const VARIANT_OF_STYLE = { Button_primary_: 'primary', Button_ghost_: 'ghost' };

export const INPUT = { ...fill(T.inset), ...border(T.border, 12), ...font(13.5, 400, T.text1), ...pad(0, 12) };
export const INPUT_FOCUS = { border_color: T.brand, ...shadow('soft'), boxshadow_color: 'rgba(209,63,83,0.25)', boxshadow_spread: 3, boxshadow_vertical: 0, boxshadow_blur: 0 };

/** Element-level transitions so hover colours fade instead of snapping. */
export const SMOOTH = { background_style: { fn: 'ease', duration: 150 }, border_color: { fn: 'ease', duration: 150 }, font_color: { fn: 'ease', duration: 150 } };
