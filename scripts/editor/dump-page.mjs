// Read-only: saves the index, dashboard and admin pages' JSON from the Bubble editor to .secrets/
// and prints a summary of each (element tree, custom states, workflows). It writes nothing to Bubble.
// Run: ego-browser nodejs < scripts/editor/dump-page.mjs   (the editor open in page p1 of the task space)
// ego-browser passes scripts no argv or env, so it always dumps all three pages.
const ROOT = '/Users/aksykmr_mac/Loop Methods/experiments/bookleaf/bubble';
const DUMP_DIR = `${ROOT}/.secrets`; // gitignored
const PAGES = ['index', 'dashboard', 'admin'];
const { summarizePage } = await import(`${ROOT}/scripts/editor/page-summary.mjs`);
const { writeFileSync } = await import('node:fs');

const task = await taskSpace('bubble royalty app build');
const editor = task.page('p1');
await editor.waitForFunction(() => typeof window.appquery?.get_page_by_name === 'function', undefined, { timeout: 120000 });

const stamp = Date.now();
for (const name of PAGES) {
  // Pages are looked up by name: appquery.page() takes the page id, and index's id is not "index".
  const raw = await editor.evaluate((n) => window.appquery.get_page_by_name(n)?.json?.raw() ?? null, name);
  if (!raw) throw new Error(`No page named "${name}" in the editor`);
  const file = `${DUMP_DIR}/${name}-page-dump-${stamp}.json`;
  writeFileSync(file, JSON.stringify(raw));
  console.log(summarizePage(name, raw, file));
}
