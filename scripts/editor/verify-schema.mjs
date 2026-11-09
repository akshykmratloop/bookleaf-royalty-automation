// Run inside `ego-browser nodejs`: compares the live editor's data types with bubble-app/schema.mjs.
// Usage: const { verifySchema } = await import('<abs path>'); console.log(await verifySchema(page));
import { TYPES } from '../../bubble-app/schema.mjs';
import { existingFields, openDataTypes } from './data-types.mjs';
import { clickExactText, sleep } from './dom.mjs';

// Built-in fields every type has, plus the option-set 'Display' column the editor keeps in the DOM.
const BUILT_IN = new Set(['Creator', 'Modified Date', 'Created Date', 'Slug', 'Display']);
const builtInFor = (type) => (type === 'User' ? new Set([...BUILT_IN, 'email']) : BUILT_IN);

function diffType(type, expected, actual) {
  const skip = builtInFor(type);
  const got = Object.fromEntries(actual.filter((f) => !skip.has(f.name)).map((f) => [f.name, f.type]));
  const missing = Object.keys(expected).filter((k) => !(k in got));
  const wrongType = Object.keys(expected)
    .filter((k) => k in got && got[k].toLowerCase() !== expected[k].toLowerCase())
    .map((k) => `${k}: want ${expected[k]}, got ${got[k]}`);
  const extra = Object.keys(got).filter((k) => !(k in expected));
  return { missing, wrongType, extra };
}

export async function verifySchema(page) {
  await openDataTypes(page);
  const report = {};
  for (const [type, fields] of Object.entries(TYPES)) {
    await clickExactText(page, type);
    await sleep(page, 1200);
    report[type] = diffType(type, fields, await existingFields(page));
  }
  const ok = Object.values(report).every((r) => !r.missing.length && !r.wrongType.length && !r.extra.length);
  return { ok, report };
}
