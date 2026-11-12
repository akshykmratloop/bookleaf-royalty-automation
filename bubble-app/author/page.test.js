// Checks the restyled author dashboard before it is written into Bubble: workflows, custom states,
// data sources, texts and conditions must be exactly as in the snapshot; only layout and style move.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { BEFORE, THEME_HTML, THEME_HTML_ID, THEME_KEY, TOGGLE_KEY, TOGGLE_ORDER, TOP_KEYS, buildAuthorPage } from './page.mjs';
import { COLOR_MAP, HTML_IDS, LAYOUT, STYLE_LOOK, isColorKey } from './looks.mjs';

const ROOT = new URL('../../', import.meta.url);
const page = buildAuthorPage(BEFORE, ''); // the restyle alone
const themed = buildAuthorPage(); // what the writer sends: restyle + theme layer + toggle

/** Every element under a node, as a flat list (the node itself first). */
function flatten(node, out = [], inList = false) {
  if (!node || typeof node !== 'object' || !node.type) return out; // Bubble's `length` keys
  out.push({ node, inList });
  Object.values(node.elements ?? {}).forEach((c) => flatten(c, out, inList || node.type === 'RepeatingGroup'));
  return out;
}
const all = (root) => Object.values(root.elements).flatMap((e) => flatten(e));
const byId = (root) => Object.fromEntries(all(root).map(({ node }) => [node.id, node]));
const before = byId(BEFORE);
const after = byId(page);
const htmlIdOf = (e) => e.properties.unique_id?.entries?.[0];
/** Properties that may change: colours, borders, shadows, padding and the layout fixes. */
const STYLE_KEY = /^(bgcolor|background_style|border_|four_border_style|boxshadow_|padding_|greyout_color|font_color|icon_color|unique_id)/;
const changeable = (id, key) => STYLE_KEY.test(key) || key in (LAYOUT[id] ?? {});

describe('author dashboard: behaviour unchanged', () => {
  it('keeps all 7 workflows, the custom state and the page properties exactly', () => {
    const real = (w) => Object.keys(w).filter((k) => k !== 'length');
    expect(real(page.workflows)).toHaveLength(7);
    expect(page.workflows).toEqual(BEFORE.workflows);
    expect(page.custom_states).toEqual(BEFORE.custom_states);
    expect(page.properties).toEqual(BEFORE.properties);
  });

  it('keeps every element, with its type, style, name and children', () => {
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const [id, b] of Object.entries(before)) {
      const a = after[id];
      expect([a.type, a.style, a.name, Object.keys(a.elements ?? {})], id).toEqual([b.type, b.style, b.name, Object.keys(b.elements ?? {})]);
    }
  });

  it('changes no data source, text, expression or visibility, only layout and style', () => {
    for (const [id, b] of Object.entries(before)) {
      for (const [prop, value] of Object.entries(b.properties)) {
        if (changeable(id, prop)) continue;
        expect(after[id].properties[prop], `${id}.${prop}`).toEqual(value);
      }
    }
  });

  it('keeps every condition exactly; a condition may only swap a mapped colour', () => {
    for (const [id, b] of Object.entries(before)) {
      if (!b.states) continue;
      const aStates = after[id].states;
      expect(Object.keys(aStates), id).toEqual(Object.keys(b.states));
      for (const [k, s] of Object.entries(b.states)) {
        if (!s?.properties) { expect(aStates[k]).toEqual(s); continue; }
        expect([aStates[k].condition, aStates[k].type], `${id}#${k}`).toEqual([s.condition, s.type]);
        for (const [prop, value] of Object.entries(s.properties)) {
          const expected = isColorKey(prop) && COLOR_MAP[value] ? COLOR_MAP[value] : value;
          expect(aStates[k].properties[prop], `${id}#${k}.${prop}`).toEqual(expected);
        }
      }
    }
  });

  it('leaves the other top-level elements alone and adds nothing without a theme layer', () => {
    const changed = Object.values(TOP_KEYS);
    for (const [key, el] of Object.entries(BEFORE.elements)) if (!changed.includes(el.id)) expect(page.elements[key]).toEqual(el);
    expect(Object.keys(page.elements).sort()).toEqual(Object.keys(BEFORE.elements).sort());
  });

  it('is the same when built again from the written page', () => {
    expect(buildAuthorPage(page, '')).toEqual(page);
    expect(buildAuthorPage(themed)).toEqual(themed);
  });
});

