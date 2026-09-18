import { PGlite } from "@electric-sql/pglite";

const dataDir = process.argv[2] || "/home/daytona/codebase/artifacts/api-server/.pglite-data";
const db = new PGlite(dataDir);
const r = await db.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
);
console.log("tables:", r.rows.length);
console.log(r.rows.map((x) => x.table_name).join(", "));
process.exit(0);
