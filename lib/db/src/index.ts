import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// APP_DATABASE_URL can override DATABASE_URL for an external database.
// Only use it if it actually looks like a postgres URL (guards against
// accidentally-set placeholder values).
const raw = process.env.APP_DATABASE_URL ?? "";
const connectionString =
  (raw.startsWith("postgres://") || raw.startsWith("postgresql://"))
    ? raw
    : process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
