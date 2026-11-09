export const DEFAULT_BRAND = Object.freeze({
  name: 'BookLeaf Publishing',
  headerColor: '#1f4d3a',
  backgroundColor: '#faf7f2',
  supportEmail: '',
});

const HEX = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/**
 * @typedef {{name?:string, headerColor?:string, backgroundColor?:string, supportEmail?:string}} BrandInput
 * @param {BrandInput} [input] @returns {typeof DEFAULT_BRAND} brand with colours validated as hex
 */
export function resolveBrand(input = {}) {
  const pick = (k) => (typeof input[k] === 'string' && input[k].trim() ? input[k].trim() : DEFAULT_BRAND[k]);
  const color = (k) => (HEX.test(pick(k)) ? pick(k) : DEFAULT_BRAND[k]);
  return {
    name: pick('name').slice(0, 80),
    headerColor: color('headerColor'),
    backgroundColor: color('backgroundColor'),
    supportEmail: typeof input.supportEmail === 'string' ? input.supportEmail.trim().slice(0, 254) : '',
  };
}
