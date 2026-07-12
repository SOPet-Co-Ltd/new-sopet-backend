/**
 * SSL options for node-postgres / TypeORM.
 * Crunchy Bridge and similar managed Postgres hosts require encrypted connections.
 */
export function getPostgresSslOptions(): false | { require: true; rejectUnauthorized: false } {
  if (process.env.DB_SSL !== 'true') {
    return false;
  }

  return {
    require: true,
    rejectUnauthorized: false,
  };
}
