// Writes the generated admin page (bubble-app/admin/page.mjs) into the Bubble editor.
// Run: ego-browser nodejs < scripts/editor/write-admin.mjs   (editor open on any page of the app)
// Keeps the page's top bar, logout and role-guard workflows; replaces everything else it owns.
const ROOT = '/Users/aksykmr_mac/Loop Methods/experiments/bookleaf/bubble';
const BACKUP_DIR = `${ROOT}/.secrets`; // gitignored
const { buildAdminPage, MAIN_GROUP_KEY, MAIN_PROPS } = await import(`${ROOT}/bubble-app/admin/page.mjs`);
const { writeFileSync } = await import('node:fs');

const built = buildAdminPage();
const task = await taskSpace('bubble royalty app build');
const page = task.page('p1');

const before = await page.evaluate(() => window.appquery.page('admin').json.raw());
writeFileSync(`${BACKUP_DIR}/admin-page-backup-${Date.now()}.json`, JSON.stringify(before));

const result = await page.evaluate(({ built, key, props }) => {
  const j = window.appquery.page('admin').json;
  const main = j.child('elements').child(key);
  const oldProps = main.child('properties').raw() ?? {};
  main.child('properties').set({ ...oldProps, ...props });
  main.child('elements').set(built.mainChildren);
  for (const p of built.popups) j.child('elements').child(p.id).set(p);
  j.child('custom_states').set(built.customStates);
  const keep = new Set(['bTGMk', 'bTGMl', 'bTGMm']); // logout + two role guards
  const wfs = j.child('workflows').raw() ?? {};
  for (const k of Object.keys(wfs)) if (!keep.has(k)) j.child('workflows').child(k).set(null);
  for (const wf of built.workflows) j.child('workflows').child(wf.id).set(wf);
  return { workflows: Object.keys(j.child('workflows').raw()).length, top: Object.keys(j.child('elements').raw()) };
}, { built, key: MAIN_GROUP_KEY, props: MAIN_PROPS });
console.log(JSON.stringify(result));
