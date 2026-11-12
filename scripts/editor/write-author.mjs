// Writes the restyled author dashboard (bubble-app/author/page.mjs) into the Bubble editor.
// Run: ego-browser nodejs < scripts/editor/write-author.mjs
//   (TaskSpace "author dashboard", p1 = the editor on https://bubble.io/page?id=bookleaf-royalties-81850&tab=Design&name=dashboard)
// 1. Backs up the live page JSON (to .secrets/, git-ignored, and to the bookleaf-work scratch folder).
// 2. Writes ONLY the three top-level elements it restyles (bar, main, statement popup) and, when the
//    theme layer is wired in, adds the theme element. Page properties, workflows and custom states are
//    never sent; afterwards it checks that they are byte-for-byte what they were.
// Undo: ego-browser nodejs < scripts/editor/restore-author.mjs
const ROOT = '/Users/aksykmr_mac/Loop Methods/experiments/bookleaf/bubble';
const SCRATCH = '/Users/aksykmr_mac/Loop Methods/experiments/bookleaf-work/dashboard/author';
const { buildAuthorPage, PAGE_ID, TOP_KEYS, THEME_KEY } = await import(`${ROOT}/bubble-app/author/page.mjs`);
const { writeFileSync, mkdirSync } = await import('node:fs');

/** JSON with sorted keys, so two objects compare equal regardless of key order. */
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

const task = await taskSpace('author dashboard');
const editor = task.page('p1');
const EDITOR_URL = 'https://bubble.io/page?id=bookleaf-royalties-81850&tab=Design&name=dashboard';
// goto() times out waiting for "load" in the editor, but the editor works; wait for appquery instead.
if (!(await editor.url()).startsWith('https://bubble.io/page')) await editor.goto(EDITOR_URL, { timeout: 20_000 }).catch(() => {});
await editor.waitForFunction(() => Boolean(window.appquery), undefined, { timeout: 90_000 });
const readPage = () => editor.evaluate((id) => window.appquery.page(id).json.raw(), PAGE_ID);

const live = await readPage();
for (const [key, id] of Object.entries(TOP_KEYS)) {
  if (live?.elements?.[key]?.id !== id) throw new Error(`Editor has no ${id} at ${key} on page ${PAGE_ID}; nothing written`);
}
const stamp = Date.now();
for (const dir of [`${ROOT}/.secrets`, SCRATCH]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/dashboard-page-backup-${stamp}.json`, JSON.stringify(live));
}

const built = buildAuthorPage(live);
const keys = [...Object.keys(TOP_KEYS), ...(built.elements[THEME_KEY] ? [THEME_KEY] : [])];
const parts = Object.fromEntries(keys.map((k) => [k, built.elements[k]]));
await editor.evaluate(({ id, parts }) => {
  const elements = window.appquery.page(id).json.child('elements');
  for (const [key, element] of Object.entries(parts)) elements.child(key).set(element);
}, { id: PAGE_ID, parts });

const written = await readPage();
const checks = {
  ...Object.fromEntries(keys.map((k) => [k, stable(written.elements[k]) === stable(built.elements[k])])),
  untouched: Object.keys(live.elements).filter((k) => !keys.includes(k))
    .every((k) => stable(written.elements[k]) === stable(live.elements[k])),
  workflows: stable(written.workflows) === stable(live.workflows),
  customStates: stable(written.custom_states) === stable(live.custom_states),
  pageProperties: stable(written.properties) === stable(live.properties),
};
console.log(JSON.stringify({ backup: `dashboard-page-backup-${stamp}.json`, wrote: keys, checks }));
if (!Object.values(checks).every(Boolean)) throw new Error('Written page differs from the expected result; run restore-author.mjs');
