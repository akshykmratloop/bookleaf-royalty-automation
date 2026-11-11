// ego-browser entry point: `ego-browser nodejs < tests/e2e/run-author-portal.mjs`
// (runs in ego-browser's Node runtime, where taskSpace() is a global).
const BASE = 'https://bookleaf-royalties-81850.bubbleapps.io/version-test';
const REFERENCE_DATE = '2025-12-31';
const lib = await import('/Users/aksykmr_mac/Loop Methods/experiments/bookleaf/bubble/tests/e2e/author-portal.mjs');

const data = await lib.loadDataset();
const allTitles = data.authors.flatMap((a) => a.books.map((b) => b.title));
const task = await taskSpace('bubble royalty app build');
const page = task.page('p2');
const results = [];
for (const author of data.authors) {
  try {
    results.push(await lib.checkAuthor(page, BASE, author, REFERENCE_DATE, allTitles));
  } catch (e) {
    results.push({ author: author.author_id, ok: false, problems: [`error: ${e.message.slice(0, 160)}`] });
  }
}
console.log(JSON.stringify(results, null, 1));
console.log(`PASS ${results.filter((r) => r.ok).length}/${results.length}`);
