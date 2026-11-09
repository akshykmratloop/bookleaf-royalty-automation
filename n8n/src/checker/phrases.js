/**
 * Wording a reply to an author must never contain. Each rule says why, so admins
 * can make an informed override decision.
 */

export const PHRASE_RULES = [
  {
    code: 'INTERNAL_LEAK',
    pattern:
      /\b(internal note|facts? pack|kb\.[a-z_]+|book\.BK\d+\.[a-z_.]+|author\.[a-z_]+|evidence id|as an ai|language model)\b/i,
    message: 'Mentions internal tooling or evidence ids. Authors must not see these.',
    overridable: false,
  },
  {
    code: 'GUARANTEE',
    pattern:
      /\b(guarantee[ds]?|we promise|i promise|definitely (?:be|arrive|reach|resolved)|100% sure|without fail)\b/i,
    message: 'Promises an outcome BookLeaf cannot guarantee.',
    overridable: true,
  },
  {
    code: 'BLAME',
    pattern: /\b(your fault|you should have|you failed to|blame)\b/i,
    message: 'Blames the author. The KB asks for empathy and ownership.',
    overridable: true,
  },
  {
    code: 'LEGAL_OR_REFUND',
    pattern: /\b(legal action|lawsuit|compensation|refund(?:ed)?)\b/i,
    message: 'Mentions legal matters, refunds or compensation. Needs a manager decision.',
    overridable: true,
  },
  {
    code: 'VAGUE_DEFLECTION',
    pattern:
      /\b(we are looking into it|please be patient|it will be done soon|as soon as possible)\b/i,
    message: 'Vague reassurance without a concrete next step or timeline (KB: be specific).',
    overridable: true,
  },
];
