/** @param {number} rupees whole rupees @returns {string} e.g. "₹1,00,000" */
export function formatInr(rupees) {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rupees)}`;
}

/** @param {number} rupees @returns {number} integer paise */
export const toPaise = (rupees) => Math.round(rupees * 100);
