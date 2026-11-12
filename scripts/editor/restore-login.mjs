// Puts the sign-in page back as it was before the Living Bookshelf redesign.
// Run: ego-browser nodejs < scripts/editor/restore-login.mjs   (TaskSpace "bubble login concept 3", p1 = editor)
// Restores ONLY the element write-login.mjs changes (`ix_split`, with the old left panel inside it),
// from the committed snapshot bubble-app/login/index-before.json. Workflows, custom states and page
// properties were never changed, so they are left alone.
const ROOT = '/Users/aksykmr_mac/Loop Methods/experiments/bookleaf/bubble';
const { BEFORE, PAGE_ID, SPLIT_KEY } = await import(`${ROOT}/bubble-app/login/page.mjs`);

const task = await taskSpace('bubble login concept 3');
const editor = task.page('p1');
await editor.waitForFunction(() => Boolean(window.appquery), undefined, { timeout: 60_000 });

const result = await editor.evaluate(({ id, key, split }) => {
  const elements = window.appquery.page(id).json.child('elements');
  elements.child(key).set(split);
  return Object.keys(elements.child(key).raw().elements);
}, { id: PAGE_ID, key: SPLIT_KEY, split: BEFORE.elements[SPLIT_KEY] });
console.log(JSON.stringify({ restored: SPLIT_KEY, children: result }));
