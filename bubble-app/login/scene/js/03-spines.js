/* 03 — the catalogue (18 real BookLeaf titles; spine looks derived from genre) and the art:
   cover motifs (SVG 200×300 in the cover ink colour), cover HTML, spine HTML, the shelf plant. */
const BOOKS = [
  { t: 'Whispers of the Ganges', g: 'Literary Fiction', c1: '#2a6b73', c2: '#163f45', fg: '#f4e7c9', f: 'ital', band: 'lines', w: 54, h: .92, m: 'waves', pay: 'paid', q: [.5, .7, .62, .9] },
  { t: 'The Saffron Diaries', g: 'Memoir', c1: '#e6973a', c2: '#c06a1c', fg: '#4a1420', f: 'serif', band: 'block', w: 46, h: .86, m: 'sun', pay: 'paid', q: [.4, .55, .8, .7] },
  { t: 'Code & Karma', g: 'Self-Help / Tech', c1: '#2b3540', c2: '#161c23', fg: '#9be3c4', f: 'cond', band: 'dots', w: 40, h: .8, m: 'lotus', pay: 'pend', q: [.3, .5, .45, .6] },
  { t: 'Startup Sutra', g: 'Business', c1: '#22315e', c2: '#121b38', fg: '#e8c26b', f: 'cond', band: 'lines', w: 58, h: .95, m: 'bars', pay: 'paid', q: [.6, .65, .85, 1] },
  { t: 'Between Two Temples', g: 'Historical Fiction', c1: '#a4532f', c2: '#6e3019', fg: '#f6e4c4', f: 'caps', band: 'lines', w: 62, h: 1, m: 'temples', pay: 'paid', q: [.7, .6, .75, .8] },
  { t: 'Debugging Life', g: 'Self-Help', c1: '#f3d66c', c2: '#d9b33c', fg: '#2a2124', f: 'cond', band: 'block', w: 38, h: .78, m: 'bug', pay: 'paid', q: [.35, .4, .6, .55] },
  { t: 'The Last Monsoon', g: 'Poetry', c1: '#5f7491', c2: '#3a4b63', fg: '#f3f5fa', f: 'ital', band: 'none', w: 32, h: .84, m: 'rain', pay: 'paid', q: [.25, .5, .35, .45] },
  { t: 'Cardamom & Chaos', g: 'Contemporary Fiction', c1: '#7f9f50', c2: '#55702f', fg: '#fbf3dc', f: 'serif', band: 'dots', w: 50, h: .9, m: 'pods', pay: 'pend', q: [.55, .5, .7, .65] },
  { t: 'Letters from Lakshadweep', g: 'Travel', c1: '#2fa6a7', c2: '#1a7476', fg: '#ffffff', f: 'ital', band: 'lines', w: 48, h: .88, m: 'island', pay: 'paid', q: [.45, .6, .9, .75] },
  { t: 'Turban Tales', g: 'Humor / Essays', c1: '#c4366e', c2: '#8e1f4c', fg: '#ffe17a', f: 'cond', band: 'block', w: 44, h: .76, m: 'swirl', pay: 'paid', q: [.5, .45, .55, .7] },
  { t: 'The Algorithm of Love', g: 'Romance', c1: '#f3b2be', c2: '#e08598', fg: '#4a1830', f: 'ital', band: 'dots', w: 42, h: .87, m: 'hearts', pay: 'paid', q: [.6, .8, .7, .95] },
  { t: 'Ctrl+Alt+Delete My Ex', g: 'Romance / Humor', c1: '#d9473f', c2: '#a52a24', fg: '#ffffff', f: 'mono', band: 'none', w: 40, h: .82, m: 'keys', pay: 'paid', q: [.7, .9, .6, .8] },
  { t: 'Midnight in Mysore', g: 'Thriller', c1: '#f3efe6', c2: '#e6e0d2', fg: '#3d3b3f', f: 'hand', band: 'none', w: 52, h: .93, m: 'palace', status: 'cover', stageIdx: 3 },
  { t: 'Ghazal of the Forgotten', g: 'Poetry / Urdu', c1: '#17624f', c2: '#0c3d31', fg: '#e9cf86', f: 'ital', band: 'lines', w: 34, h: .89, m: 'arch', pay: 'paid', q: [.3, .35, .5, .4] },
  { t: 'Raising Roots', g: 'Parenting', c1: '#2a5ea4', c2: '#173d72', fg: '#eaf2ff', f: 'mono', band: 'none', w: 46, h: .81, m: 'roots', status: 'type', stageIdx: 4 },
  { t: 'The Nagpur Notebooks', g: 'Essays / Memoir', c1: '#c2945f', c2: '#94693c', fg: '#2a1d14', f: 'serif', band: 'block', w: 44, h: .85, m: 'notebook', pay: 'paid', q: [.4, .5, .5, .6] },
  { t: "Durga's Daughters", g: 'Literary Fiction', c1: '#951f31', c2: '#5e0f1c', fg: '#f0cf7d', f: 'caps', band: 'lines', w: 56, h: .97, m: 'halo', pay: 'paid', q: [.65, .75, .85, .9] },
  { t: 'Howrah Nights', g: 'Crime / Thriller', c1: '#20232c', c2: '#101218', fg: '#f2b84b', f: 'cond', band: 'lines', w: 50, h: .91, m: 'bridge', pay: 'paid', q: [.55, .7, .8, .85] },
];
const STAGES = ['Manuscript', 'Editing', 'Proofreading', 'Cover design', 'Typesetting', 'ISBN & metadata', 'Print proof', 'Distribution', 'Live in stores'];
const isProd = (b) => b.status === 'cover' || b.status === 'type';
const CHAR_W = { serif: .54, ital: .48, cond: .5, caps: .78, mono: .62, hand: .42 };
BOOKS.forEach((b, i) => {
  b.i = i;
  const len = b.t.length;
  const byWidth = (.46 * b.w) / (280 * b.h);
  const byLength = .66 / (len * CHAR_W[b.f]);
  b.fsr = Math.min(byWidth, byLength).toFixed(4);
});