describe('author dashboard: look', () => {
  it('leaves no Bubble design-system colour on any element or condition', () => {
    const left = JSON.stringify(Object.values(TOP_KEYS).map((id) => after[id])).match(/var\(--color_[a-z_]+\)/g);
    expect(left).toBeNull();
  });

  it('gives every styled element its token look', () => {
    for (const el of Object.values(after)) {
      for (const [prop, value] of Object.entries(STYLE_LOOK[el.style] ?? {})) {
        if (prop in (LAYOUT[el.id] ?? {})) continue;
        const own = before[el.id].properties[prop]; // the element's own value beats the style look
        const expected = own === undefined ? value : (COLOR_MAP[own] ?? own);
        expect(el.properties[prop], `${el.id}.${prop}`).toEqual(expected);
      }
    }
  });

  it('aligns the top bar with the content column and spaces the table columns evenly', () => {
    expect(after.db_bar_in.properties.max_width_css).toBe('1152px');
    const gaps = ['db_rt_tbl_w_head', 'db_rt_tbl_w_row', 'db_rt_tot'].map((id) => after[id].properties.column_gap);
    expect(new Set(gaps)).toEqual(new Set([16]));
    const insets = ['db_rt_tbl_w_row', 'db_rt_empty', 'db_st_row'].map((id) => after[id].properties.padding_left);
    expect(new Set(insets)).toEqual(new Set([14]));
  });

  it('keeps each table heading aligned like its column', () => {
    const cols = ['last', 'paid', 'pend', 'title', 'copies', 'earned'];
    for (const c of cols) {
      const [h, v] = [after[`db_rt_tbl_w_h_${c}`].properties, after[`db_rt_tbl_w_${c}`].properties];
      expect([h.font_alignment, h.width, h.order], c).toEqual([v.font_alignment, v.width, v.order]);
    }
  });
});

describe('author dashboard: HTML ids and theme slot', () => {
  it('gives every mapped element its HTML id, each used once, never inside a repeating group', () => {
    for (const [id, htmlId] of Object.entries(HTML_IDS)) expect(htmlIdOf(after[id]), id).toBe(htmlId);
    const withIds = all(themed).filter(({ node }) => htmlIdOf(node));
    const ids = withIds.map(({ node }) => htmlIdOf(node));
    expect(ids.length).toBe(new Set(ids).size);
    expect(withIds.filter(({ inList }) => inList).map(({ node }) => node.id)).toEqual([]);
    expect(ids.every((v) => /^bl-author-[a-z-]+$/.test(v))).toBe(true);
  });

  it('adds the theme layer as one HTML element at the end of the page', () => {
    const el = themed.elements[THEME_KEY];
    expect([el.type, el.id, el.properties.order, htmlIdOf(el)]).toEqual(['HTML', THEME_KEY, 5, THEME_HTML_ID]);
    expect(el.properties.html).toBe(THEME_HTML);
    expect(THEME_HTML).toContain('bl-login-theme');
    expect([el.properties.height, el.properties.min_height_css]).toEqual([0, '0px']);
    expect(Object.keys(themed.elements).filter((k) => !(k in BEFORE.elements))).toEqual([THEME_KEY]);
  });

  it('puts the sun/moon toggle at the right end of the top bar row and adds nothing else', () => {
    const row = byId(themed).db_bar_in;
    const toggle = row.elements[TOGGLE_KEY];
    expect([toggle.type, toggle.id, toggle.properties.order]).toEqual(['HTML', TOGGLE_KEY, TOGGLE_ORDER]);
    expect(toggle.properties.html).toContain('data-bl-theme-toggle');
    const orders = Object.values(row.elements).filter((e) => e?.type).map((e) => e.properties.order);
    expect(Math.max(...orders)).toBe(TOGGLE_ORDER);
    const added = Object.keys(byId(themed)).filter((id) => !(id in before)).sort();
    expect(added).toEqual([THEME_KEY, TOGGLE_KEY].sort());
  });
});

describe('author dashboard: source', () => {
  const files = (dir) => readdirSync(dir).flatMap((n) => {
    const p = new URL(n, dir);
    return statSync(p).isDirectory() ? files(new URL(`${n}/`, dir)) : [p];
  });
  const writers = ['write-author.mjs', 'restore-author.mjs'].map((f) => new URL(`scripts/editor/${f}`, ROOT));

  it('keeps every source file at 200 lines or fewer', () => {
    const long = [...files(new URL('./', import.meta.url)), ...writers].filter((p) => /\.(mjs|js)$/.test(p.pathname))
      .map((p) => [p.pathname.split('/bubble/')[1], readFileSync(p, 'utf8').split('\n').length]).filter(([, n]) => n > 200);
    expect(long).toEqual([]);
  });

  it('writer and restore never send workflows, custom states or page properties to Bubble', () => {
    for (const p of writers) {
      const src = readFileSync(p, 'utf8');
      expect(src, p.pathname).not.toMatch(/child\(\s*['"](workflows|custom_states|properties)['"]\s*\)/);
      expect(src, p.pathname).not.toMatch(/json\s*\.\s*set\(/);
    }
  });
});
