/** Entry point of the error handler's "Alert Address" Code node. */
import { alertAddress as pick } from '../../src/pipeline/alert-cache.js';

/** Fail Job's row (or its error item) and the workflow's static data → the alert's address. */
export const alertAddress = ({ row, cache, now }) => [{ json: pick({ row, cache, now }) }];
