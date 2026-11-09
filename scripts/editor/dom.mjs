// Helpers for driving the Bubble editor with ego-browser.
// They run in Node; everything that touches the DOM goes through page.evaluate.

/** Smallest visible element containing all the given texts; returns rects of its key controls. */
export async function dialogControls(page, mustContain) {
  return page.evaluate((texts) => {
    const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
    const all = [...document.querySelectorAll('div')].filter(visible);
    const hits = all.filter((el) => texts.every((t) => el.textContent.includes(t)));
    const box = hits.sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (!box) return null;
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    const inputs = [...box.querySelectorAll('input[type=text], input:not([type]), textarea')]
      .filter(visible)
      .map(rect);
    const leafWith = (t) =>
      [...box.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === t);
    const named = {};
    for (const t of texts) {
      const leaf = leafWith(t);
      if (leaf) named[t] = rect(leaf);
    }
    return { inputs, named, text: box.textContent.slice(0, 300) };
  }, mustContain);
}

/** Click a visible leaf element whose trimmed text is exactly `text` (nth match, default first). */
export async function clickExactText(page, text, nth = 0) {
  const pos = await page.evaluate(
    ({ t, n }) => {
      const leaves = [...document.querySelectorAll('*')].filter(
        (e) => e.children.length === 0 && e.textContent.trim() === t && e.getClientRects().length > 0,
      );
      const el = leaves[n];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { t: text, n: nth },
  );
  if (!pos) throw new Error(`No visible element with text "${text}" (#${nth})`);
  await page.mouse.click(pos.x, pos.y, { label: `click ${text}`.slice(0, 40) });
  return pos;
}

export const sleep = (page, ms) => page.waitForTimeout(ms);
