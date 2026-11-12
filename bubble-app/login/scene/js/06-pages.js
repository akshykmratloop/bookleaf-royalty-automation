/* 06 — the pages inside the opened book: cover plate (left), royalty snapshot or production
   progress (right), and the "Welcome back" page shown when a book flies into the sign-in card. */
function prodPageHTML(b) {
  const bars = STAGES.map((_, i) => {
    let cls = '';
    if (i < b.stageIdx) cls = 'done';
    else if (i === b.stageIdx) cls = 'now';
    return `<i class="${cls}"></i>`;
  }).join('');
  return `<div class="pg pg-r"><p class="pg-kicker">${esc(b.g)}</p><h3 class="pg-title" id="bk-title">${esc(b.t)}</h3><p class="pg-by">A BookLeaf Publishing title</p>
    <span class="chip prod">In production · ${STAGES[b.stageIdx]}</span>
    <div class="snap"><p class="snap-h">Production · stage ${b.stageIdx + 1} of 9</p><div class="stages">${bars}</div>
    <div class="stage-lbl"><span>Manuscript</span><span>Live in stores</span></div>
    <ul class="snap-list"><li>Now <b>${STAGES[b.stageIdx]}</b></li><li>Next <b>${STAGES[b.stageIdx + 1]}</b></li><li>Royalties <b>start the day it goes live</b></li></ul></div>
    <button class="pg-cta" type="button" data-cta>Sign in to follow every stage →</button><p class="pg-foot">NINE STAGES, ONE VIEW · 02</p></div>`;
}

function livePageHTML(b) {
  const bars = b.q.map((v) => `<span style="height:${Math.round(v * 100)}%"></span>`).join('');
  const pay = b.pay === 'paid' ? '<span class="chip paid">Fully paid</span>' : '<span class="chip pend">Pending</span>';
  return `<div class="pg pg-r"><p class="pg-kicker">${esc(b.g)}</p><h3 class="pg-title" id="bk-title">${esc(b.t)}</h3><p class="pg-by">A BookLeaf Publishing title</p>
    <span class="chip live">Published &amp; Live</span>
    <div class="snap"><p class="snap-h">Royalty snapshot</p><div class="bars" aria-hidden="true">${bars}</div><div class="bars-x" aria-hidden="true"><span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span></div>
    <ul class="snap-list"><li>Royalties <b>tracked every quarter</b></li><li>Statements <b>written for you, by email</b></li><li>Last payout ${pay}</li></ul></div>
    <p class="pg-note">For show only. Your real figures appear after you sign in.</p>
    <button class="pg-cta" type="button" data-cta>Sign in to see its statement →</button><p class="pg-foot">BOOKLEAF PUBLISHING · 02</p></div>`;
}

function rightPageHTML(b) {
  return isProd(b) ? prodPageHTML(b) : livePageHTML(b);
}

function leftPageHTML(b) {
  let cap = 'Cover · final artwork';
  if (b.status === 'cover') cap = 'Cover · sketch in progress';
  if (b.status === 'type') cap = 'Interior · being typeset';
  return `<div class="pg pg-l"><div class="plate">${coverHTML(b)}</div><p class="plate-cap">${cap}</p><p class="pg-foot">BOOKLEAF PUBLISHING · 01</p></div>`;
}

function welcomeCopy(who) {
  if (who === 'admin') return { name: 'Welcome back, admin', line: 'Opening the admin dashboard: authors, books and royalty summaries.' };
  if (who === 'author') return { name: 'Welcome back, Priya', line: 'Opening your author dashboard: books, copies sold and royalties.' };
  return { name: 'Welcome back', line: 'Opening your dashboard: books, copies sold and royalties.' };
}

function welcomePageHTML(b, who) {
  const copy = welcomeCopy(who);
  return `<div class="pg pg-r"><p class="pg-kicker">Signing in</p><div class="welcome-stamp"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg></div>
    <h3 class="pg-title" id="bk-title">${copy.name}</h3><p class="pg-by">${copy.line}</p><div class="load-line"><i></i></div>
    <p class="pg-note" style="margin-top:1.2em">Bookmarked at “${esc(b.t)}”.</p><p class="pg-foot">BOOKLEAF PUBLISHING · 02</p></div>`;
}
