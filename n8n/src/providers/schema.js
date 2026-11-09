const str = { type: 'string' };
const OPTIONAL = ['productionParagraph', 'allPaidParagraph'];

/** JSON schema for the AI "sections" output (Anthropic structured outputs). */
export const sectionsSchema = Object.freeze({
  type: 'object',
  properties: {
    subject: str,
    greeting: str,
    intro: str,
    bookParagraphs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { code: str, text: str },
        required: ['code', 'text'],
        additionalProperties: false,
      },
    },
    totalsParagraph: str,
    payoutParagraph: str,
    productionParagraph: str,
    allPaidParagraph: str,
    closing: str,
  },
  required: ['subject', 'greeting', 'intro', 'bookParagraphs', 'totalsParagraph', 'payoutParagraph', 'closing'],
  additionalProperties: false,
});

/** Strict variant (OpenAI): every property required; optional ones are nullable. */
export const strictSectionsSchema = Object.freeze({
  ...sectionsSchema,
  properties: Object.fromEntries(
    Object.entries(sectionsSchema.properties).map(([k, v]) => [k, OPTIONAL.includes(k) ? { type: ['string', 'null'] } : v]),
  ),
  required: Object.keys(sectionsSchema.properties),
});
