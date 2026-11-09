/**
 * @typedef {Object} AuthorInfo
 * @property {string} id @property {string} code @property {string} name
 * @property {string} firstName @property {string} email @property {string} city
 *
 * @typedef {Object} Book
 * @property {string} code @property {string} title @property {string} isbn @property {string} genre
 * @property {'PUBLISHED'|'IN_PRODUCTION'} status
 * @property {string} statusLabel original status text
 * @property {string|null} publicationDate YYYY-MM-DD
 * @property {number} mrp rupees (0 when not set) @property {number} royaltyPerCopy rupees (0 when not set)
 * @property {number} copiesSold @property {number} earned @property {number} paid @property {number} pending
 * @property {string|null} lastPayoutDate @property {string|null} printPartner @property {string[]} platforms
 *
 * @typedef {Object} AuthorBundle
 * @property {AuthorInfo} author @property {Book[]} books
 *
 * @typedef {Object} ValidationError
 * @property {string} path @property {string} code @property {string} message
 *
 * @typedef {{ok:true, value:*}|{ok:false, errors:ValidationError[]}} Result
 */
export {};
