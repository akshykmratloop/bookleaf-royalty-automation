/**
 * @typedef {Object} FactSource
 * @property {'RECORD'|'KB'|'DERIVED'} kind
 * @property {string} [book] @property {string} [field] @property {string} [section] @property {string} [rule]
 *
 * @typedef {Object} Fact
 * @property {string} id @property {string} label
 * @property {'MONEY'|'DATE'|'COUNT'|'DURATION'|'PERCENT'|'TEXT'} type
 * @property {number|string} value MONEY in paise, DATE YYYY-MM-DD
 * @property {string} display @property {FactSource} source
 *
 * @typedef {Object} BookFacts
 * @property {string} code @property {string} title
 * @property {'GREEN'|'YELLOW'|'RED'|'NONE'} badge @property {string} badgeLabel @property {string} statusText
 * @property {number} copiesSold @property {number} earned @property {number} paid @property {number} pending
 * @property {number} mrp @property {number} royaltyPerCopy
 * @property {string|null} lastPayoutDate @property {string|null} publicationDate
 *
 * @typedef {Object} AuthorFacts
 * @property {string} referenceDate @property {BookFacts[]} books
 * @property {{earned:number, paid:number, pending:number}} totals
 * @property {number} totalBooks @property {number} publishedCount
 * @property {{code:string, title:string, statusLabel:string}[]} inProduction
 * @property {boolean} allPaid @property {boolean} eligibleForPayout @property {string} nextPayoutDate
 * @property {Fact[]} facts
 */
export {};
