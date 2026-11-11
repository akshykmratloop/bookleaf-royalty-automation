// Writes the generated admin page (bubble-app/admin/page.mjs) into the Bubble editor.
// Run: ego-browser nodejs < scripts/editor/write-admin.mjs   (editor open on any page of the app)
// Keeps the page's logout and role-guard workflows; replaces everything else it owns.
// Until the "Approve draft" API call exists (API.approve still holds its placeholder id), the
// workflows that use it are left out so the editor never stores an unknown action type.
const ROOT = '/Users/aksykmr_mac/Loop Methods/experiments/bookleaf/bubble';
const BACKUP_DIR = `${ROOT}/.secrets`; // gitignored
const { buildAdminPage, MAIN_GROUP_KEY, PAGE_PROPS, REMOVED_KEYS } = await import(`${ROOT}/bubble-app/admin/page.mjs`);
const { API } = await import(`${ROOT}/bubble-app/admin/workflows/actions.mjs`);
const { writeFileSync } = await import('node:fs');

const built = buildAdminPage();
const pending = API.approve.endsWith('APPROVE_CALL_ID');
const workflows = pending ? built.workflows.filter((w) => !JSON.stringify(w).includes('APPROVE_CALL_ID')) : built.workflows;

const task = await taskSpace('bubble royalty app build');
const page = task.page('p1');

const before = await page.evaluate(() => window.appquery.page('admin').json.raw());
writeFileSync(`${BACKUP_DIR}/admin-page-backup-${Date.now()}.json`, JSON.stringify(before));

const result = await page.evaluate(({ built, workflows, key, pageProps, removed }) => {
  const j = window.appquery.page('admin').json;
  j.child('properties').set({ ...(j.child('properties').raw() ?? {}), ...pageProps });
  for (const k of removed) if (j.child('elements').child(k).raw()) j.child('elements').child(k).set(null);
  const side = { ...built.side, properties: { ...built.side.properties, order: 1 } };
  j.child('elements').child(side.id).set(side);
  const main = j.child('elements').child(key);
  main.child('properties').set({ ...(main.child('properties').raw() ?? {}), ...built.mainProps, order: 2 });
  main.child('elements').set(built.mainChildren);
  for (const p of built.popups) j.child('elements').child(p.id).set(p);
  j.child('custom_states').set(built.customStates);
  const keep = new Set(['bTGMk', 'bTGMl', 'bTGMm']); // logout + two role guards
  const wfs = j.child('workflows').raw() ?? {};
  for (const k of Object.keys(wfs)) if (!keep.has(k)) j.child('workflows').child(k).set(null);
  for (const wf of workflows) j.child('workflows').child(wf.id).set(wf);
  return { workflows: Object.keys(j.child('workflows').raw()).length, top: Object.keys(j.child('elements').raw()) };
}, { built, workflows, key: MAIN_GROUP_KEY, pageProps: PAGE_PROPS, removed: REMOVED_KEYS });
console.log(JSON.stringify({ ...result, approveWorkflowsSkipped: built.workflows.length - workflows.length }));
