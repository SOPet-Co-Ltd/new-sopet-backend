import { types } from 'pg';

const TIMESTAMP_OID = 1114;

let configured = false;

/**
 * PostgreSQL `timestamp without time zone` values are stored as UTC wall-clock
 * time in this project. node-pg otherwise parses them in the Node process local
 * timezone, which shifts instants on machines outside UTC (e.g. Thailand).
 */
export function configurePgUtcTimestampParsing(): void {
  if (configured) {
    return;
  }

  types.setTypeParser(TIMESTAMP_OID, (value: string) => new Date(`${value}Z`));
  configured = true;
}
