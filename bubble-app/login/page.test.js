// Checks the redesigned sign-in page before it is written into Bubble: the native sign-in (elements,
// conditions, 8 workflows, 2 custom states) must be exactly as before, and the scene must be safe to ship.
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { BEFORE, HTML_IDS, REMOVED_KEYS, SCENE_ID, SPLIT_KEY, TEXTS, buildLoginPage } from './page.mjs';
import { GSAP_URL } from './scene.mjs';

const ROOT = new URL('../../', import.meta.url);
const page = buildLoginPage();
const scene = page.elements[SPLIT_KEY].elements[SCENE_ID].properties.html;
const DEMO_LOGINS = ['priya.sharma@email.com', 'admin@bookleaf.demo'];
const DEMO_PASSWORD = 'TestBookLeaf@123';

/** Every element under a node, as a flat list (the node itself first). */
function flatten(node, out = []) {
  if (!node || typeof node !== 'object') return out; // Bubble's array-like `length` keys
  out.push(node);
  Object.values(node.elements ?? {}).forEach((child) => flatten(child, out));
  return out;
}
const byId = (root) => Object.fromEntries(Object.values(root.elements).flatMap((e) => flatten(e)).map((e) => [e.id, e]));
const before = byId(BEFORE);
const after = byId(page);
const removed = new Set(REMOVED_KEYS.flatMap((k) => flatten(BEFORE.elements[SPLIT_KEY].elements[k]).map((e) => e.id)));
const kept = Object.keys(before).filter((id) => !removed.has(id));
const htmlIdOf = (e) => e.properties.unique_id?.entries?.[0];

describe('sign-in page: native sign-in unchanged', () => {
  it('keeps all 8 workflows exactly', () => {
    const real = (w) => Object.fromEntries(Object.entries(w).filter(([k]) => k !== 'length'));
    expect(Object.keys(real(page.workflows))).toHaveLength(8);
    expect(page.workflows).toEqual(BEFORE.workflows);
  });

  it('keeps both custom states and the page properties exactly', () => {
    expect(Object.keys(page.custom_states).sort()).toEqual(['busy', 'err']);
    expect(page.custom_states).toEqual(BEFORE.custom_states);
    expect(page.properties).toEqual(BEFORE.properties);
  });

  it('keeps every native element, with its type, style and conditions', () => {
    for (const id of kept) {
      expect(after[id], id).toBeDefined();
      expect([after[id].type, after[id].style, after[id].states]).toEqual([before[id].type, before[id].style, before[id].states]);
    }
  });

  it('keeps every native element property except layout, the two card texts and the HTML id', () => {
    const changeable = new Set(['unique_id', 'text', 'min_height_css', 'fit_height', 'use_gap', 'column_gap', 'vert_alignment',
      'fit_width', 'single_width', 'width', 'min_width_css', 'max_width_css', 'padding_top', 'padding_left', 'padding_right',
      'padding_bottom', 'container_vert_alignment', 'horiz_alignment', 'row_gap']);
    for (const id of kept) {
      for (const [prop, value] of Object.entries(before[id].properties)) {
        if (changeable.has(prop) && (prop !== 'text' || TEXTS[id])) continue;
        expect(after[id].properties[prop], `${id}.${prop}`).toEqual(value);
      }
    }
  });

  it('removes only the old left panel and adds the scene in its place', () => {
    const top = Object.keys(page.elements[SPLIT_KEY].elements);
    expect(top).toEqual([SCENE_ID, 'ix_right']);
    expect(Object.keys(after).filter((id) => !before[id])).toEqual([SCENE_ID]);
    expect(page.elements[SPLIT_KEY].elements[SCENE_ID].properties.order).toBe(1);
  });

  it('sets the card texts from the concept', () => {
    expect(after.ix_title.properties.text.entries[0]).toBe('Welcome back');
    expect(after.ix_sub.properties.text.entries[0]).toBe('Sign in to your author dashboard.');
  });

  it('is the same when built again from the written page', () => {
    expect(buildLoginPage(page)).toEqual(page);
  });
});

