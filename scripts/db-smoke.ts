/**
 * Quick smoke test for the zero-config embedded database.
 * Run from the repo root:  bun scripts/db-smoke.ts
 */
const { db, usersTable } = await import("../lib/db/src/index.ts");

// insert
const name = "Smoke " + Date.now();
const [u] = await db
  .insert(usersTable)
  .values({
    name,
    phoneNumber: "080" + Math.floor(Math.random() * 1e8),
    countryCode: "+234",
    countryIso: "NG",
  })
  .returning();
console.log("INSERT ok, id:", u.id, "name:", u.name);

// select
const rows = await db.select().from(usersTable);
console.log("SELECT ok, users:", rows.length);

// update (by the returning row's id using drizzle's eq through the schema re-export path)
const { eq } = await import("../lib/db/node_modules/drizzle-orm/index.js");
await db.update(usersTable).set({ name: "Smoke2" }).where(eq(usersTable.id, u.id));
const [after] = await db.select().from(usersTable);
console.log("UPDATE ok, name:", after.name);

// delete
await db.delete(usersTable);
const rows2 = await db.select().from(usersTable);
console.log("DELETE ok, remaining:", rows2.length);
