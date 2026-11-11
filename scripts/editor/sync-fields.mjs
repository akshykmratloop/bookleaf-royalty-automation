// Run inside `ego-browser nodejs`: adds every field that bubble-app/schema.mjs lists but the
// live editor does not have yet. It never deletes or retypes a field.
// Usage: const { syncFields } = await import('<abs path>'); console.log(await syncFields(page, ['NotificationLog']));
import { TYPES } from '../../bubble-app/schema.mjs';
import { addField, existingFields, openDataTypes } from './data-types.mjs';
import { clickExactText, sleep } from './dom.mjs';

/** Editor dropdown label for a schema type ("yes / no" is listed as "yes / no", lists drop the prefix). */
const asField = (name, type) =>
  type.startsWith('list of ') ? { name, type: type.slice(8).replace(/s$/, ''), list: true } : { name, type };

export async function syncFields(page, typeNames = Object.keys(TYPES)) {
  await openDataTypes(page);
  const report = {};
  for (const type of typeNames) {
    await clickExactText(page, type);
    await sleep(page, 1200);
    const have = new Set((await existingFields(page)).map((f) => f.name));
    const missing = Object.entries(TYPES[type]).filter(([name]) => !have.has(name));
    report[type] = [];
    for (const [name, fieldType] of missing) {
      report[type].push(`${name}: ${await addField(page, asField(name, fieldType))}`);
    }
  }
  return report;
}
