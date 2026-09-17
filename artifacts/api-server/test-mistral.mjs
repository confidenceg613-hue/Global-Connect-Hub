// One-off verification: does the Mistral key authenticate?
// Prints only the HTTP status + first 200 chars of the response — never the key.
import { readFileSync } from "node:fs";

let key = process.env.MISTRAL_API_KEY ?? process.env.Mistral_API_KEY ?? "";
if (!key) {
  // Load candidate env files (never printing values) — mirrors --env-file-if-exists
  const candidates = ["../../.env.local", "../../.env", ".env.local", ".env"];
  for (const f of candidates) {
    try {
      const text = readFileSync(f, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*(MISTRAL_API_KEY|Mistral_API_KEY)\s*=\s*(.+)\s*$/);
        if (m) {
          key = m[2].replace(/^["']|["']$/g, "").trim();
          console.log("key found in:", f);
          break;
        }
      }
      if (key) break;
    } catch { /* file missing — next */ }
  }
}
if (!key) { console.log("NO KEY FOUND in env or .env.local"); process.exit(1); }
console.log("key loaded:", key.length, "chars, first 4:", key.slice(0, 4) + "…");

// Probe which models the key's tier allows
const models = ["mistral-small-latest", "open-mistral-nemo", "ministral-8b-latest", "pixtral-12b-2409", "mistral-large-latest"];
for (const model of models) {
  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply OK" }], max_tokens: 5 }),
    });
    const body = await r.text();
    console.log(`${model}: HTTP ${r.status} ${r.status === 200 ? "✅" : body.slice(0, 80)}`);
  } catch (e) {
    console.log(`${model}: ERR ${e.message}`);
  }
}
