/* 07 — royalty overview: under each row's Earned…Pending numbers, a slim bar of paid (ink) against
   pending (amber), sized from that row's own cells. Row hover and the ledger total are CSS only. */

/** The bar spans from the left edge of Earned to the right edge of Pending, in row coordinates. */
function barBox(r) {
  const row = r.row.getBoundingClientRect();
  const a = r.cells.earned && r.cells.earned.getBoundingClientRect();
  const b = r.cells.pending && r.cells.pending.getBoundingClientRect();
  if (!a || !b || !a.width || !b.width) return null;
  return { left: a.left - row.left, width: b.right - a.left };
}

function rowBar(r) {
  let bar = qs(':scope > .bl-rowbar', r.row);
  if (r.earned === null || r.paid === null || r.pending === null || r.earned <= 0) { if (bar) bar.remove(); return; }
  const box = barBox(r);
  if (!box) return;
  if (!bar) {
    bar = make('span', 'bl-rowbar');
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = `<i ${OWN}></i>`; // the track is pending (amber), the fill is paid (ink)
    r.row.appendChild(bar);
  }
  const paidPct = Math.max(0, Math.min(100, (r.paid / r.earned) * 100));
  bar.style.left = `${box.left.toFixed(1)}px`;
  bar.style.width = `${box.width.toFixed(1)}px`;
  bar.style.setProperty('--paid', `${paidPct.toFixed(2)}%`);
  bar.title = `${r.paidText} paid · ${r.pendingText} pending (${Math.round(paidPct)}% paid)`;
}

function decorateTable() {
  royaltyRows().forEach(rowBar);
}
