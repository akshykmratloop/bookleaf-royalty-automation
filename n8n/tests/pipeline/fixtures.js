export { payloadFor, AUTHORS_BY_CLASS, SAMPLE } from '../../../tests/fixtures/payloads.js';
import { SAMPLE } from '../../../tests/fixtures/payloads.js';

export const sampleAuthor = (code) => SAMPLE.authors.find((a) => a.author_id === code);
