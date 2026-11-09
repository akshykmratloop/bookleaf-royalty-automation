// Read rows of the editor's App data table (Handsontable) through each row's edit panel.
import { sleep } from './dom.mjs';

/** Pencil-icon positions of the visible table rows. */
async function rowPencils(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('table.htCore tbody tr')]
      .filter((r) => r.getClientRects().length && r.innerText.trim())
      .map((r) => {
        // The pencil sits just left of the "Run as" / first data cell.
        const cell = r.querySelectorAll('td')[1];
        const b = cell.getBoundingClientRect();
        return { x: b.x - 18, y: b.y + b.height / 2 };
      }),
  );
}

/** Values of the open "Modify an existing database entry" panel, keyed by their row label. */
async function readEntryPanel(page) {
  return page.evaluate(() => {
    const panel = [...document.querySelectorAll('div')].find(
      (d) => d.getClientRects().length && d.innerText.startsWith('Modify an existing database entry'),
    );
    if (!panel) return {};
    const out = {};
    for (const input of panel.querySelectorAll('input, select')) {
      // Walk up until an ancestor also contains the label text for this input.
      let row = input.parentElement;
      while (row && row !== panel && !row.innerText.trim()) row = row.parentElement;
      const label = row?.innerText.split('\n')[0].trim();
      if (label && !(label in out)) out[label] = input.value ?? '';
    }
    return out;
  });
}

/** Every visible row's panel values (e.g. { Email, 'Unique id', ... }). */
export async function readAllRows(page) {
  const rows = [];
  const pencils = await rowPencils(page);
  for (const p of pencils) {
    await page.mouse.click(p.x, p.y, { label: 'open row editor' });
    await page.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => d.getClientRects().length && d.innerText.startsWith('Modify an existing database entry')), undefined, { timeout: 8000 });
    rows.push(await readEntryPanel(page));
    // The panel's Cancel is lowercase text styled as uppercase; use its class.
    await page.evaluate(() => document.querySelector('.btn.btn-cancel')?.click());
    await sleep(page, 2000);
  }
  return rows;
}
