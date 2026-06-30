// ─── Location Intelligence Engine ─────────────────────────────────────────────
// Fully client-side. No API key. Uses address text + coordinates + timezone.

export type LocationType =
  | "transport"
  | "healthcare"
  | "educational"
  | "government"
  | "industrial"
  | "commercial"
  | "nature"
  | "religious"
  | "residential"
  | "unknown";

export interface LocationIntelligence {
  locationType: LocationType;
  typeLabel: string;
  typeIcon: string;
  pinColor: string;
  riskLevel: "low" | "medium" | "high";
  riskLabel: string;
  description: string;
  tags: string[];
  clusterFlag: boolean;
  clusterReason?: string;
  confidence: number; // 0–1
}

export const TYPE_CONFIG: Record<
  LocationType,
  { label: string; icon: string; color: string; risk: "low" | "medium" | "high" }
> = {
  transport:   { label: "Transport Hub",   icon: "✈️",  color: "#06b6d4", risk: "medium" },
  healthcare:  { label: "Healthcare",      icon: "🏥",  color: "#10b981", risk: "low"    },
  educational: { label: "Education",       icon: "🎓",  color: "#8b5cf6", risk: "low"    },
  government:  { label: "Gov / Military",  icon: "🏛️",  color: "#ef4444", risk: "high"   },
  industrial:  { label: "Industrial",      icon: "🏭",  color: "#f97316", risk: "medium" },
  commercial:  { label: "Commercial",      icon: "🏬",  color: "#f59e0b", risk: "low"    },
  nature:      { label: "Nature / Park",   icon: "🌿",  color: "#22c55e", risk: "low"    },
  religious:   { label: "Religious",       icon: "⛪",  color: "#a855f7", risk: "low"    },
  residential: { label: "Residential",     icon: "🏠",  color: "#3b82f6", risk: "low"    },
  unknown:     { label: "Unknown",         icon: "📍",  color: "#6366f1", risk: "low"    },
};

const RISK_LABELS = { low: "Low Risk", medium: "Moderate", high: "High Risk" };

interface Rule {
  pattern: RegExp;
  type: LocationType;
  tags: string[];
  descFn: (addr: string) => string;
}

const RULES: Rule[] = [
  {
    pattern: /airport|terminal|aéroport|aeropuerto|flughafen|航空|机场|heliport|airfield|runway/i,
    type: "transport",
    tags: ["High-traffic", "Transit zone", "Security perimeter"],
    descFn: () => "Major transport hub — high-volume transit area with security infrastructure.",
  },
  {
    pattern: /train|railway|station|metro|subway|gare|bahnhof|transit|bus depot|ferry/i,
    type: "transport",
    tags: ["Transit hub", "Public infrastructure"],
    descFn: () => "Ground transport node — likely a busy commuter corridor.",
  },
  {
    pattern: /hospital|clinic|medical|health centre|health center|infirmary|pharmacy|dispensary|surgery|maternity|polyclinic/i,
    type: "healthcare",
    tags: ["Medical facility", "Sensitive location"],
    descFn: () => "Healthcare facility — high foot traffic, sensitive patient privacy zone.",
  },
  {
    pattern: /university|college|school|academy|campus|institute|polytechnic|seminary|kindergarten|preschool/i,
    type: "educational",
    tags: ["Educational campus", "Large population density"],
    descFn: () => "Education campus — typically large grounds with student and staff activity.",
  },
  {
    pattern: /government|ministry|parliament|embassy|consulate|court|tribunal|police|military|army|navy|barracks|federal|municipal/i,
    type: "government",
    tags: ["Restricted access", "Security zone", "Official premises"],
    descFn: () => "Government or security facility — restricted-access zone with formal protocols.",
  },
  {
    pattern: /industrial|factory|warehouse|plant|refinery|port|harbour|harbor|dock|shipyard|manufacturing|depot|logistics/i,
    type: "industrial",
    tags: ["Industrial zone", "Operational site"],
    descFn: () => "Industrial zone — operational facility with restricted civilian access.",
  },
  {
    pattern: /mall|shopping|supermarket|market|plaza|commercial|office park|business|bank|hotel|restaurant|retail/i,
    type: "commercial",
    tags: ["Commercial zone", "Public area"],
    descFn: (addr) =>
      addr.toLowerCase().includes("hotel")
        ? "Hospitality venue — hotel or lodging in a commercial district."
        : "Commercial district — retail or business area with regular public foot traffic.",
  },
  {
    pattern: /park|forest|nature|reserve|wildlife|beach|lake|river|mountain|valley|trail|garden|botanical|national park/i,
    type: "nature",
    tags: ["Open area", "Low infrastructure"],
    descFn: () => "Natural or recreational area — open land with limited built infrastructure.",
  },
  {
    pattern: /church|mosque|masjid|temple|synagogue|cathedral|chapel|shrine|basilica|religious|worship/i,
    type: "religious",
    tags: ["Place of worship", "Community gathering"],
    descFn: () => "Place of worship — community religious or cultural site.",
  },
];

