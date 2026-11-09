const REQUIRED = ['subject', 'greeting', 'intro', 'totalsParagraph', 'payoutParagraph', 'closing'];
const OPTIONAL = ['productionParagraph', 'allPaidParagraph'];

/**
 * Validates AI output and drops null/absent optional sections.
 * @param {unknown} v @returns {{ok:true, sections:Object}|{ok:false, error:{code:string, message:string}}}
 */
export function normalizeSections(v) {
  const bad = (message) => ({ ok: false, error: { code: 'INVALID_SHAPE', message } });
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return bad('output is not an object');
  const missing = REQUIRED.filter((k) => typeof v[k] !== 'string');
  if (missing.length) return bad(`missing or non-string: ${missing.join(', ')}`);
  const paras = v.bookParagraphs;
  const okParas = Array.isArray(paras) && paras.every((p) => p && typeof p.code === 'string' && typeof p.text === 'string');
  if (!okParas) return bad('bookParagraphs must be a list of {code, text}');
  const sections = Object.fromEntries(REQUIRED.map((k) => [k, v[k]]));
  sections.bookParagraphs = paras.map((p) => ({ code: p.code, text: p.text }));
  for (const k of OPTIONAL) if (typeof v[k] === 'string') sections[k] = v[k];
  return { ok: true, sections: orderKeys(sections) };
}

const ORDER = ['subject', 'greeting', 'intro', 'bookParagraphs', 'totalsParagraph', 'payoutParagraph', 'productionParagraph', 'allPaidParagraph', 'closing'];
const orderKeys = (s) => Object.fromEntries(ORDER.filter((k) => k in s).map((k) => [k, s[k]]));

/** @param {string} text @returns {{ok:true, sections:Object}|{ok:false, error:{code:string, message:string}}} */
export function parseSectionsText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: { code: 'INVALID_JSON', message: `AI output is not valid JSON: ${e.message}` } };
  }
  return normalizeSections(parsed);
}
