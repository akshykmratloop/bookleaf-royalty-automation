/* 02 — the data, read from what Bubble already shows: the royalty table rows, the KPI tiles and the
   "My books" cards. Nothing is fetched or hard-coded, so the shelf always agrees with the table. */
const TONES = { 'fully paid': 'paid', pending: 'pending', overdue: 'overdue' };
const toneOf = (label) => TONES[String(label || '').toLowerCase()] || 'pending';

/** The badge's visible words. The badge element also holds the book's status text, hidden. */
function badgeText(row) {
  const badge = qs('.db_rt_badge_w, .db_rt_badge_n', row);
  const shown = qsa('.Text', badge).filter(isShown).map(textOf).filter(Boolean);
  return shown.length ? shown[shown.length - 1] : '';
}

/** Royalty table rows (wide table; the narrow card list on small screens). */
function royaltyRows() {
  const wide = qsa('.db_rt_tbl_w_row');
  const rows = wide.length ? wide : qsa('.db_rt_cards_n_card');
  const p = wide.length ? 'db_rt_tbl_w_' : 'db_rt_cards_n_';
  return rows.map((row) => {
    const cell = (name) => qs(`.${p}${name}`, row);
    const status = badgeText(row);
    return {
      row, title: textOf(cell('title')), status, tone: toneOf(status),
      earnedText: textOf(cell('earned')), paidText: textOf(cell('paid')), pendingText: textOf(cell('pend')),
      earned: amount(textOf(cell('earned'))), paid: amount(textOf(cell('paid'))), pending: amount(textOf(cell('pend'))),
      cells: { earned: cell('earned'), pending: cell('pend') },
    };
  });
}

/** "My books" cards in page order (newest first, as Bubble sorts them). */
function bookCards() {
  return qsa('.db_bk_card').map((card) => {
    const banner = qs('.db_bk_banner', card);
    return {
      card, title: textOf(qs('.db_bk_title', card)), genre: textOf(qs('.db_bk_genre_t', card)),
      inProduction: isShown(banner), stage: isShown(banner) ? textOf(qs('.db_bk_banner_t', card)) : '',
    };
  }).filter((b) => b.title);
}

/** The shelf: every book card, with its royalty row when the table has one (same title). */
function shelfBooks() {
  const byTitle = new Map(royaltyRows().map((r) => [titleKey(r.title), r]));
  return bookCards().map((b) => ({ ...b, royalty: byTitle.get(titleKey(b.title)) || null }));
}

/** A string that changes whenever anything the shelf shows changes (to skip needless redraws). */
const shelfSignature = (books) => JSON.stringify(books.map((b) => [b.title, b.genre, b.stage,
  b.royalty && [b.royalty.status, b.royalty.earnedText, b.royalty.pendingText]]));

/** The KPI tiles: the value element and the number it shows. */
const KPI_IDS = { earned: 'db_k_earned_v', paid: 'db_k_paid_v', pending: 'db_k_pend_v' };
function kpis() {
  const out = {};
  Object.entries(KPI_IDS).forEach(([key, cls]) => {
    const el = qs(`.${cls}`);
    out[key] = { el, text: textOf(el), value: amount(textOf(el)) };
  });
  return out;
}

/** "by 14 Feb 2027" -> a local Date at midnight, or null. */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function dayOf(text) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(String(text || ''));
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  return month < 0 ? null : new Date(Number(m[3]), month, Number(m[1]));
}

/** Whole days from today (local) to a date: 0 today, negative once it has passed. */
function daysUntil(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((date - today) / 86400000);
}
