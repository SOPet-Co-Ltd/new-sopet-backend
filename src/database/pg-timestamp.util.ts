import { types } from 'pg';

const TIMESTAMP_OID = 1114;

let configured = false;

/**
 * PostgreSQL `timestamp without time zone` values are stored as UTC wall-clock
 * time in this project. node-pg otherwise reads and writes them in the Node
 * process local timezone, which shifts instants on machines outside UTC
 * (e.g. Thailand shows ~7h extra on a 15-minute QR payment countdown).
 */
export function configurePgUtcTimestampParsing(): void {
  if (configured) {
    return;
  }

  // Writes must use UTC wall-clock too; otherwise Bangkok-local values are
  // stored then read back as UTC (+7h ahead).
  process.env.TZ = 'UTC';

  types.setTypeParser(TIMESTAMP_OID, (value: string) => new Date(`${value}Z`));
  configured = true;
}
