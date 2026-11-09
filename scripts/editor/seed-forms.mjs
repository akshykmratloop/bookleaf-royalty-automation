// Seeds the dataset through the temporary `setup` page forms (works on Bubble's free plan,
// where CSV upload is paid-only). Records are linked by code, so no Bubble ids are needed.
// Run inside `ego-browser nodejs` with the setup page open and logged in as the admin.

/** Set a pickadate date input; Bubble's date pickers ignore typed text. */
async function setDate(page, placeholder, iso) {
  if (!iso) return;
  const ok = await page.evaluate(
    ({ ph, y, m, d }) => {
      const input = document.querySelector(`input[placeholder="${ph}"]`);
      const picker = window.jQuery?.(input).pickadate?.('picker');
      if (!picker) return false;
      picker.set('select', [y, m - 1, d]);
      return true;
    },
    { ph: placeholder, y: +iso.slice(0, 4), m: +iso.slice(5, 7), d: +iso.slice(8, 10) },
  );
  if (!ok) throw new Error(`date picker ${placeholder} not found`);
}

async function fillText(page, placeholder, value) {
  if (value === null || value === undefined || value === '') return;
  await page.fill(`css=input[placeholder="${placeholder}"]`, String(value));
}

/** Click a button and wait until the status text confirms this exact save. */
async function saveAndConfirm(page, button, confirmText) {
  await page.click(`text="${button}"`, { label: button.toLowerCase() });
  const ok = await page
    .waitForFunction((t) => document.body.innerText.includes(t), confirmText, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(800);
  return ok;
}

export async function saveAuthor(page, a) {
  await fillText(page, 'author_code', a.author_id);
  await fillText(page, 'author_name', a.name);
  await fillText(page, 'author_email', a.email);
  await fillText(page, 'author_phone', a.phone);
  await fillText(page, 'author_city', a.city);
  await setDate(page, 'author_joined_date', a.joined_date);
  return saveAndConfirm(page, 'Save author', `Author saved ${a.author_id}`);
}

/** Selects in page order: 0 role, 1 book_status, 2 print_partner. */
async function selectNth(page, nth, label) {
  await page.selectOption(`css=select >> nth=${nth}`, { label });
}

export async function saveBook(page, authorCode, b) {
  await fillText(page, 'book_code', b.book_id);
  await fillText(page, 'book_title', b.title);
  await fillText(page, 'book_isbn', b.isbn);
  await fillText(page, 'book_genre', b.genre);
  await selectNth(page, 1, b.status);
  await setDate(page, 'book_publication_date', b.publication_date);
  await fillText(page, 'book_mrp', b.mrp);
  await fillText(page, 'book_royalty_per_copy', b.author_royalty_per_copy);
  if (b.print_partner) await selectNth(page, 2, b.print_partner);
  await fillText(page, 'book_platforms', (b.available_on ?? []).join(', '));
  await fillText(page, 'book_author_code', authorCode);
  return saveAndConfirm(page, 'Save book', `Book saved ${b.book_id}`);
}

export async function saveRoyalty(page, b) {
  await fillText(page, 'royalty_book_code', b.book_id);
  await page.fill('css=input[placeholder="royalty_copies_sold"]', String(b.total_copies_sold));
  await page.fill('css=input[placeholder="royalty_earned"]', String(b.total_royalty_earned));
  await page.fill('css=input[placeholder="royalty_paid"]', String(b.royalty_paid));
  await page.fill('css=input[placeholder="royalty_pending"]', String(b.royalty_pending));
  await setDate(page, 'royalty_last_payout_date', b.last_royalty_payout_date);
  return saveAndConfirm(page, 'Save royalty', `Royalty saved ${b.book_id}`);
}
