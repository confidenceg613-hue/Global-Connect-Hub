import { useMemo } from "react";
import {
  BatSVG, BlackBirdSVG, EagleSVG, OwlSVG,
  PenguinSVG, TurkeySVG, ButterflySVG,
} from "./bird-sprites";

/**
 * AncientSky — persistent decorative layer.
 * Seven live birds with individually animated wings + legs fly across the sky.
 * Cave-art glyphs and feathers drift in between.
 * Mobile: lighter count, no CSS filter (prevents Android compositor glitch).
 */

type BirdKind = "bat" | "blackbird" | "eagle" | "owl" | "penguin" | "turkey" | "butterfly";

const BIRD_COMPONENTS: Record<BirdKind, (props: { size: number }) => React.ReactElement> = {
  bat:        ({ size }) => <BatSVG size={size} />,
  blackbird:  ({ size }) => <BlackBirdSVG size={size} />,
  eagle:      ({ size }) => <EagleSVG size={size} />,
  owl:        ({ size }) => <OwlSVG size={size} />,
  penguin:    ({ size }) => <PenguinSVG size={size} />,
  turkey:     ({ size }) => <TurkeySVG size={size} />,
  butterfly:  ({ size }) => <ButterflySVG size={size} />,
};

const ALL_KINDS: BirdKind[] = ["bat","blackbird","eagle","owl","penguin","turkey","butterfly"];
const CAVE_GLYPHS = ["⊕","⊗","△","☽","⊙","✦","⌖","⋈","⌇","⊛"];
const FEATHER = "🪶";

function rand(min: number, max: number) { return min + Math.random() * (max - min); }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

interface BirdEntry {
  id: number;
  kind: BirdKind;
  size: number;
  top: number;
  dur: number;
  delay: number;
  path: 1 | 2 | 3;
  opacity: number;
}
interface GlyphEntry {
  id: number;
  char: string;
  top: number;
  left: number;
  size: number;
  opacity: number;
  dur: number;
  delay: number;
}
interface FeatherEntry {
  id: number;
  top: number;
  left: number;
  size: number;
  opacity: number;
  dur: number;
  delay: number;
  path: 1 | 2 | 3;
}

let _uid = 0;

function buildScene(mobile: boolean) {
  const birdCount    = mobile ? 4 : 7;
  const glyphCount   = mobile ? 3 : 7;
  const featherCount = mobile ? 10 : 20;

  // One of each bird kind, shuffled; take first birdCount
  const shuffled = [...ALL_KINDS].sort(() => Math.random() - 0.5);
  const kinds = shuffled.slice(0, birdCount);

  const birds: BirdEntry[] = kinds.map((kind) => ({
    id: _uid++,
    kind,
    size: kind === "eagle" ? rand(44, 60)
        : kind === "bat"   ? rand(40, 56)
        : kind === "turkey"|| kind === "owl" ? rand(34, 48)
        : rand(28, 42),
    top:   rand(5, 72),
    dur:   kind === "butterfly" ? rand(28, 46)
         : kind === "eagle"     ? rand(32, 50)
         : kind === "bat"       ? rand(18, 28)
         : rand(22, 38),
    delay: rand(0, 24),
    path:  pick([1, 2, 3] as const),
    opacity: kind === "butterfly" ? rand(0.55, 0.85)
           : mobile               ? rand(0.18, 0.30)
           : rand(0.12, 0.22),
  }));

  const glyphs: GlyphEntry[] = Array.from({ length: glyphCount }, () => ({
    id:      _uid++,
    char:    pick(CAVE_GLYPHS),
    top:     rand(8, 88),
    left:    rand(5, 90),
    size:    rand(10, 18),
    opacity: rand(0.05, 0.10),
    dur:     rand(28, 55),
    delay:   rand(0, 30),
  }));

  const feathers: FeatherEntry[] = Array.from({ length: featherCount }, () => ({
    id:      _uid++,
    top:     rand(0, 28),
    left:    rand(5, 88),
    size:    mobile ? rand(18, 32) : rand(22, 40),
    opacity: mobile ? rand(0.28, 0.55) : rand(0.22, 0.52),
    dur:     rand(12, 26),
    delay:   rand(0, 16),
    path:    pick([1, 2, 3] as const),
  }));

  return { birds, glyphs, feathers };
}

export function AncientSky() {
  const mobile = typeof window !== "undefined" && window.innerWidth < 768;

  // useMemo so the scene is stable across re-renders but built once on mount
  const { birds, glyphs, feathers } = useMemo(
    () => buildScene(mobile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="ancient-sky" aria-hidden="true">
      {/* Aurora glow */}
      <div className={`ancient-sky__aurora${mobile ? " ancient-sky__aurora--mobile" : ""}`} />

      {/* ── Live birds ── */}
      {birds.map((b) => {
        const Comp = BIRD_COMPONENTS[b.kind];
        return (
          <div
            key={b.id}
            className={`sky-bird-wrap sky-path-${b.path}`}
            style={{
              position: "absolute",
              top: `${b.top}%`,
              left: "-12%",
              opacity: b.opacity,
              animationDuration: `${b.dur}s`,
              animationDelay:    `${b.delay}s`,
              // No CSS filter on mobile — prevents Android Chrome compositor glitch
              filter: mobile ? "none"
                : "drop-shadow(0 6px 14px rgba(0,0,0,0.7)) sepia(0.2) saturate(1.2)",
              willChange: "transform",
              // slight body bob
              animation: `sky-path-${b.path} ${b.dur}s ${b.delay}s linear infinite,
                          sky-body-bob 1.8s ${rand(0,1.8).toFixed(2)}s ease-in-out infinite`,
            } as React.CSSProperties}
          >
            <Comp size={b.size} />
          </div>
        );
      })}

      {/* ── Drifting feathers ── */}
      {feathers.map((f) => (
        <span
          key={f.id}
          style={{
            position:  "absolute",
            top:       `${f.top}%`,
            left:      `${f.left}%`,
            fontSize:  `${f.size}px`,
            opacity:   f.opacity,
            animation: `feather-drift-${f.path} ${f.dur}s ${f.delay}s ease-in-out infinite`,
            willChange:"transform, opacity",
            pointerEvents: "none",
          }}
        >
          {FEATHER}
        </span>
      ))}

      {/* ── Cave-art glyphs ── */}
      {glyphs.map((g) => (
        <span
          key={g.id}
          style={{
            position:  "absolute",
            top:       `${g.top}%`,
            left:      `${g.left}%`,
            fontSize:  `${g.size}px`,
            opacity:   g.opacity,
            color:     "rgba(245,193,108,0.7)",
            fontFamily:"monospace",
            animation: `glyph-breathe ${g.dur}s ${g.delay}s ease-in-out infinite`,
            willChange:"transform, opacity",
            pointerEvents:"none",
          }}
        >
          {g.char}
        </span>
      ))}
    </div>
  );
}