/** Derive continent / broad region from coordinates */
function coordRegion(lat: number, lng: number): string {
  if (lat > 35 && lat < 72 && lng > -25 && lng < 45) return "Europe";
  if (lat > -35 && lat < 38 && lng > -20 && lng < 55) return "Africa";
  if (lat > 5 && lat < 55 && lng > 25 && lng < 145) return "Asia";
  if (lat > 15 && lat < 75 && lng > -170 && lng < -50) return "North America";
  if (lat > -60 && lat < 15 && lng > -82 && lng < -34) return "South America";
  if (lat > -50 && lat < -10 && lng > 110 && lng < 180) return "Oceania";
  return "Unknown region";
}

export function analyzeLocation(
  address: string | null | undefined,
  lat: number,
  lng: number,
): LocationIntelligence {
  const addr = address ?? "";
  const region = coordRegion(lat, lng);

  for (const rule of RULES) {
    if (rule.pattern.test(addr)) {
      const cfg = TYPE_CONFIG[rule.type];
      const highRisk = cfg.risk === "high";
      return {
        locationType: rule.type,
        typeLabel: cfg.label,
        typeIcon: cfg.icon,
        pinColor: cfg.color,
        riskLevel: cfg.risk,
        riskLabel: RISK_LABELS[cfg.risk],
        description: rule.descFn(addr),
        tags: rule.tags,
        clusterFlag: highRisk || rule.type === "transport",
        clusterReason: highRisk
          ? "Government/military proximity detected"
          : rule.type === "transport"
          ? "High-traffic transit zone — identity verification advised"
          : undefined,
        confidence: 0.85,
      };
    }
  }

  // Fallback heuristics based on address complexity
  const wordCount = addr.split(/\s+/).filter(Boolean).length;
  const hasNumber = /\d/.test(addr);
  const isLikelyStreet = hasNumber && wordCount >= 3;

  const cfg = TYPE_CONFIG["residential"];
  return {
    locationType: "residential",
    typeLabel: cfg.label,
    typeIcon: cfg.icon,
    pinColor: cfg.color,
    riskLevel: "low",
    riskLabel: RISK_LABELS.low,
    description: isLikelyStreet
      ? `Residential address in ${region}. Likely a private or community zone.`
      : `Location in ${region}. No specific facility type identified from available data.`,
    tags: isLikelyStreet ? ["Street address", region] : ["General area", region],
    clusterFlag: false,
    confidence: isLikelyStreet ? 0.6 : 0.3,
  };
}

/** Check if two locations are geographically co-located (within radiusKm) */
export function findClusters(
  items: Array<{ id: number; lat: number; lng: number; phone: string }>,
  radiusKm = 2,
): Set<string> {
  const clustered = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const dLat = ((b.lat - a.lat) * Math.PI) / 180;
      const dLng = ((b.lng - a.lng) * Math.PI) / 180;
      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((a.lat * Math.PI) / 180) *
          Math.cos((b.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      const km = 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
      if (km < radiusKm) {
        clustered.add(a.phone);
        clustered.add(b.phone);
      }
    }
  }
  return clustered;
}
