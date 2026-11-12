/* 08 — "My books" and "My statements": a cover thumbnail (the login's cover art) at the left of each
   book card, and a small "New" tag on the newest statement. The envelope look and the postmark date
   stamp are CSS only. View still opens Bubble's own pop-up. */

function coverThumb(book) {
  const look = lookFor(book);
  const key = `${look.t}|${look.g}|${look.status || ''}`;
  let thumb = qs(':scope > .bl-thumb', book.card);
  if (thumb && thumb.dataset.key === key) return;
  if (!thumb) {
    thumb = make('div', 'bl-thumb');
    thumb.setAttribute('aria-hidden', 'true');
    book.card.appendChild(thumb);
  }
  thumb.dataset.key = key;
  thumb.innerHTML = coverHTML(look);
  book.card.classList.add('bl-has-thumb');
}

function decorateBooks() {
  bookCards().forEach(coverThumb);
}

/** The first statement row is the newest (Bubble sorts them newest first). The tag sits on the
   envelope's corner (absolutely placed), so nothing in the row moves when it appears. */
function decorateLetters() {
  qsa('.db_st_row').forEach((row, i) => {
    const tag = qs(':scope > .bl-new', row);
    if (i === 0 && !tag) row.appendChild(make('span', 'bl-new', 'New'));
    if (i !== 0 && tag) tag.remove();
    row.classList.toggle('bl-newest', i === 0);
  });
}
