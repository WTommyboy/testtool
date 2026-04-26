import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type PgDb = NodePgDatabase<typeof schema>;

export const createPgPool = (connectionString = process.env.DATABASE_URL): pg.Pool => {
  if (!connectionString) {
    throw new Error("DATABASE_URL_REQUIRED");
  }
  return new Pool({ connectionString });
};

export const createPgDb = (pool: pg.Pool): PgDb => {
  return drizzle(pool, { schema });
};

export const createDbFromEnv = (): { pool: pg.Pool; db: PgDb } => {
  const pool = createPgPool();
  return {
    pool,
    db: createPgDb(pool)
  };
};
