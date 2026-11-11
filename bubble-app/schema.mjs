// The Bubble app's database, as data. `scripts/editor/verify-schema.mjs` checks the live
// editor against it, so the app and this file can never drift silently.

export const OPTION_SETS = {
  Role: ['Author', 'Admin'],
  BookStatus: ['Published & Live', 'In Production - Cover Design', 'In Production - Typesetting'],
  PrintPartner: ['In-House', 'Repro India', 'Epitome Books'],
  Platform: ['Amazon India', 'Flipkart', 'BookLeaf Store', 'Amazon US', 'Amazon UK'],
  // Quarter ends and pay-by dates (quarter end + 45 days); attributes quarter_end and pay_by (date).
  PayoutCycle: ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026', 'Q1 2027', 'Q2 2027'],
  SendStatus: ['Queued', 'Processing', 'Sent', 'Failed', 'Duplicate', 'Draft ready', 'Discarded'],
};

/** Option values created in the editor UI get a snake_case db_value; values made by the AI agent use their name. */
export const OPTION_IDS = {
  sendstatus: { 'Draft ready': 'draft_ready', Discarded: 'discarded' },
};

/** Field type labels as the editor shows them ("list of X" is shown as "list of X"). */
export const TYPES = {
  User: { role: 'Role', author: 'Author' },
  Author: {
    code: 'text', name: 'text', email: 'text', phone: 'text', city: 'text',
    joined_date: 'date', user: 'User',
  },
  Book: {
    code: 'text', title: 'text', isbn: 'text', genre: 'text', status: 'BookStatus',
    publication_date: 'date', mrp: 'number', royalty_per_copy: 'number',
    print_partner: 'PrintPartner', platforms: 'list of Platforms', author: 'Author',
    owner: 'User', royalty: 'RoyaltyRecord',
  },
  RoyaltyRecord: {
    book: 'Book', author: 'Author', owner: 'User', copies_sold: 'number', earned: 'number',
    paid: 'number', pending: 'number', last_payout_date: 'date',
    // last payout, or publication date if never paid: the date the 90-day overdue rule counts from
    due_anchor_date: 'date',
  },
  NotificationLog: {
    author: 'Author', owner: 'User', triggered_by: 'User', mode: 'text', batch_id: 'text',
    job_id: 'text', status: 'SendStatus', error: 'text', subject: 'text', email_html: 'text',
    sent_to: 'text', figures_verified: 'number', model: 'text', cost_usd: 'number',
    requested_at: 'date', completed_at: 'date',
    // live progress and the draft-review flow
    stage: 'text', delivery: 'text', tone: 'text', length: 'text', edit_text: 'text', issues: 'text',
  },
  AppSettings: {
    reference_date: 'date', use_today: 'yes / no', demo_inbox: 'text', callback_mode: 'text',
    drill_ai_down: 'yes / no', drill_email_down: 'yes / no', drill_data_down: 'yes / no',
    drill_primary_down: 'yes / no',
    // email defaults the admin sets on the Email settings view
    email_tone: 'text', email_length: 'text', email_note: 'text', sign_off: 'text', review_first: 'yes / no',
  },
};
