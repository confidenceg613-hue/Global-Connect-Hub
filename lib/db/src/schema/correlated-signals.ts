import {
  pgTable, serial, text, doublePrecision, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";

/**
 * correlated_signals — multi-source location intelligence events.
 *
 * Accepts signals from any source (GPS, Wi-Fi, cellular, Bluetooth,
 * payment/transaction timestamps, vehicle telematics, manual entries).
 * The fusion engine combines these into a continuous timeline even
 * when individual sources are absent or deliberately obscured.
 *
 * token: same invite token used by location_updates, so both tables
 *        can be queried together for a contact.
 */
export const correlatedSignalsTable = pgTable(
  "correlated_signals",
  {
    id: serial("id").primaryKey(),

    /** Invite token — same namespace as location_updates.token */
    token: text("token").notNull(),

    /**
     * Source category.
     *  gps        — device GPS fix
     *  wifi       — Wi-Fi BSSID/SSID geolocation
     *  cellular   — cell-tower triangulation
     *  bluetooth  — BLE beacon proximity
     *  payment    — payment / transaction timestamp + merchant address
     *  telematics — vehicle OBD/telematics feed
     *  manual     — operator-entered observation
     */
    sourceType: text("source_type").notNull(),

    /** Best-estimate position derived from this signal (null if only temporal) */
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),

    /** Estimated horizontal accuracy in metres */
    accuracy: doublePrecision("accuracy"),

    /**
     * Pre-computed source confidence [0, 1].
     * Defaults: gps=0.95, telematics=0.85, wifi=0.65,
     *           cellular=0.50, bluetooth=0.40, payment=0.30, manual=0.70
     * Callers may override for known-good or known-poor hardware.
     */
    confidence: doublePrecision("confidence").notNull(),

    /** Human-readable place name / merchant / SSID (optional) */
    label: text("label"),

    /**
     * Raw source metadata — fully source-specific:
     *  wifi:       { bssid, ssid, rssi, channel }
     *  cellular:   { mcc, mnc, lac, cellId, rssi }
     *  bluetooth:  { beaconId, uuid, major, minor, rssi, txPower }
     *  payment:    { merchant, amount, currency, last4, network }
     *  telematics: { vin, speed_kmh, heading, odometer, ignition }
     *  gps:        { satellites, hdop, altitude }
     */
    metadata: jsonb("metadata"),

    /** When this signal was observed (authoritative event time) */
    observedAt: timestamp("observed_at").notNull(),

    /** When this row was inserted */
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    tokenIdx:      index("cs_token_idx").on(t.token),
    observedAtIdx: index("cs_observed_at_idx").on(t.observedAt),
    sourceTypeIdx: index("cs_source_type_idx").on(t.sourceType),
  }),
);

export type CorrelatedSignal      = typeof correlatedSignalsTable.$inferSelect;
export type NewCorrelatedSignal   = typeof correlatedSignalsTable.$inferInsert;
