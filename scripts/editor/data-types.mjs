// Create Bubble data types and fields through the editor's Data tab.
import { clickExactText, dialogControls, sleep } from './dom.mjs';

/** Open Data → Data types. */
export async function openDataTypes(page) {
  await page.click('loc=css:button[aria-label="Data"]', { label: 'open data tab' });
  await sleep(page, 1200);
  await clickExactText(page, 'Data types');
  await sleep(page, 1200);
}

/** Names of the fields already on the selected type. */
export async function existingFields(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.field-type')].map((e) => {
      const row = e.parentElement;
      const input = row?.querySelector('input');
      const label = input ? input.value : row?.firstElementChild?.textContent;
      return { name: (label ?? '').trim(), type: e.textContent.trim() };
    }),
  );
}

/** Create a data type if missing, then select it. */
export async function ensureType(page, name, { isPrivate = true } = {}) {
  const exists = await page.evaluate(
    (n) => [...document.querySelectorAll('*')].some((e) => e.children.length === 0 && e.textContent.trim() === n),
    name,
  );
  if (!exists) {
    await page.fill('loc=css:input[name][class]:near(text="New type")', name).catch(async () => {
      const box = await dialogControls(page, ['New type', 'Create']);
      await page.mouse.click(box.inputs[0].x, box.inputs[0].y);
      await page.keyboard.type(name);
    });
    if (isPrivate) {
      const box = await dialogControls(page, ['Make this data type private by default']);
      const p = box.named['Make this data type private by default'];
      // The toggle sits at the right end of the same row.
      await page.mouse.click(p.x + 220, p.y);
    }
    await clickExactText(page, 'Create');
    await sleep(page, 2000);
  }
  await clickExactText(page, name);
  await sleep(page, 1200);
}

/** Add one field to the selected type: type label as shown in the dropdown (e.g. "text", "Author"). */
export async function addField(page, { name, type, list = false }) {
  const have = await existingFields(page);
  if (have.some((f) => f.name === name)) return 'exists';
  await clickExactText(page, 'Create a new field');
  await sleep(page, 1000);
  const box = await dialogControls(page, ['Field name', 'Field type', 'CREATE', 'This field is a list (multiple entries)']);
  if (!box) throw new Error('field dialog not found');
  const [nameInput] = box.inputs;
  await page.mouse.click(nameInput.x, nameInput.y);
  await page.keyboard.type(name);
  const typeRow = box.named['Field type'];
  await page.mouse.click(typeRow.x + 140, typeRow.y + 30, { label: 'open field type' });
  await sleep(page, 700);
  await page.click(`css=.dropdown-item.new-composer:text-is("${type}")`, { label: `type ${type}` });
  await sleep(page, 400);
  if (list) {
    const l = box.named['This field is a list (multiple entries)'];
    if (l) await page.mouse.click(l.x + 150, l.y);
  }
  await clickExactText(page, 'CREATE');
  await sleep(page, 1200);
  return 'created';
}