/* ═════════ cover motifs ═════════ */
const MOTIFS = {
  waves: (c) => `<circle cx="146" cy="168" r="20" fill="${c}" opacity=".9"/>` + [0, 1, 2, 3, 4, 5].map((i) => `<path d="M-10 ${206 + i * 15} q17.5 -9 35 0 t35 0 t35 0 t35 0 t35 0 t35 0 t35 0" fill="none" stroke="${c}" stroke-width="2" opacity="${(.9 - i * .12).toFixed(2)}"/>`).join('') + `<path d="M58 200q12 9 24 0z" fill="${c}"/><path d="M70 186q-5 7 0 12q5-5 0-12z" fill="#f6c25a"/>`,
  sun: (c) => `<circle cx="100" cy="196" r="40" fill="${c}" opacity=".88"/>` + Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * Math.PI * 2; return `<line x1="${100 + Math.cos(a) * 50}" y1="${196 + Math.sin(a) * 50}" x2="${100 + Math.cos(a) * 64}" y2="${196 + Math.sin(a) * 64}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`; }).join('') + [0, 1, 2].map((i) => `<line x1="20" x2="180" y1="${272 + i * 8}" y2="${272 + i * 8}" stroke="${c}" stroke-width="1" opacity=".4"/>`).join(''),
  lotus: (c) => `<g fill="none" stroke="${c}" stroke-width="2"><path d="M100 160c-14 26-14 46 0 66 14-20 14-40 0-66z"/><path d="M100 226c-22-6-40-24-44-50 22 4 38 22 44 50z"/><path d="M100 226c22-6 40-24 44-50-22 4-38 22-44 50z"/><path d="M100 226c-30 4-56-6-70-26 26-6 50 2 70 26z" opacity=".7"/><path d="M100 226c30 4 56-6 70-26-26-6-50 2-70 26z" opacity=".7"/><path d="M100 226v30h-40v26M100 256h44v20M60 282h-30" opacity=".8"/></g><g fill="${c}"><circle cx="30" cy="282" r="3.5"/><circle cx="144" cy="276" r="3.5"/><circle cx="60" cy="256" r="2.5"/></g>`,
  bars: (c) => [0, 1, 2, 3, 4].map((i) => `<rect x="${34 + i * 28}" y="${270 - (30 + i * 20)}" width="18" height="${30 + i * 20}" rx="2" fill="${c}" opacity="${(.45 + i * .12).toFixed(2)}"/>`).join('') + `<path d="M30 236l40-22 30 10 60-50" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><path d="M148 168l14-6-4 14" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  temples: (c) => `<circle cx="100" cy="190" r="26" fill="${c}" opacity=".22"/><path d="M26 282v-56q14-30 22-66 8 36 22 66v56z" fill="${c}" opacity=".85"/><path d="M48 160v-10" stroke="${c}" stroke-width="2"/><path d="M118 282v-42q12-24 18-52 6 28 18 52v42z" fill="${c}" opacity=".65"/><path d="M136 188v-9" stroke="${c}" stroke-width="2"/><path d="M0 282h200" stroke="${c}" stroke-width="2"/>`,
  bug: (c) => `<g fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"><ellipse cx="100" cy="222" rx="24" ry="32"/><circle cx="100" cy="182" r="11"/><path d="M100 192v62M76 208l-18-8M76 226h-20M78 244l-16 10M124 208l18-8M124 226h20M122 244l16 10M94 172l-8-12M106 172l8-12"/></g><path d="M140 140l10 10 20-24" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`,
  rain: (c) => { const r = rng(7); return `<path d="M40 170a30 30 0 0 1 58-10 24 24 0 0 1 46 10z" fill="${c}" opacity=".85"/>` + Array.from({ length: 34 }, () => { const x = 20 + r() * 170; const y = 186 + r() * 100; return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - 5).toFixed(1)}" y2="${(y + 12).toFixed(1)}" stroke="${c}" stroke-width="1.6" stroke-linecap="round" opacity="${(.4 + r() * .5).toFixed(2)}"/>`; }).join(''); },
  pods: (c) => { const r = rng(11); return Array.from({ length: 9 }, () => { const x = 30 + r() * 140; const y = 170 + r() * 110; const a = Math.round(r() * 180); return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a})"><ellipse rx="15" ry="7" fill="${c}" opacity=".85"/><line x1="-11" x2="11" stroke="rgba(0,0,0,.25)" stroke-width="1"/></g>`; }).join('') + `<path d="M20 290c30-40 50 10 70-30s40 20 60-20 20 10 30-10" fill="none" stroke="${c}" stroke-width="1.5" opacity=".5"/>`; },
  island: (c) => `<circle cx="140" cy="200" r="16" fill="${c}" opacity=".85"/><path d="M0 240h200" stroke="${c}" stroke-width="2"/><path d="M40 240q30-26 70 0z" fill="${c}"/><path d="M74 232q-2-26 8-44" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/><path d="M82 188q-18-6-28 6M82 188q14-14 30-6M82 188q-6-16-20-16M82 188q12 2 20 14" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>` + [0, 1, 2].map((i) => `<path d="M${20 + i * 20} ${254 + i * 12}h${120 - i * 30}" stroke="${c}" stroke-width="1.5" opacity="${(.7 - i * .2).toFixed(2)}" stroke-linecap="round"/>`).join('') + `<g fill="none" stroke="${c}" stroke-width="1.8" opacity=".8"><rect x="120" y="150" width="44" height="28" rx="2" transform="rotate(-10 142 164)"/><path d="m121 154 21 14 22-17" transform="rotate(-10 142 164)"/></g>`,
  swirl: (c) => { let d = 'M100 214'; for (let i = 1; i < 120; i += 1) { const a = i * .22; const rr = i * .55; d += ` L${(100 + Math.cos(a) * rr).toFixed(1)} ${(214 + Math.sin(a) * rr * .8).toFixed(1)}`; } return `<path d="${d}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>` + [[30, 170], [170, 160], [40, 280], [166, 278], [150, 300 - 60]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="${c}" opacity=".7"/>`).join(''); },
  hearts: (c) => `<g fill="none" stroke="${c}" stroke-width="2.4"><circle cx="82" cy="214" r="34"/><circle cx="118" cy="214" r="34"/></g><g stroke="${c}" stroke-width="1.2" opacity=".75"><path d="M30 170 66 196M170 170l-36 26M40 280l40-40M160 280l-40-40M100 214v-60"/></g><g fill="${c}"><circle cx="30" cy="170" r="4"/><circle cx="170" cy="170" r="4"/><circle cx="40" cy="280" r="4"/><circle cx="160" cy="280" r="4"/><circle cx="100" cy="154" r="4"/><circle cx="100" cy="214" r="5"/></g>`,
  keys: (c) => ['Ctrl', 'Alt', 'Del'].map((k, i) => `<g transform="translate(${26 + i * 52} ${206 + (i % 2) * 14})"><rect width="44" height="38" rx="7" fill="none" stroke="${c}" stroke-width="2.2"/><rect x="4" y="4" width="36" height="26" rx="5" fill="${c}" opacity=".14"/><text x="22" y="23" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="11" font-weight="700" fill="${c}">${k}</text></g>`).join('') + `<path d="M84 282c-12-10-12-22 0-24 6 0 8 6 8 6s2-6 8-6c12 2 12 14 0 24l-8 6z" fill="none" stroke="${c}" stroke-width="2"/><path d="M92 262l-4 8 6 4-4 8" fill="none" stroke="${c}" stroke-width="1.6"/>`,
  palace: (c) => `<g fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round" opacity=".85"><path d="M30 282h140M44 282v-62h112v62M60 220v-20h80v20M74 200q26-46 52 0" stroke-dasharray="5 3"/><path d="M100 154v-14M58 282v-34a12 12 0 0 1 24 0v34M118 282v-34a12 12 0 0 1 24 0v34"/><circle cx="100" cy="190" r="56" stroke-dasharray="2 4" opacity=".55"/><path d="M14 150 186 290M186 150 14 290" opacity=".18"/></g><circle cx="152" cy="150" r="12" fill="none" stroke="${c}" stroke-width="1.4" stroke-dasharray="3 3"/>`,
  arch: (c) => `<path d="M46 300v-90q0-46 54-78 54 32 54 78v90" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M60 300v-86q0-36 40-62 40 26 40 62v86" fill="none" stroke="${c}" stroke-width="1" opacity=".6"/><path d="M110 196a22 22 0 1 1-12-38 18 18 0 1 0 12 38z" fill="${c}"/><path d="m122 176 3 6 6 1-5 4 1 6-5-3-5 3 1-6-5-4 6-1z" fill="${c}"/>`,
  roots: (c) => `<g fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"><path d="M100 150v80M100 230q-20 20-50 26M100 230q-6 24-26 48M100 230q6 26 24 48M100 230q22 18 52 22M74 278q-10 6-20 4M124 278q10 8 22 4"/><circle cx="100" cy="150" r="30" stroke-dasharray="3 3"/><path d="M20 140v150M14 140h12M14 290h12" opacity=".7"/></g><text x="26" y="220" font-family="ui-monospace,Menlo,monospace" font-size="8" fill="${c}" transform="rotate(-90 26 220)" opacity=".8">TRIM 5.5 × 8.5</text>`,
  notebook: (c) => Array.from({ length: 9 }, (_, i) => `<line x1="0" x2="200" y1="${170 + i * 14}" y2="${170 + i * 14}" stroke="${c}" stroke-width="1" opacity=".3"/>`).join('') + `<line x1="34" x2="34" y1="150" y2="300" stroke="#c8475a" stroke-width="1.5" opacity=".7"/><circle cx="130" cy="226" r="28" fill="#e8892c"/><path d="M130 198q10-14 24-10-6 14-24 10z" fill="#3f6b2a"/><circle cx="122" cy="216" r="6" fill="#fff" opacity=".25"/>`,
  halo: (c) => [24, 36, 48, 60].map((r, i) => `<circle cx="100" cy="214" r="${r}" fill="none" stroke="${c}" stroke-width="${i === 0 ? 3 : 1.2}" opacity="${(.95 - i * .18).toFixed(2)}"/>`).join('') + Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return `<line x1="${(100 + Math.cos(a) * 64).toFixed(1)}" y1="${(214 + Math.sin(a) * 64).toFixed(1)}" x2="${(100 + Math.cos(a) * 74).toFixed(1)}" y2="${(214 + Math.sin(a) * 74).toFixed(1)}" stroke="${c}" stroke-width="1.6"/>`; }).join('') + `<path d="M100 240v-48M88 204q0-12 12-16 12 4 12 16M88 204v-10M112 204v-10" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>`,
  bridge: (c) => `<circle cx="150" cy="160" r="15" fill="${c}" opacity=".9"/><g fill="none" stroke="${c}" stroke-width="2"><path d="M40 250v-74M160 250v-74M40 176q60 46 120 0M0 214q20 0 40-38M200 214q-20 0-40-38M0 250h200"/><path d="M40 196l20 18 20-14 20 16 20-16 20 14 20-18" stroke-width="1.2" opacity=".8"/></g>` + [0, 1, 2, 3].map((i) => `<path d="M${30 + i * 8} ${262 + i * 10}h${140 - i * 16}" stroke="${c}" stroke-width="1.4" opacity="${(.6 - i * .12).toFixed(2)}" stroke-dasharray="${8 + i * 2} 6"/>`).join(''),
};

function coverHTML(b) {
  const prodClass = b.status === 'cover' ? ' pencil' : b.status === 'type' ? ' blueprint' : '';
  const stamp = b.status === 'cover' ? '<span class="cv-stamp">Cover in progress</span>' : b.status === 'type' ? '<span class="cv-stamp">Proof 2 · typesetting</span>' : '';
  return `<div class="cover f-${b.f}${prodClass}" style="--c1:${b.c1};--c2:${b.c2};--fg:${b.fg}">
    <svg class="cv-motif" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${MOTIFS[b.m](b.fg)}</svg>
    <div class="cv-top"><span class="cv-genre">${esc(b.g)}</span><span class="cv-title">${esc(b.t)}</span></div>
    ${stamp}
    <div class="cv-foot"><i>/</i>BookLeaf</div>
  </div>`;
}

function spineArtHTML(b) {
  const prod = b.status === 'cover' ? ' pencil' : b.status === 'type' ? ' blueprint' : '';
  let deco = '';
  if (b.band === 'lines') deco = '<i class="sp-band t1"></i><i class="sp-band t2"></i><i class="sp-band b1"></i><i class="sp-band b2"></i>';
  if (b.band === 'block') deco = '<i class="sp-block"></i>';
  if (b.band === 'dots') deco = '<i class="sp-dots"></i>';
  const imprint = b.w >= 44 ? '<span class="sp-imprint">BookLeaf</span>' : '';
  return `<span class="sp-art f-${b.f}${prod}" style="--c1:${b.c1};--c2:${b.c2};--fg:${b.fg};--fsr:${b.fsr}">${deco}<span class="sp-title">${esc(b.t)}</span>${imprint}<span class="sp-mark">/</span></span>`;
}

const PLANT_SVG = `<svg class="plant" viewBox="0 0 76 130" aria-hidden="true" preserveAspectRatio="xMidYMax meet"><g><path d="M38 84C30 60 14 54 6 58c6 14 20 24 32 26z" fill="#6f9a5a"/><path d="M38 84c6-26 22-34 32-30-6 16-18 26-32 30z" fill="#5c8a4a"/><path d="M38 84c-4-30 2-52 12-60 6 20 0 44-12 60z" fill="#7fae66"/><path d="M38 84C30 66 24 44 28 30c10 14 14 34 10 54z" fill="#5c8a4a"/></g><path d="M18 84h40l-5 42H23z" fill="#c9705e"/><path d="M16 80h44v8H16z" fill="#b45d4c"/><path d="M23 126h30" stroke="rgba(0,0,0,.2)"/></svg>`;
