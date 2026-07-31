import { useEffect, useRef } from "react";

/**
 * AncientSky — persistent decorative layer.
 * Spawns birds on varied asymmetric flight paths, drifting feathers, and
 * rotating cave-art glyphs. Nothing loops identically; each element gets
 * randomised delay, duration, size, opacity, and trajectory so the scene
 * always looks alive without repeating.
 */

const BIRDS = ["🦅", "🐦", "🕊️", "🦜"];
const FEATHER_EMOJIS = ["🪶"];
const CAVE_GLYPHS = ["⊕", "⊗", "△", "☽", "⊙", "✦", "⌖", "⋈", "⌇", "⊛"];

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface Particle {
  id: number;
  kind: "bird" | "feather" | "glyph";
  glyph: string;
  top: number;       // vh %
  size: number;      // px
  opacity: number;
  duration: number;  // s
  delay: number;     // s
  path: 1 | 2 | 3;  // flight path variant
  spin: boolean;
}

let uid = 0;
function makeParticle(kind: Particle["kind"]): Particle {
  if (kind === "bird") {
    return {
      id: uid++,
      kind,
      glyph: pick(BIRDS),
      top: rand(5, 78),
      size: rand(18, 34),
      opacity: rand(0.06, 0.14),
      duration: rand(22, 44),
      delay: rand(0, 20),
      path: pick([1, 2, 3] as const),
      spin: false,
    };
  }
  if (kind === "feather") {
    return {
      id: uid++,
      kind,
      glyph: pick(FEATHER_EMOJIS),
      top: rand(0, 30),
      size: rand(18, 30),
      opacity: rand(0.18, 0.45),
      duration: rand(14, 28),
      delay: rand(0, 14),
      path: pick([1, 2, 3] as const),
      spin: true,
    };
  }
  // glyph (cave art)
  return {
    id: uid++,
    kind,
    glyph: pick(CAVE_GLYPHS),
    top: rand(10, 85),
    size: rand(10, 20),
    opacity: rand(0.04, 0.09),
    duration: rand(30, 60),
    delay: rand(0, 30),
    path: 1,
    spin: true,
  };
}

function particleStyle(p: Particle): React.CSSProperties {
  const animName =
    p.kind === "bird"
      ? `sky-path-${p.path}`
      : p.kind === "feather"
      ? `feather-drift-${p.path}`
      : "glyph-breathe";

  return {
    position: "absolute",
    top: `${p.top}%`,
    left: "-10%",
    fontSize: `${p.size}px`,
    opacity: p.opacity,
    animation: `${animName} ${p.duration}s ${p.delay}s linear infinite`,
    filter:
      p.kind === "glyph"
        ? "none"
        : "sepia(0.6) saturate(1.4) drop-shadow(0 4px 10px rgba(0,0,0,0.7))",
    color: p.kind === "glyph" ? "rgba(245,193,108,0.55)" : "rgb(255,202,90)",
    fontFamily: "monospace",
    willChange: "transform",
    pointerEvents: "none",
    userSelect: "none",
  } as React.CSSProperties;
}

const POOL_BIRDS = 5;
const POOL_FEATHERS = 7;
const POOL_GLYPHS = 8;

export function AncientSky() {
  const particlesRef = useRef<Particle[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const particles: Particle[] = [
      ...Array.from({ length: POOL_BIRDS }, () => makeParticle("bird")),
      ...Array.from({ length: POOL_FEATHERS }, () => makeParticle("feather")),
      ...Array.from({ length: POOL_GLYPHS }, () => makeParticle("glyph")),
    ];
    particlesRef.current = particles;

    const container = containerRef.current;
    if (!container) return;

    // Clear old children (hot-reload safety)
    container.innerHTML = "";

    // Aurora blob
    const aurora = document.createElement("div");
    aurora.className = "ancient-sky__aurora";
    container.appendChild(aurora);

    // Spawn particles
    particles.forEach((p) => {
      const el = document.createElement("span");
      Object.assign(el.style, particleStyle(p));
      el.textContent = p.glyph;
      el.setAttribute("aria-hidden", "true");
      container.appendChild(el);
    });
  }, []);

  return (
    <div
      ref={containerRef}
      className="ancient-sky"
      aria-hidden="true"
    />
  );
}
