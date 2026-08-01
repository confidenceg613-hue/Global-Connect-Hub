import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "url";
import path from "path";

const dbUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
