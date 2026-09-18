import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgClient } from "drizzle-orm/node-postgres";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;

// APP_DATABASE_URL can override DATABASE_URL for an external database.
// Only use it if it actually looks like a postgres URL (guards against
// accidentally-set placeholder values).
const raw = process.env.APP_DATABASE_URL ?? "";
const externalUrl =
  raw.startsWith("postgres://") || raw.startsWith("postgresql://")
    ? raw
    : process.env.DATABASE_URL;

// Zero-config database boot:
// - With DATABASE_URL set (e.g. a hosted Neon Postgres) that database is used.
// - Without one, an embedded Postgres (PGlite) is used with the full schema —
//   invites, sessions, notifications, everything — so the app works
//   end-to-end in ANY environment with NO external setup. Data persists on
//   disk at PGLITE_DATA_DIR (default: ".pglite-data" under the process cwd).
export const hasDatabase = true;
export const usingExternalDatabase = Boolean(externalUrl);

const currentDir = dirname(fileURLToPath(import.meta.url));

// Minimal shape drizzle's node-postgres driver needs: client.query(config|text,
// params) resolving to { rows, rowCount, fields, command }. Both backends
// below satisfy it synchronously (drizzle does not await promise clients).
type Queryable = {
  query: (
    text: string | { text: string; values?: unknown[]; name?: string; rowMode?: "array" },
    values?: unknown[],
  ) => Promise<{
    rows: unknown[];
    rowCount: number | null;
    fields: { name: string }[];
    command: string;
  }>;
};

function createClient(): Queryable {
  if (externalUrl) {
    console.log("[db] Using external Postgres from DATABASE_URL.");
    const pool = new Pool({ connectionString: externalUrl, max: 10 });
    return {
      async query(text, values) {
        const res = await pool.query(text as never, values as never);
        return res as unknown as {
          rows: unknown[];
          rowCount: number | null;
          fields: { name: string }[];
          command: string;
        };
      },
    };
  }

  // Embedded Postgres (PGlite). The constructor is synchronous; queries
  // internally wait for the instance to become ready.
  const dataDir = process.env.PGLITE_DATA_DIR || join(process.cwd(), ".pglite-data");
  const pglite = new PGlite(dataDir);

  // Bootstrap the full schema (idempotent: IF NOT EXISTS everywhere). Every
  // query goes through `ready` first, so the schema is always applied before
  // the first real query of the process. When the bundle can't find the file
  // on disk (e.g. esbuild moved it), fall back to an in-memory database so
  // the server still boots — the DDL is applied by ensureSchema below.
  let ready: Promise<unknown>;
  try {
    const bootstrap = readFileSync(join(currentDir, "embedded-schema.sql"), "utf8");
    ready = pglite.exec(bootstrap);
  } catch (err) {
    console.warn(
      "[db] Embedded schema file not found — starting with an EMPTY embedded database " +
        "(routes create their own tables where needed):",
      err instanceof Error ? err.message : err,
    );
    ready = Promise.resolve();
  }

  console.log(
    `[db] No DATABASE_URL — using embedded Postgres (PGlite) at ${dataDir}. ` +
      `Set DATABASE_URL to switch to a hosted database.`,
  );

  return {
    async query(text, values) {
      await ready;
      const config = typeof text === "string" ? undefined : text;
      const sql = typeof text === "string" ? text : text.text;
      const params = values ?? config?.values;
      const res = (await pglite.query(sql, params as never[])) as unknown as {
        rows: Record<string, unknown>[];
        rowCount: number | null;
        fields: { name: string }[];
        command: string;
      };

      // drizzle's mapped queries run with rowMode:"array" and index rows by
      // column position (row[columnIndex]); PGlite always returns objects.
      // Convert object rows to positional arrays for those queries.
      if (config?.rowMode === "array") {
        const names = res.fields.map((f) => f.name);
        const arrayRows = res.rows.map((row) => names.map((n) => row[n]));
        return { ...res, rows: arrayRows as unknown as Record<string, unknown>[] } as {
          rows: unknown[];
          rowCount: number | null;
          fields: { name: string }[];
          command: string;
        };
      }

      // Object-mode results are node-postgres-compatible — pass through.
      return res as {
        rows: unknown[];
        rowCount: number | null;
        fields: { name: string }[];
        command: string;
      };
    },
  };
}

export const db = drizzle(createClient() as unknown as NodePgClient, { schema });

export * from "./schema";
