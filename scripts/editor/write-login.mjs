// Writes the redesigned sign-in page (bubble-app/login/page.mjs) into the Bubble editor.
// Run: ego-browser nodejs < scripts/editor/write-login.mjs   (TaskSpace "bubble login concept 3", p1 = editor)
// 1. Backs up the live page JSON (to .secrets/, git-ignored, and to the bookleaf-work scratch folder).
// 2. Writes ONLY the page's one top-level element, `ix_split`. Page properties, workflows and custom
//    states are never sent; afterwards it checks that they are byte-for-byte what they were.
// Undo: ego-browser nodejs < scripts/editor/restore-login.mjs
const ROOT = '/Users/aksykmr_mac/Loop Methods/experiments/bookleaf/bubble';
const SCRATCH = '/Users/aksykmr_mac/Loop Methods/experiments/bookleaf-work/bubble-login';
const { buildLoginPage, PAGE_ID, SPLIT_KEY } = await import(`${ROOT}/bubble-app/login/page.mjs`);
const { writeFileSync, mkdirSync } = await import('node:fs');

/** JSON with sorted keys, so two objects compare equal regardless of key order. */
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

const task = await taskSpace('bubble login concept 3');
const editor = task.page('p1');
await editor.waitForFunction(() => Boolean(window.appquery), undefined, { timeout: 60_000 });
const readPage = () => editor.evaluate((id) => window.appquery.page(id).json.raw(), PAGE_ID);

const live = await readPage();
if (!live?.elements?.[SPLIT_KEY]) throw new Error(`Editor has no ${SPLIT_KEY} on page ${PAGE_ID}; nothing written`);
const stamp = Date.now();
for (const dir of [`${ROOT}/.secrets`, SCRATCH]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/index-page-backup-${stamp}.json`, JSON.stringify(live));
}

const built = buildLoginPage(live);
await editor.evaluate(({ id, key, split }) => {
  window.appquery.page(id).json.child('elements').child(key).set(split);
}, { id: PAGE_ID, key: SPLIT_KEY, split: built.elements[SPLIT_KEY] });

const written = await readPage();
const checks = {
  split: stable(written.elements[SPLIT_KEY]) === stable(built.elements[SPLIT_KEY]),
  workflows: stable(written.workflows) === stable(live.workflows),
  customStates: stable(written.custom_states) === stable(live.custom_states),
  pageProperties: stable(written.properties) === stable(live.properties),
};
console.log(JSON.stringify({ backup: `index-page-backup-${stamp}.json`, sceneChars: built.elements[SPLIT_KEY].elements.ix_scene.properties.html.length, checks }));
if (!Object.values(checks).every(Boolean)) throw new Error('Written page differs from the expected result; run restore-login.mjs');
