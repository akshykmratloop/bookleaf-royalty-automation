// End-to-end check of the author portal: logs in as every author and compares what the page
// shows with what the tested logic in n8n/src computes from the dataset.
// Run: ego-browser nodejs < tests/e2e/run-author-portal.mjs (see that file).
import { readFile } from 'node:fs/promises';
import { buildFacts } from '../../n8n/src/facts.js';
import { formatInr } from '../../n8n/src/money.js';
import { bundleFromSample } from '../../n8n/src/normalize.js';
import { BADGE_LABELS } from '../../n8n/src/badge.js';

const ROOT = new URL('../../', import.meta.url);
const PASSWORD = 'TestBookLeaf@123';

export async function loadDataset() {
  return JSON.parse(await readFile(new URL('data/bookleaf_sample_data.json', ROOT), 'utf8'));
}

/** What the dashboard should show for one author at the reference date. */
export function expectedFor(author, referenceDate) {
  const facts = buildFacts(bundleFromSample(author), referenceDate);
  const published = facts.books.filter((b) => b.badge !== 'NONE');
  return {
    earned: formatInr(facts.totals.earned),
    paid: formatInr(facts.totals.paid),
    pending: formatInr(facts.totals.pending),
    badges: Object.fromEntries(published.map((b) => [b.title, BADGE_LABELS[b.badge]])),
    titles: facts.books.map((b) => b.title),
  };
}

async function login(page, base, email) {
  await page.goto(`${base}/index`, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500); // let the index page's redirect for a logged-in user run
  // A signed-in author lands on /dashboard, an admin on /admin: log out of either first.
  if (/dashboard|admin/.test(await page.url())) {
    await page.click('text="Log out"', { label: 'log out' });
    await page.waitForURL((u) => !/dashboard|admin/.test(String(u)), { timeout: 30000 });
    await page.waitForTimeout(3000); // logout navigation settles before typing
  }
  await page.waitForSelector('css=input[type=email]', { timeout: 30000 });
  await page.fill('css=input[type=email]', email);
  await page.fill('css=input[type=password]', PASSWORD);
  await page.click('loc=role:button[name="Sign in"]', { label: 'sign in' });
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes('Royalty overview'), undefined, { timeout: 30000 });
  // KPIs fill in after the searches return: wait for a rupee figure, not a fixed delay.
  await page.waitForFunction(() => /TOTAL EARNED\s*₹\d/.test(document.body.innerText), undefined, { timeout: 30000 });
  await page.waitForTimeout(1500);
}

/** Reads KPIs and each royalty row's title → status from the page text. */
async function readDashboard(page, titles) {
  const text = await page.evaluate(() => document.body.innerText);
  const after = (label) => text.split(label)[1]?.trim().split('\n')[0]?.trim();
  const badges = {};
  const overview = text.split('Royalty overview')[1]?.split('My books')[0] ?? '';
  const lines = overview.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const t of titles) {
    const i = lines.indexOf(t);
    if (i >= 0) badges[t] = lines.slice(i, i + 8).find((l) => Object.values(BADGE_LABELS).includes(l));
  }
  const otherTitlesVisible = text;
  const statements = text.split('My statements')[1] ?? '';
  const statementCount = (statements.match(/\bView\b/g) ?? []).length;
  return { earned: after('TOTAL EARNED'), paid: after('PAID'), pending: after('PENDING'), badges, otherTitlesVisible, statementCount, statements };
}

export async function checkAuthor(page, base, author, referenceDate, allTitles) {
  await login(page, base, author.email);
  const want = expectedFor(author, referenceDate);
  const got = await readDashboard(page, Object.keys(want.badges));
  const problems = [];
  for (const k of ['earned', 'paid', 'pending']) if (got[k] !== want[k]) problems.push(`${k}: want ${want[k]} got ${got[k]}`);
  for (const [t, b] of Object.entries(want.badges)) if (got.badges[t] !== b) problems.push(`${t}: want ${b} got ${got.badges[t]}`);
  const leaked = allTitles.filter((t) => !want.titles.includes(t) && got.otherTitlesVisible.includes(t));
  if (leaked.length) problems.push(`PRIVACY: sees other authors' books: ${leaked.join(', ')}`);
  for (const t of want.titles) if (!got.otherTitlesVisible.includes(t)) problems.push(`missing own book: ${t}`);
  // Every demo author with money pending has been sent at least one summary, so an empty list means
  // the statements search (or its privacy rule) is broken. Drafts must never reach an author.
  if (want.pending !== '₹0' && got.statementCount === 0) problems.push('statements list is empty although summaries were sent');
  if (/Draft ready|Discarded/.test(got.statements)) problems.push('PRIVACY: a draft or discarded email is visible to the author');
  return { author: author.author_id, ok: problems.length === 0, problems };
}
