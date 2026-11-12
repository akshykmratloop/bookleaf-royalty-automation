// Design tokens and inline style presets. Every colour is a CSS variable with a light fallback,
// e.g. `var(--bl-panel, #fffcfb)`: Bubble stores and renders these strings as-is (checked live on
// 12 Nov 2026 for bgcolor, font_color, border_color, boxshadow_color and hover states), so the
// theme layer (bubble-app/theme/) switches every generated element between light and dark.
// The variable names and both themes' values live in bubble-app/theme/css/01-tokens.css.

const v = (name, light) => `var(--bl-${name}, ${light})`;

export const T = {
  bg: v('bg', '#fbf3f1'), side: v('side', 'rgba(255,250,248,0.74)'), topbar: v('topbar', 'rgba(251,243,241,0.78)'),
  panel: v('panel', '#fffcfb'), card: v('card', 'rgba(255,252,250,0.84)'), panel2: v('panel-2', '#fbf1f0'), inset: v('inset', '#fdf7f6'),
  border: v('border', 'rgba(31,26,28,0.09)'), borderStrong: v('border-strong', 'rgba(31,26,28,0.17)'),
  text1: v('text-1', '#1f1a1c'), text2: v('text-2', '#5f5056'), text3: v('text-3', '#8d7c83'),
  brand: v('brand', '#c8475a'), brandHover: v('brand-hover', '#a8344a'), brandInk: v('brand-ink', '#a83a4d'), brandSoft: v('brand-soft', '#fbe6e8'),
  btn: v('btn', '#c8475a'), btnHover: v('btn-hover', '#a8344a'), onBrand: v('on-brand', '#ffffff'),
  dangerSolid: v('danger-solid', '#b3261e'), // a filled danger control with white text (both themes)
  navy: v('navy', '#3d3550'), navySoft: v('navy-soft', '#efebf3'), accent: v('accent', '#d98a12'), accentSoft: v('accent-soft', '#fbefd9'),
};

/** Status tones: [text, background]. */
export const TONES = {
  success: [v('success', '#1d7a4b'), v('success-bg', '#e5f3ea')],
  warning: [v('warning', '#9a5a06'), v('warning-bg', '#fbefd9')],
  danger: [v('danger', '#b3261e'), v('danger-bg', '#fbe8e6')],
  info: [v('info', '#2f6db5'), v('info-bg', '#e9f0fb')],
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

/** Rose-tinted shadows (light); deep, near-black shadows in dark. */
const SHADOWS = {
  soft: [0, 1, 3, 0, v('shadow-soft', 'rgba(110,40,56,0.08)')],
  card: [0, 14, 34, -18, v('shadow-card', 'rgba(140,40,62,0.22)')],
  lift: [0, 12, 28, -10, v('shadow-lift', 'rgba(200,71,90,0.20)')],
  float: [0, 30, 80, -24, v('shadow-float', 'rgba(80,30,40,0.34)')],
};

export function shadow(kind = 'soft') {
  const [h, vert, blur, spread, color] = SHADOWS[kind];
  return { boxshadow_style: 'outset', boxshadow_horizontal: h, boxshadow_vertical: vert, boxshadow_blur: blur, boxshadow_spread: spread, boxshadow_color: color };
}

export const pad = (t, r = t, b = t, l = r) => ({ padding_top: t, padding_right: r, padding_bottom: b, padding_left: l });

/** font(13, 600, T.text2) -> size, weight and colour (weights as strings, the way Bubble stores them). */
export const font = (size, weight = 400, color = T.text1, extra = {}) => ({
  font_size: size, font_weight: String(weight), font_color: color, ...extra,
});

/** Bubble's own heading-font token; the theme layer points it at Fraunces. */
export const DISPLAY_FONT = 'var(--font_heading_default)';

/** Frosted paper card: translucent fill (the theme layer adds the blur), hairline edge, rose shadow. */
export const card = (extra = {}) => ({ ...fill(T.card), ...border(), ...shadow('card'), ...pad(20), ...extra });

/** Text presets used across the page. h1/h2 use the display serif; everything else Manrope. */
export const TYPE = {
  h1: font(28, 500, T.text1, { letter_spacing: -0.5, font_family: DISPLAY_FONT, line_height: 1.15 }),
  h2: font(18, 600, T.text1, { letter_spacing: -0.2, font_family: DISPLAY_FONT, line_height: 1.25 }),
  h3: font(14, 700, T.text1),
  sub: font(13.5, 400, T.text2, { line_height: 1.45 }),
  body: font(13.5, 400, T.text1),
  cell: font(13, 400, T.text1),
  strong: font(13, 700, T.text1),
  hint: font(12, 400, T.text3, { line_height: 1.4 }),
  micro: font(11, 700, T.text3, { letter_spacing: 0.8 }),
  kpi: font(26, 800, T.text1, { letter_spacing: -0.4 }),
};

/** Buttons: 12px radius, 36-40px tall, colour per variant; hover handled by states. */
export const BUTTONS = {
  primary: { look: { ...fill(T.btn), ...border(T.btn, 12), ...font(13.5, 700, T.onBrand), ...shadow('lift') }, hover: fill(T.btnHover) },
  secondary: { look: { ...fill(T.panel), ...border(T.borderStrong, 12), ...font(13.5, 700, T.text1) }, hover: { border_color: T.brand } },
  soft: { look: { ...fill(T.brandSoft), ...border(T.brandSoft, 12), ...font(13.5, 700, T.brandInk) }, hover: { border_color: T.brand } },
  ghost: { look: { ...fill('rgba(0,0,0,0)'), ...border('rgba(0,0,0,0)', 12), ...font(13, 600, T.text2) }, hover: { ...fill(T.panel2), font_color: T.text1 } },
  danger: { look: { ...fill(TONES.danger[1]), ...border(TONES.danger[1], 12), ...font(13.5, 700, TONES.danger[0]) }, hover: { border_color: TONES.danger[0] } },
};

/** Old style names used by the sections map onto variants. */
export const VARIANT_OF_STYLE = { Button_primary_: 'primary', Button_ghost_: 'ghost' };

export const INPUT = { ...fill(T.inset), ...border(T.borderStrong, 12), ...font(13.5, 400, T.text1), ...pad(0, 12) };
export const INPUT_FOCUS = { border_color: T.brand, ...shadow('soft'), boxshadow_color: v('focus-ring', 'rgba(200,71,90,0.22)'), boxshadow_spread: 3, boxshadow_vertical: 0, boxshadow_blur: 0 };

/** Element-level transitions so hover colours fade instead of snapping. */
export const SMOOTH = { background_style: { fn: 'ease', duration: 150 }, border_color: { fn: 'ease', duration: 150 }, font_color: { fn: 'ease', duration: 150 } };
