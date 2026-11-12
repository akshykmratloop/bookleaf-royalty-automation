// Puts the author dashboard back as it was before the restyle.
// Run: ego-browser nodejs < scripts/editor/restore-author.mjs   (TaskSpace "author dashboard", p1 = editor)
// Restores ONLY the elements write-author.mjs changes (bar, main, statement popup) from the committed
// snapshot bubble-app/author/dashboard-before.json, and removes the theme element if it was added.
// Workflows, custom states and page properties were never changed, so they are left alone.
const ROOT = '/Users/aksykmr_mac/Loop Methods/experiments/bookleaf/bubble';
const { BEFORE, PAGE_ID, TOP_KEYS, THEME_KEY } = await import(`${ROOT}/bubble-app/author/page.mjs`);

const task = await taskSpace('author dashboard');
const editor = task.page('p1');
const EDITOR_URL = 'https://bubble.io/page?id=bookleaf-royalties-81850&tab=Design&name=dashboard';
// goto() times out waiting for "load" in the editor, but the editor works; wait for appquery instead.
if (!(await editor.url()).startsWith('https://bubble.io/page')) await editor.goto(EDITOR_URL, { timeout: 20_000 }).catch(() => {});
await editor.waitForFunction(() => Boolean(window.appquery), undefined, { timeout: 90_000 });

const parts = Object.fromEntries(Object.keys(TOP_KEYS).map((k) => [k, BEFORE.elements[k]]));
const result = await editor.evaluate(({ id, parts, themeKey }) => {
  const elements = window.appquery.page(id).json.child('elements');
  for (const [key, element] of Object.entries(parts)) elements.child(key).set(element);
  if (elements.child(themeKey).raw()) elements.child(themeKey).set(null);
  return Object.keys(elements.raw());
}, { id: PAGE_ID, parts, themeKey: THEME_KEY });
console.log(JSON.stringify({ restored: Object.keys(parts), topLevel: result }));
