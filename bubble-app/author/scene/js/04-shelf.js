/* 04 — "Your shelf": the author's own books as spines on a short shelf, each with a status ribbon.
   Hover or focus shows a tooltip; click, Enter or Space scrolls to the book's card and highlights it. */
const SH = { el: null, sig: '', tipFor: null };
const FLASH_MS = 1900;
const TONE_WORDS = { paid: 'fully paid', pending: 'pending', overdue: 'overdue', production: 'in production' };

/** "Earned <amount> · Pending <amount>" in the table's own words, or the production stage. */
function moneyLine(book) {
  if (book.royalty) return `Earned ${book.royalty.earnedText} · Pending ${book.royalty.pendingText}`;
  return book.inProduction ? book.stage || 'In production' : 'No royalties yet';
}

/** A face-out 3D book: the login's cover art in front, its spine art on the side, page edges behind. */
function bookArt(look, rib) {
  const mark = rib.tone === 'none' ? '' : '<span class="bl-book-mark"></span>';
  return `<span class="bl-book-3d" aria-hidden="true">${mark}<span class="bl-book-side">${spineArtHTML(look)}</span>`
    + `<span class="bl-book-pages"></span><span class="bl-book-cover">${coverHTML(look)}</span></span>`;
}

function spineItem(book, i) {
  const look = lookFor(book);
  const rib = ribbonFor(book);
  const item = make('div', `bl-spine-slot tone-${rib.tone}`);
  item.setAttribute('role', 'listitem');
  const btn = make('button', 'bl-spine');
  btn.type = 'button';
  btn.dataset.title = book.title;
  btn.style.setProperty('--bh', `${BOOK_H(look)}px`);
  btn.style.setProperty('--depth', `${BOOK_DEPTH(look)}px`);
  btn.style.setProperty('--turn', `${i % 2 ? 17 : 23}deg`);
  btn.setAttribute('aria-label', `${book.title}. ${rib.tone === 'none' ? '' : `${rib.text}. `}${moneyLine(book)}. Show the book's details.`);
  btn.setAttribute('aria-describedby', 'bl-shelf-tip');
  btn.innerHTML = bookArt(look, rib);
  item.appendChild(btn);
  if (rib.tone !== 'none') item.insertAdjacentHTML('beforeend', `<span class="bl-ribbon" aria-hidden="true" ${OWN}>${esc(rib.text)}</span>`);
  return item;
}

/** Counts per status, as legend items: "1 fully paid", "1 overdue". */
function legendItems(books) {
  const counts = {};
  books.forEach((b) => { const t = ribbonFor(b).tone; if (TONE_WORDS[t]) counts[t] = (counts[t] || 0) + 1; });
  return Object.keys(TONE_WORDS).filter((t) => counts[t])
    .map((t) => `<li class="tone-${t}" ${OWN}><i aria-hidden="true"></i>${counts[t]} ${TONE_WORDS[t]}</li>`).join('');
}

function renderNote(el, books) {
  const title = qs('.bl-shelf-title', el);
  const n = books.length;
  title.textContent = n ? `${n} ${n === 1 ? 'book' : 'books'} on your shelf` : 'Your shelf is ready for its first book';
  qs('.bl-shelf-legend', el).innerHTML = legendItems(books);
  qs('.bl-shelf-hint', el).hidden = n === 0;
}

function renderShelf() {
  const el = document.getElementById('bl-shelf');
  if (!el) return;
  const books = shelfBooks();
  const empty = isShown(qs('.db_bk_empty'));
  if (!books.length && !empty) return; // Bubble has not drawn the cards yet: keep the loading frame
  const sig = shelfSignature(books);
  if (el === SH.el && sig === SH.sig) return;
  SH.el = el; SH.sig = sig;
  const row = qs('.bl-shelf-row', el);
  row.replaceChildren(...books.map(spineItem));
  if (books.length) row.insertAdjacentHTML('beforeend', `<div class="bl-shelf-plant" aria-hidden="true" ${OWN}>${PLANT_SVG}</div>`);
  renderNote(el, books);
  el.classList.remove('is-loading');
  el.style.setProperty('--books', String(books.length));
  bindShelf(el);
  sizeDust();
}

/* ───────── tooltip ───────── */
function showTip(btn) {
  const el = SH.el; const tip = el && qs('.bl-shelf-tip', el);
  const book = tip && shelfBooks().find((b) => b.title === btn.dataset.title);
  if (!book) return;
  const rib = ribbonFor(book);
  tip.innerHTML = `<b>${esc(book.title)}</b><span>${esc(moneyLine(book))}</span>${rib.tone === 'none' ? '' : `<em class="tone-${rib.tone}">${esc(rib.text)}</em>`}`;
  const s = btn.getBoundingClientRect(); const box = el.getBoundingClientRect();
  tip.style.left = `${(s.right - box.left + 14).toFixed(1)}px`; // beside the book, never over the heading
  tip.style.top = `${(s.top - box.top + s.height * 0.45).toFixed(1)}px`;
  tip.classList.add('on');
  tip.setAttribute('aria-hidden', 'false');
  SH.tipFor = btn;
}

function hideTip() {
  const tip = SH.el && qs('.bl-shelf-tip', SH.el);
  if (tip) { tip.classList.remove('on'); tip.setAttribute('aria-hidden', 'true'); }
  SH.tipFor = null;
}

/* ───────── jump to the book's card ───────── */
function goToBook(title) {
  const book = bookCards().find((b) => titleKey(b.title) === titleKey(title));
  if (!book) return;
  const { card } = book;
  card.scrollIntoView({ behavior: isReduced() ? 'auto' : 'smooth', block: 'center' });
  if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
  card.focus({ preventScroll: true });
  card.classList.remove('bl-au-flash');
  void card.offsetWidth; // restart the highlight when the same book is chosen twice
  card.classList.add('bl-au-flash');
  clearTimeout(card.__blFlash);
  card.__blFlash = setTimeout(() => card.classList.remove('bl-au-flash'), FLASH_MS);
}

/** Left/Right arrows move between books; Escape hides the tooltip. */
function onShelfKey(e) {
  const btn = e.target.closest && e.target.closest('.bl-spine');
  if (!btn) return;
  if (e.key === 'Escape') { hideTip(); return; }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const all = qsa('.bl-spine', SH.el);
  const next = all[all.indexOf(btn) + (e.key === 'ArrowRight' ? 1 : -1)];
  if (next) { e.preventDefault(); next.focus(); }
}

/** Delegated listeners, bound once per shelf element (Bubble may redraw the HTML element). */
function bindShelf(el) {
  if (el.__blBound) return;
  el.__blBound = true;
  const spine = (e) => (e.target.closest ? e.target.closest('.bl-spine') : null);
  el.addEventListener('pointerover', (e) => { const b = spine(e); if (!b) hideTip(); else if (b !== SH.tipFor) showTip(b); });
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focusin', (e) => { const b = spine(e); if (b) showTip(b); });
  el.addEventListener('focusout', hideTip);
  el.addEventListener('keydown', onShelfKey);
  el.addEventListener('click', (e) => { const b = spine(e); if (b) { hideTip(); goToBook(b.dataset.title); } });
}
