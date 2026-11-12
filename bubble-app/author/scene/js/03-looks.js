/* 03 — a look (colours, type, motif) for each of the author's books, from the login's catalogue
   (BOOKS, just above). A title the catalogue does not know gets a stable look picked by its hash. */
const CATALOGUE = new Map(BOOKS.map((b) => [titleKey(b.t), b]));
const SPARE_LOOKS = BOOKS.filter((b) => !b.status);
/** Book size on the author shelf (px): face-out covers, a little taller for the login's taller titles. */
const BOOK_H = (look) => Math.round(124 + 18 * look.h);
const BOOK_DEPTH = (look) => Math.round(12 + look.w * 0.16);

/** Spine title size as a share of the spine height: at most 46% of the spine's width, and short
   enough for the whole title to fit in 66% of its height (the login's rule, for this shelf). */
function fitTitle(look) {
  const byWidth = (0.46 * BOOK_DEPTH(look)) / BOOK_H(look);
  const byLength = 0.66 / (look.t.length * CHAR_W[look.f]);
  return { ...look, fsr: Math.min(byWidth, byLength).toFixed(4) };
}

/** The look for one book card; in-production books get the login's pencil or blueprint art. */
function lookFor(book) {
  const known = CATALOGUE.get(titleKey(book.title));
  const base = known || SPARE_LOOKS[hashOf(titleKey(book.title)) % SPARE_LOOKS.length];
  const look = { ...base, t: book.title, g: book.genre || base.g };
  delete look.status;
  if (book.inProduction) look.status = /typeset/i.test(book.stage) ? 'type' : 'cover';
  return fitTitle(look);
}

/** What the ribbon says and its colour: the badge's own words, or "In production". */
function ribbonFor(book) {
  if (book.royalty && book.royalty.status) return { text: book.royalty.status, tone: book.royalty.tone };
  if (book.inProduction) return { text: 'In production', tone: 'production' };
  return { text: 'No royalties yet', tone: 'none' };
}
