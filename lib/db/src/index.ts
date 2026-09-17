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

// The database is OPTIONAL at import time. Features that need it (invites,
// notifications, assistant history...) fail soft per-request; features that
// don't (the Mistral/Gemini/Groq AI assistant, Guardian AI) keep working.
// This lets the API server boot with no DATABASE_URL — e.g. in dev previews —
// instead of crashing the whole backend at module load.
export const hasDatabase = Boolean(connectionString);

if (!connectionString) {
  console.warn(
    "[db] DATABASE_URL not set — server boots in AI-only mode " +
      "(database-backed features degrade gracefully per request).",
  );
}

export const pool = new Pool(connectionString ? { connectionString } : {});
export const db = drizzle(pool, { schema });

export * from "./schema";
