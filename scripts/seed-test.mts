/**
 * Seed test data: one user, one granted invite, realistic location history.
 * Run: pnpm tsx scripts/seed-test.mts
 */
import { Pool } from "pg";
import crypto from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const token = "test-token-behav-" + crypto.randomBytes(6).toString("hex");

// ── Realistic city route: London area commuter ────────────────────────────────
// Home area: Brixton (51.4613, -0.1156)
// Work area: Canary Wharf (51.5054, -0.0235)
// Gym: Elephant & Castle (51.4956, -0.1001)
// Coffee spot: Borough Market (51.5055, -0.0910)

const HOME  = { lat: 51.4613, lng: -0.1156 };
const WORK  = { lat: 51.5054, lng: -0.0235 };
const GYM   = { lat: 51.4956, lng: -0.1001 };
const CAFE  = { lat: 51.5055, lng: -0.0910 };

function jitter(v: number, maxDelta = 0.002) {
  return v + (Math.random() - 0.5) * maxDelta;
}

function lerp(a: { lat: number; lng: number }, b: { lat: number; lng: number }, t: number) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

interface LocationRow {
  token: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  source: string;
  address: string | null;
  status: string;
  activity_type: string;
  created_at: Date;
}

const rows: LocationRow[] = [];
const now = Date.now();
const DAY_MS = 86_400_000;

// Generate 28 days of data
for (let day = 27; day >= 0; day--) {
  const base = now - day * DAY_MS;
  const dow = new Date(base).getDay(); // 0=Sun, 6=Sat

  // Skip some days randomly (creates realistic gaps)
  if (Math.random() < 0.1) continue;

  // Helper: add a dwell cluster
  function dwell(loc: typeof HOME, startHour: number, durationMin: number, label: string, activity: string) {
    const t0 = base + startHour * 3_600_000;
    const pts = Math.max(3, Math.round(durationMin / 4));
    for (let i = 0; i < pts; i++) {
      rows.push({
        token,
        latitude: jitter(loc.lat, 0.0008),
        longitude: jitter(loc.lng, 0.0008),
        accuracy: 8 + Math.random() * 12,
        source: "gps",
        address: label,
        status: "active",
        activity_type: activity,
        created_at: new Date(t0 + (i / pts) * durationMin * 60_000),
      });
    }
  }

  // Helper: transit corridor between two points
  function transit(from: typeof HOME, to: typeof HOME, startHour: number, durationMin: number, activity: string) {
    const t0 = base + startHour * 3_600_000;
    const pts = Math.max(4, Math.round(durationMin / 3));
    for (let i = 0; i < pts; i++) {
      const t = i / (pts - 1);
      const pos = lerp(from, to, t);
      rows.push({
        token,
        latitude: jitter(pos.lat, 0.0005),
        longitude: jitter(pos.lng, 0.0005),
        accuracy: 12 + Math.random() * 20,
        source: "gps",
        address: null,
        status: "active",
        activity_type: activity,
        created_at: new Date(t0 + t * durationMin * 60_000),
      });
    }
  }

  if (dow === 0 || dow === 6) {
    // Weekend: late start, gym, café
    dwell(HOME, 8, 90, "Brixton, London", "still");
    transit(HOME, GYM, 10, 20, "walking");
    dwell(GYM, 10.3, 70, "Elephant & Castle Leisure Centre", "still");
    transit(GYM, CAFE, 11.8, 15, "walking");
    dwell(CAFE, 12.0, 60, "Borough Market, London Bridge", "still");
    transit(CAFE, HOME, 13.5, 30, "transit");
    dwell(HOME, 14.5, 180, "Brixton, London", "still");

    // Occasional late evening anomaly (potential evasion signal)
    if (day % 7 === 3) {
      const unknownSpot = { lat: jitter(51.512, 0.01), lng: jitter(-0.08, 0.01) };
      transit(HOME, unknownSpot, 22, 15, "transit");
      dwell(unknownSpot, 22.3, 45, null, "still");
      transit(unknownSpot, HOME, 23.2, 15, "transit");
    }
  } else {
    // Weekday: morning commute, work, evening commute
    dwell(HOME, 7, 30, "Brixton, London", "still");
    transit(HOME, WORK, 7.5, 45, "transit");
    dwell(WORK, 8.2, 240, "Canary Wharf, London", "still");

    // Lunch run (creates speed anomaly some days)
    if (day % 5 === 0) {
      const lunch = { lat: jitter(51.508, 0.005), lng: jitter(-0.025, 0.005) };
      transit(WORK, lunch, 12.5, 8, "running");
      dwell(lunch, 12.6, 30, null, "still");
      transit(lunch, WORK, 13.2, 8, "running");
    }

    dwell(WORK, 13.5, 180, "Canary Wharf, London", "still");

    // Occasional direction reversal mid-commute (evasion signal)
    if (day % 6 === 1) {
      const midPoint = lerp(WORK, HOME, 0.4);
      transit(WORK, midPoint, 17, 20, "transit");
      transit(midPoint, WORK, 17.4, 15, "transit");  // reversal
      transit(WORK, HOME, 17.7, 50, "transit");
    } else {
      transit(WORK, HOME, 17.0, 50, "transit");
    }

    dwell(HOME, 18.0, 180, "Brixton, London", "still");

    // Some days: signal gap (device switched off between 19:00-21:00)
    if (day % 4 === 2) {
      // Gap: no data 19:00–21:00, then resumes
      dwell(HOME, 21.0, 30, "Brixton, London", "still");
    }
  }
}

// Sort by time
rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

async function seed() {
  const client = await pool.connect();
  try {
    // 1. Create or verify test user
    const userRes = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE full_phone = $1`,
      ["+15550001"]
    );
    if (userRes.rows.length === 0) {
      console.log("Creating test user...");
      await client.query(
        `INSERT INTO users (name, phone_number, country_code, country_iso, full_phone) VALUES ($1,$2,$3,$4,$5)`,
        ["Test Agent", "5550001", "+1", "US", "+15550001"]
      );
    }
    const userId = userRes.rows[0]?.id ?? 1;
    console.log(`Using user id=${userId}`);

    // 2. Insert invite
    const inviteRes = await client.query<{ id: number }>(
      `INSERT INTO invites
         (from_user_id, to_phone, to_name, message, status, token, consent_type,
          granted_at, granted_latitude, granted_longitude, granted_address, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9,$10,NOW())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        userId,
        "+447911123456",
        "Jane Doe",
        "Please share your location",
        "granted",
        token,
        "location_only",
        HOME.lat, HOME.lng,
        "Brixton, London",
      ]
    );
    if (inviteRes.rows.length === 0) {
      console.log("Invite already exists, skipping.");
    } else {
      console.log(`Created invite id=${inviteRes.rows[0].id} token=${token}`);
    }

    // 3. Insert location updates
    console.log(`Inserting ${rows.length} location points...`);
    for (const row of rows) {
      await client.query(
        `INSERT INTO location_updates
           (token, latitude, longitude, accuracy, source, address, status, activity_type, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.token, row.latitude, row.longitude, row.accuracy,
         row.source, row.address, row.status, row.activity_type, row.created_at]
      );
    }
    console.log("Done!");
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(e => { console.error(e); process.exit(1); });
