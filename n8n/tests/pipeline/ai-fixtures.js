/** Provider responses for pipeline tests (shapes from the Anthropic Messages and OpenAI Responses APIs). */
export const goodSections = Object.freeze({
  subject: 'Your BookLeaf royalty summary',
  greeting: 'Dear Rohit,',
  intro: 'Here is your royalty summary, with figures as of 31 Dec 2025. Thank you for being part of BookLeaf.',
  bookParagraphs: [
    { code: 'BK003', text: 'Code & Karma has sold 876 copies. Its payout of ₹5,280 is later than our usual cycle, and we are sorry. Our finance team has been asked to review it, and you will hear back from us within 48 hours.' },
    { code: 'BK004', text: 'Startup Sutra has earned ₹57,744 so far, and ₹7,744 is pending for the next payout cycle.' },
  ],
  totalsParagraph: 'Across both books you have earned ₹84,024, of which ₹71,000 has been paid and ₹13,024 is pending.',
  payoutParagraph: 'The pending amount for Startup Sutra will be paid in the payout cycle that closes by 14 Feb 2026, by bank transfer to the account linked in your dashboard.',
  closing: 'If anything looks different from your own records, simply reply to this email.\n\nWarm regards,\nBookLeaf Author Relations',
});

export const anthropicOk = (sections = goodSections, extra = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(sections) }],
  usage: { input_tokens: 3000, output_tokens: 700 }, ...extra,
});

export const openaiOk = (sections = goodSections) => ({
  id: 'resp_1', object: 'response', status: 'completed', model: 'gpt-4.1-mini-2025-04-14',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...sections, productionParagraph: null, allPaidParagraph: null }) }] }],
  usage: { input_tokens: 2800, output_tokens: 600 },
});

/** The same draft with one invented figure. */
export const wrongSections = Object.freeze({
  ...goodSections,
  totalsParagraph: 'Across both books you have earned ₹84,500, of which ₹71,000 has been paid.',
});
