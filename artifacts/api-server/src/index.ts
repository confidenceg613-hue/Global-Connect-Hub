import app from "./app";
import { seedManualPins } from "@workspace/db/seeds/manual-pins";

const PORT = Number(process.env.PORT) || 8080;

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await seedManualPins();
  } catch (err) {
    console.warn("[seed] manual_pins seed failed (non-fatal):", err);
  }
});