describe('sign-in page: HTML ids', () => {
  it('gives every mapped element its HTML id', () => {
    for (const [id, htmlId] of Object.entries(HTML_IDS)) expect(htmlIdOf(after[id]), id).toBe(htmlId);
  });

  it('uses each HTML id once', () => {
    const ids = Object.values(after).map(htmlIdOf).filter(Boolean);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('uses only ids the scene can rely on (bl- prefix)', () => {
    expect(Object.values(HTML_IDS).every((v) => /^bl-[a-z-]+$/.test(v))).toBe(true);
  });
});

describe('sign-in page: scene content', () => {
  const scripts = [...scene.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];

  it('has scene JS that parses', () => {
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, , code] of scripts) expect(() => new vm.Script(code)).not.toThrow();
  });

  it('loads external scripts only from cdnjs, with an exact version', () => {
    const pinned = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/[\w.-]+\/\d+\.\d+\.\d+\/[\w./-]+\.js$/;
    const srcs = [...scene.matchAll(/(?:\bsrc\s*=\s*|\.src\s*=\s*)["']([^"']+)["']/g)].map((m) => m[1]);
    expect(srcs).toEqual([GSAP_URL]);
    expect(srcs.every((s) => pinned.test(s))).toBe(true);
    for (const [, attrs] of scripts) expect(attrs.trim()).toBe('');
  });

  it('links only to Google Fonts, cdnjs, the BookLeaf site and the SVG namespace', () => {
    const allowed = /^https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|(www\.)?bookleafpub\.in|www\.w3\.org)(\/|$)/;
    const urls = [...scene.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)].map((m) => m[0]);
    expect(urls.filter((u) => !allowed.test(u))).toEqual([]);
  });

  it('shows no sample-data author email or phone except the documented demo logins', () => {
    const { authors } = JSON.parse(readFileSync(new URL('data/bookleaf_sample_data.json', ROOT), 'utf8'));
    const found = [];
    for (const a of authors) {
      if (!DEMO_LOGINS.includes(a.email) && scene.includes(a.email)) found.push(a.email);
      const digits = a.phone.replace(/\D/g, '');
      if (scene.includes(a.phone) || scene.replace(/\D/g, ' ').split(' ').includes(digits)) found.push(a.author_id);
    }
    expect(found).toEqual([]);
  });

  it('never carries the demo password (the typewriter types a masked stand-in)', () => {
    expect(scene.includes(DEMO_PASSWORD)).toBe(false);
  });

  it('targets the native card only through the agreed HTML ids', () => {
    const used = new Set([...scene.matchAll(/#(bl-(?:split|right|card|title|sub|email|pw|signin|err|demo)[a-z-]*)/g)].map((m) => m[1]));
    const known = new Set(Object.values(HTML_IDS));
    const unknownNative = [...used].filter((id) => !known.has(id) && /^bl-(split|right|title|sub|signin|err)/.test(id));
    expect(unknownNative).toEqual([]);
  });
});

describe('sign-in page: source size', () => {
  const files = (dir) => readdirSync(dir).flatMap((n) => {
    const p = new URL(n, dir);
    return statSync(p).isDirectory() ? files(new URL(`${n}/`, dir)) : [p];
  });

  it('keeps every source file at 200 lines or fewer', () => {
    const sources = [...files(new URL('./', import.meta.url)), new URL('scripts/editor/write-login.mjs', ROOT), new URL('scripts/editor/restore-login.mjs', ROOT)]
      .filter((p) => /\.(mjs|js|css|html)$/.test(p.pathname));
    const long = sources.map((p) => [p.pathname.split('/bubble/')[1], readFileSync(p, 'utf8').split('\n').length])
      .filter(([, n]) => n > 200);
    expect(long).toEqual([]);
  });

  it('writer never sends workflows or custom states to Bubble', () => {
    for (const f of ['write-login.mjs', 'restore-login.mjs']) {
      const src = readFileSync(new URL(`scripts/editor/${f}`, ROOT), 'utf8');
      expect(src, f).not.toMatch(/child\(\s*['"](workflows|custom_states)['"]\s*\)/);
      expect(src, f).not.toMatch(/json\s*\.\s*set\(/);
    }
  });
});
