/**
 * Where the real-Postgres tests run psql and pg_dump. By default inside the local stack's Postgres 16
 * container (docker exec); with BOOKLEAF_PG_DIRECT=1 straight on this machine, against the server the
 * libpq variables name (PGHOST, PGPORT), as CI does with its Postgres service.
 * BOOKLEAF_PG_CONTAINER overrides the local stack's container.
 */
const DEFAULT_CONTAINER = 'bookleaf-n8n-local-postgres-1';

/**
 * @param {'psql'|'pg_dump'} tool @param {string[]} args @param {Record<string, string|undefined>} env
 * @returns {{file:string, args:string[]}} what to execFile
 * @throws {Error} when BOOKLEAF_PG_DIRECT is set to anything but 1 or 0
 */
export function pgCommand(tool, args, env = process.env) {
  const direct = env.BOOKLEAF_PG_DIRECT ?? '0';
  if (direct !== '1' && direct !== '0') throw new Error('BOOKLEAF_PG_DIRECT must be 1 or 0');
  if (direct === '1') return { file: tool, args };
  return { file: 'docker', args: ['exec', '-i', env.BOOKLEAF_PG_CONTAINER || DEFAULT_CONTAINER, tool, ...args] };
}
