/* 06 — KPI tiles with life: the three amounts count up once (≤ 700 ms, never under reduced motion, and
   always ending on Bubble's own text); PAID gets an ink meter (paid as a share of earned); NEXT PAYOUT
   WINDOW gets a tear-off slip with the days left. PENDING's amber accent is CSS only. */
const COUNT_MS = 650;
/** Count-ups start only in the first moments after load, never on a later change of value. */
const COUNT_WINDOW_MS = 6000;
const BOOT_AT = performance.now();
const counted = new WeakSet();
const animating = new Set();

/** The text node holding the number inside a Bubble Text element. */
function numberNode(el) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/\d/.test(n.nodeValue)) return n;
  return null;
}

/** Counts from 0 to the shown amount. Stops at once (leaving Bubble's text) if Bubble rewrites it. */
function countUp(el) {
  const node = numberNode(el);
  const final = node && node.nodeValue;
  const target = amount(final);
  if (!node || !target || counted.has(el)) return;
  counted.add(el);
  if (isReduced() || performance.now() - BOOT_AT > COUNT_WINDOW_MS) return;
  const prefix = final.slice(0, final.search(/[\d₹]/)); // keeps any text before the amount
  const start = performance.now();
  let written = final;
  animating.add(node);
  const step = (now) => {
    if (!node.isConnected || node.nodeValue !== written) { animating.delete(node); return; }
    const p = Math.min(1, (now - start) / COUNT_MS);
    written = p < 1 ? prefix + rupees(target * (1 - (1 - p) ** 3)) : final;
    node.nodeValue = written;
    if (p < 1) requestAnimationFrame(step); else animating.delete(node);
  };
  node.nodeValue = written = prefix + rupees(0);
  requestAnimationFrame(step);
}

/** The ink meter in the PAID tile: "82% of earnings paid" and a bar that fills to it. */
function paidMeter(k) {
  const tile = document.getElementById('bl-author-kpi-paid');
  if (!tile || k.earned.value === null || k.paid.value === null) return;
  const pct = k.earned.value > 0 ? Math.max(0, Math.min(100, Math.round((k.paid.value / k.earned.value) * 100))) : 0;
  let meter = qs('.bl-meter', tile);
  if (!meter) {
    meter = make('div', 'bl-meter');
    meter.innerHTML = `<span class="bl-meter-label" ${OWN}></span><span class="bl-meter-track" ${OWN} aria-hidden="true"><i ${OWN}></i></span>`;
    tile.appendChild(meter);
  }
  if (meter.dataset.pct === String(pct)) return;
  meter.dataset.pct = String(pct);
  qs('.bl-meter-label', meter).textContent = k.earned.value > 0 ? `${pct}% of earnings paid` : 'No earnings yet';
  const ink = qs('.bl-meter-track i', meter);
  requestAnimationFrame(() => ink.style.setProperty('--pct', `${pct}%`));
}

/** The tear-off slip on NEXT PAYOUT WINDOW: "94 days left" (or "Due today"). Hidden once it has passed. */
function payoutSlip() {
  const tile = document.getElementById('bl-author-kpi-next');
  const day = tile && dayOf(textOf(qs('.db_k_next_v', tile)));
  if (!tile) return;
  let slip = qs('.bl-slip', tile);
  const left = day ? daysUntil(day) : -1;
  if (left < 0) { if (slip) slip.remove(); return; }
  const words = left === 0 ? 'Due today' : `${left} ${left === 1 ? 'day' : 'days'} left`;
  if (!slip) { slip = make('span', 'bl-slip'); tile.appendChild(slip); }
  if (slip.textContent !== words) slip.textContent = words;
}

function decorateKpis() {
  const k = kpis();
  Object.values(k).forEach((x) => { if (x.el && x.value) countUp(x.el); });
  if (!animating.size) paidMeter(kpis()); // read again: the meter uses the final amounts only
  payoutSlip();
}
