/** A job id as Postgres makes it (gen_random_uuid: version 4); version 1 to 8 are accepted. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
