// The author dashboard's look, as Bubble property objects built from the shared admin tokens
// (bubble-app/admin/theme.mjs). The page was built in the editor with the app's design-system
// styles, whose colours are Bubble variables that never change with the theme. Laying these token
// colours on top as inline properties lets the shared theme layer switch them for dark mode.
import { T, TONES, fill, border, sideBorder, shadow, pad } from '../admin/theme.mjs';

const ink = (color) => ({ font_color: color });

/** Style name -> inline properties laid over every element that uses that style. */
export const STYLE_LOOK = {
  Group_card_: { ...fill(T.panel), ...border(T.border, 16), ...shadow('soft'), ...pad(24) },
  Popup_default_: { ...fill(T.panel), ...border(T.panel, 16), ...shadow('float'), greyout_color: 'rgba(16,20,28,0.45)' },
  Group_topbar_: { ...fill(T.panel), border_style: 'none', ...sideBorder('bottom', T.border) },
  Group_table_head_: { background_style: 'none', border_style: 'none', ...sideBorder('bottom', T.border) },
  Group_table_row_: { background_style: 'none', border_style: 'none', ...sideBorder('bottom', T.border) },
  Group_table_total_: { ...fill(T.brandSoft), border_roundness: 10 },
  Group_chip_: fill(T.brandSoft),
  Group_banner_prod_: fill(TONES.warning[1]),
  Text_h1_: ink(T.text1),
  Text_h2_: ink(T.text1),
  Text_h3_: ink(T.text1),
  Text_kpi_: ink(T.text1),
  Text_body_: ink(T.text1),
  Text_bold_: ink(T.text1),
  // Muted, small and label texts all use text2: text3 is under 4.5:1 on white at 12 px.
  Text_muted_: ink(T.text2),
  Text_small_: ink(T.text2),
  Text_label_: ink(T.text2),
  Text_chip_: ink(T.brandInk),
  Text_banner_prod_: ink(TONES.warning[0]),
  Text_wordmark_: ink(T.brand),
  Button_ghost_: { background_style: 'none', border_color: T.borderStrong, font_color: T.text1, icon_color: T.text1 },
};

/** Bubble design-system colours set directly on elements or in their conditions -> tokens. */
export const COLOR_MAP = {
  'var(--color_blprimarysoft_default)': T.brandSoft,
  'var(--color_blprimary_default)': T.brandInk,
  'var(--color_badgeambertext_default)': TONES.warning[0],
  'rgba(var(--color_blaccent_default_rgb), 0.6)': T.accent,
};

/** Property names that hold a colour (the only values COLOR_MAP may replace). */
export const isColorKey = (key) => /(^|_)(bg)?colou?r($|_)/.test(key);

/** Swaps mapped colours in a property object; every other value is returned as it was. */
export function retoken(properties = {}) {
  const swap = ([key, value]) => [key, isColorKey(key) && COLOR_MAP[value] ? COLOR_MAP[value] : value];
  return Object.fromEntries(Object.entries(properties).map(swap));
}

/** Content column: db_main is 1200 px wide with 24 px side padding, so its content is 1152 px. */
export const CONTENT_PX = 1152;
/** Space between table columns; 8 px let "Pending" and "Last payout" run together. */
export const TABLE_GAP = 16;
/** Left/right padding of a table row; statements and the empty text now use it too. */
export const ROW_INSET = 14;

/** Alignment fixes, per Bubble element id (layout properties only). */
export const LAYOUT = {
  // The top bar's inner row was 1200 px while the page content is 1152 px, so the wordmark sat
  // 24 px left of the content and "Log out" 24 px right of it.
  db_bar_in: { max_width_css: `${CONTENT_PX}px` },
  db_rt_tbl_w_head: { column_gap: TABLE_GAP },
  db_rt_tbl_w_row: { column_gap: TABLE_GAP },
  db_rt_tot: { column_gap: TABLE_GAP },
  // "No published books…" started 14 px left of the column headings.
  db_rt_empty: { padding_left: ROW_INSET, padding_right: ROW_INSET },
  // Statement rows had no side padding, so they did not line up with the royalty table above.
  db_st_row: { padding_left: ROW_INSET, padding_right: ROW_INSET },
  db_st_info: { vert_alignment: 'center' },
  // Platform chips were 23 px tall next to the 22 px genre chip (1.45 vs 1.3 line height).
  db_bk_plat_chip_t: { line_height: 1.3 },
};

/**
 * Bubble element id -> HTML id, for the shared theme CSS. Only elements that appear once on the
 * page: anything inside a repeating group repeats, so the theme targets those by Bubble's
 * element-id class (e.g. `.db_bk_card`) instead.
 */
export const HTML_IDS = {
  db_bar: 'bl-author-bar', db_bar_in: 'bl-author-bar-in', db_brand: 'bl-author-brand',
  db_uname: 'bl-author-name', db_logout: 'bl-author-logout',
  db_main: 'bl-author-main', db_hdr: 'bl-author-header', db_welcome: 'bl-author-welcome', db_asof: 'bl-author-asof',
  db_kpis: 'bl-author-kpis', db_k_earned: 'bl-author-kpi-earned', db_k_paid: 'bl-author-kpi-paid',
  db_k_pend: 'bl-author-kpi-pending', db_k_next: 'bl-author-kpi-next',
  db_sec_rt: 'bl-author-royalties', db_rt_card: 'bl-author-royalty-card', db_rt_tbl_w_head: 'bl-author-table-head',
  db_rt_tot: 'bl-author-table-total', db_sec_bk: 'bl-author-books', db_bk_rg: 'bl-author-book-list',
  db_sec_st: 'bl-author-statements', db_st_card: 'bl-author-statement-card',
  db_pop: 'bl-author-popup', db_pop_html: 'bl-author-popup-body',
};
