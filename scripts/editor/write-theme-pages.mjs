// Gives the two pages that have no generator (reset_pw and 404) the shared theme layer: fonts,
// light/dark tokens and a floating sun/moon toggle, as ONE added HTML element per page.
// Run: ego-browser nodejs < scripts/editor/write-theme-pages.mjs
// 1. Opens each page in the editor (Bubble loads a page's JSON only once it has been opened).
// 2. Backs the page JSON up to .secrets/ (git-ignored).
// 3. Adds the theme element under its own key; nothing else on the page is sent (not even the
//    page's own `length` key), then reads the page back and checks every other part is unchanged.
// Undo: set UNDO = true and run again; it removes the theme element and checks the rest again.
const UNDO = false;
const ROOT = '/Users/aksykmr_mac/Loop Methods/experiments/bookleaf/bubble';
const APP = 'bookleaf-royalties-81850';
const SAVE_WAIT_MS = 6000;
const { themeLayerElement } = await import(`${ROOT}/bubble-app/theme/layer.mjs`);
const { writeFileSync, mkdirSync } = await import('node:fs');

/** [editor page name, Bubble page id, key and id of the added theme element] */
const PAGES = [['reset_pw', 'AAL', 'rp_theme'], ['404', 'AAU', 'nf_theme']];

const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

const task = await taskSpace('bookleaf dashboard integrate');
const editor = task.page('p1');

async function openPage(name, id) {
  const url = `https://bubble.io/page?id=${APP}&tab=Design&name=${name}`;
  // goto() times out waiting for "load" in the editor, but the editor works; wait for the page JSON.
  await editor.goto(url, { timeout: 20_000 }).catch(() => {});
  await editor.waitForFunction(() => Boolean(window.appquery), undefined, { timeout: 90_000 });
  for (let i = 0; i < 60; i += 1) {
    const json = await editor.evaluate((pid) => { try { return window.appquery.page(pid).json.raw(); } catch { return null; } }, id);
    if (json?.elements) return json;
    await editor.waitForTimeout(1000);
  }
  throw new Error(`Page ${name} (${id}) did not load in the editor; nothing written`);
}

/** The theme element, placed after the page's last top-level element. */
function themeElement(live, key) {
  const orders = Object.values(live.elements).filter((e) => e?.type).map((e) => e.properties?.order ?? 0);
  const el = themeLayerElement(key, { floatingToggle: true });
  return { ...el, properties: { ...el.properties, order: Math.max(0, ...orders) + 1 } };
}

async function themePage([name, id, key], stamp) {
  const live = await openPage(name, id);
  mkdirSync(`${ROOT}/.secrets`, { recursive: true });
  writeFileSync(`${ROOT}/.secrets/${name}-page-backup-${stamp}.json`, JSON.stringify(live));
  const element = UNDO ? null : themeElement(live, key);
  await editor.evaluate(({ pid, k, el }) => {
    window.appquery.page(pid).json.child('elements').child(k).set(el);
  }, { pid: id, k: key, el: element });
  const written = await editor.evaluate((pid) => window.appquery.page(pid).json.raw(), id);
  await editor.waitForTimeout(SAVE_WAIT_MS); // let the editor save before it navigates away
  const { [key]: added, ...rest } = written.elements;
  const { [key]: _old, ...liveRest } = live.elements;
  const checks = {
    themeElement: UNDO ? added === undefined || added === null : stable(added) === stable(element),
    otherElements: stable(rest) === stable(liveRest),
    workflows: stable(written.workflows) === stable(live.workflows),
    pageProperties: stable(written.properties) === stable(live.properties),
  };
  return { page: name, backup: `.secrets/${name}-page-backup-${stamp}.json`, checks };
}

const stamp = Date.now();
const results = [];
for (const entry of PAGES) results.push(await themePage(entry, stamp));
console.log(JSON.stringify({ undo: UNDO, results }));
if (!results.every((r) => Object.values(r.checks).every(Boolean))) {
  throw new Error('A themed page differs from the expected result; restore it from its backup');
}
