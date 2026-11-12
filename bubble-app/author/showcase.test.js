// Checks the author showcase before it is written into Bubble: it adds exactly two HTML elements,
// changes only layout properties, carries no money figure of its own, and its page script parses.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { BEFORE, THEME_HTML, buildAuthorPage } from './page.mjs';
import {
  SHELF_KEY, SHELF_HTML_ID, SHELF_ORDER, SCENE_KEY, SCENE_HTML_ID, SHOWCASE_LAYOUT,
  withShowcase, sceneHtml, shelfMarkup, showcaseJs, artCss, sceneFiles,
} from './showcase.mjs';

const base = buildAuthorPage(BEFORE, THEME_HTML, { showcase: false });
const page = buildAuthorPage(); // the page the writer sends

const flat = (node, out = []) => {
  if (!node || typeof node !== 'object' || !node.type) return out;
  out.push(node);
  Object.values(node.elements ?? {}).forEach((c) => flat(c, out));
  return out;
};
const byId = (p) => Object.fromEntries(Object.values(p.elements).flatMap((e) => flat(e)).map((n) => [n.id, n]));
const [b, a] = [byId(base), byId(page)];
const htmlId = (e) => e.properties.unique_id?.entries?.[0];

describe('author showcase: Bubble page', () => {
  it('adds only the shelf (last in the header) and the scene element', () => {
    expect(Object.keys(a).filter((id) => !(id in b)).sort()).toEqual([SCENE_KEY, SHELF_KEY].sort());
    expect(Object.keys(page.elements).filter((k) => !(k in base.elements))).toEqual([SCENE_KEY]);
    const hdr = a.db_hdr;
    expect(hdr.elements[SHELF_KEY].type).toBe('HTML');
    expect(hdr.elements[SHELF_KEY].properties.order).toBe(SHELF_ORDER);
    const orders = Object.values(hdr.elements).filter((e) => e?.type).map((e) => e.properties.order);
    expect(Math.max(...orders)).toBe(SHELF_ORDER);
    expect([htmlId(a[SHELF_KEY]), htmlId(a[SCENE_KEY])]).toEqual([SHELF_HTML_ID, SCENE_HTML_ID]);
  });

  it('keeps workflows, custom states, page properties and every other element as they were', () => {
    expect(page.workflows).toEqual(BEFORE.workflows);
    expect(page.custom_states).toEqual(BEFORE.custom_states);
    expect(page.properties).toEqual(BEFORE.properties);
    for (const [id, el] of Object.entries(b)) {
      const props = { ...a[id].properties };
      for (const key of Object.keys(SHOWCASE_LAYOUT[id] ?? {})) props[key] = el.properties[key];
      expect(props, id).toEqual(el.properties);
      expect(a[id].states, id).toEqual(el.states);
    }
  });

  it('changes layout keys only, on elements that exist', () => {
    for (const [id, props] of Object.entries(SHOWCASE_LAYOUT)) {
      expect(b[id], id).toBeTruthy();
      for (const key of Object.keys(props)) expect(key).toMatch(/^(columns|container_horiz_alignment|font_alignment)$/);
      expect(a[id].properties).toMatchObject(props);
    }
  });

  it('gives every HTML id once, in the bl-author- family', () => {
    const ids = Object.values(a).map(htmlId).filter(Boolean);
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids.every((v) => /^bl-author-[a-z-]+$/.test(v))).toBe(true);
  });

  it('is the same when built again from the written page, and buildAuthorPage adds it', () => {
    expect(withShowcase(page)).toEqual(page);
    expect(buildAuthorPage(page)).toEqual(page);
    expect(withShowcase(base)).toEqual(page);
  });
});

describe('author showcase: content', () => {
  const scene = sceneHtml();
  const all = scene + shelfMarkup();

  it('holds no money figure of its own: every amount is read from the page', () => {
    const data = JSON.parse(readFileSync(new URL('../../data/bookleaf_sample_data.json', import.meta.url), 'utf8'));
    const amounts = data.authors.flatMap((x) => x.books).flatMap((bk) => [bk.total_royalty_earned, bk.royalty_paid, bk.royalty_pending]).filter((n) => n >= 1000);
    for (const n of amounts) {
      expect(all.includes(n.toLocaleString('en-IN')), String(n)).toBe(false);
      expect(new RegExp(`\\b${n}\\b`).test(all), String(n)).toBe(false);
    }
    expect(all).not.toMatch(/₹\s?\d/);
  });

  it('builds a script that parses, runs once per page view and reads the rendered elements', () => {
    const script = scene.match(/<script>([\s\S]*)<\/script>/)[1];
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('window.__blAuthorScene');
    for (const cls of ['db_rt_tbl_w_row', 'db_bk_card', 'db_k_paid_v', 'db_st_row']) expect(script).toContain(cls);
  });

  it('reuses the login art (spines, covers) instead of a copy', () => {
    expect(showcaseJs()).toContain('function coverHTML');
    expect(artCss()).toContain(':is(.bl-shelf, .bl-thumb) .sp-art');
    expect(artCss()).toContain(':is(.bl-shelf, .bl-thumb) .cover');
  });

  it('respects reduced motion and pauses its loop when the tab is hidden', () => {
    expect(scene).toContain('prefers-reduced-motion');
    expect(scene).toContain('visibilitychange');
    expect(scene).toMatch(/document\.hidden/);
  });

  it('keeps every scene file, CSS included, at 200 lines or fewer', () => {
    const files = [...sceneFiles('css', '.css'), ...sceneFiles('js', '.js')];
    expect(files.filter((f) => f.source.split('\n').length > 200).map((f) => f.name)).toEqual([]);
    expect(readdirSync(new URL('./scene/', import.meta.url))).toContain('shelf.html');
  });
});

describe('author showcase: helpers', () => {
  const src = sceneFiles('js', '.js').filter((f) => /^0[12]/.test(f.name)).map((f) => f.source).join('\n');
  const stub = { documentElement: { dataset: {} } };
  const h = new Function('window', 'document', `${src}; return { amount, titleKey, dayOf, toneOf };`)({}, stub);

  it('reads amounts the way Bubble shows them', () => {
    expect(h.amount('₹1,23,456')).toBe(123456);
    expect(h.amount('₹0')).toBe(0);
    expect(h.amount('')).toBeNull();
    expect(h.amount('₹')).toBeNull();
  });

  it('matches titles loosely and reads the payout date', () => {
    expect(h.titleKey('Durga’s  Daughters')).toBe(h.titleKey("durga's daughters"));
    expect(h.dayOf('by 14 Feb 2027')).toEqual(new Date(2027, 1, 14));
    expect(h.dayOf('by soon')).toBeNull();
    expect([h.toneOf('Fully paid'), h.toneOf('Overdue'), h.toneOf('Pending')]).toEqual(['paid', 'overdue', 'pending']);
  });
});
