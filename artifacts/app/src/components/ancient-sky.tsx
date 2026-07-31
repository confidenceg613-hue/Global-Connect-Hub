import { useEffect, useRef } from "react";

/**
 * AncientSky — persistent, pointer-free atmospheric layer.
 *
 * Desktop: 5 birds · 7 feathers · 8 cave-art glyphs, all randomised.
 * Mobile : 3 birds · 4 feathers · 4 glyphs — no CSS `filter` (avoids the
 *          Android-Chrome fixed+filter+transform compositor explosion that
 *          caused ghost duplicate cards). Opacity + transform only, which
 *          sit on dedicated GPU layers without triggering extra compositing.
 */

const BIRDS        = ["🦅", "🐦", "🕊️", "🦆"];
const FEATHERS     = ["🪶"];
const CAVE_GLYPHS  = ["⊕", "⊗", "△", "☽", "⊙", "✦", "⌖", "⋈", "⌇", "⊛"];

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

let _uid = 0;

interface P {
  kind: "bird" | "feather" | "glyph";
  glyph: string;
  top: number;
  left: number;    // starting left % (for glyphs that don't fly across)
  size: number;
  opacity: number;
  dur: number;
  delay: number;
  path: 1 | 2 | 3;
  isMobile: boolean;
}

function make(kind: P["kind"], mobile: boolean): P {
  const base = {
    kind,
    glyph:   kind === "bird" ? pick(BIRDS) : kind === "feather" ? pick(FEATHERS) : pick(CAVE_GLYPHS),
    isMobile: mobile,
    left: 0,
    path: pick([1, 2, 3] as const),
  };

  if (kind === "bird") return {
    ...base,
    top:     rand(4, 76),
    size:    mobile ? rand(16, 26) : rand(18, 34),
    opacity: mobile ? rand(0.12, 0.22) : rand(0.06, 0.14),
    dur:     mobile ? rand(18, 32) : rand(22, 44),
    delay:   rand(0, 20),
  };

  if (kind === "feather") return {
    ...base,
    top:     rand(0, 25),
    left:    rand(5, 90),
    size:    mobile ? rand(16, 24) : rand(18, 30),
    opacity: mobile ? rand(0.25, 0.50) : rand(0.18, 0.45),
    dur:     mobile ? rand(12, 22) : rand(14, 28),
    delay:   rand(0, 14),
  };

  // glyph
  return {
    ...base,
    top:     rand(10, 85),
    left:    rand(5, 90),
    size:    mobile ? rand(11, 18) : rand(10, 20),
    opacity: mobile ? rand(0.07, 0.13) : rand(0.04, 0.09),
    dur:     mobile ? rand(25, 45) : rand(30, 60),
    delay:   rand(0, 30),
  };
}

export function AncientSky() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const mobile = window.innerWidth < 768;
    const birdN   = mobile ? 3 : 5;
    const featherN = mobile ? 4 : 7;
    const glyphN   = mobile ? 4 : 8;

    container.innerHTML = "";

    // Aurora blob — uses only opacity+transform on mobile, blur only on desktop
    const aurora = document.createElement("div");
    aurora.className = mobile ? "ancient-sky__aurora ancient-sky__aurora--mobile" : "ancient-sky__aurora";
    container.appendChild(aurora);

    const particles: P[] = [
      ...Array.from({ length: birdN },    () => make("bird",    mobile)),
      ...Array.from({ length: featherN }, () => make("feather", mobile)),
      ...Array.from({ length: glyphN },   () => make("glyph",   mobile)),
    ];

    particles.forEach((p) => {
      const el = document.createElement("span");

      const animName =
        p.kind === "bird"    ? `sky-path-${p.path}` :
        p.kind === "feather" ? `feather-drift-${p.path}` :
        "glyph-breathe";

      Object.assign(el.style, {
        position:       "absolute",
        top:            `${p.top}%`,
        // Birds fly in from off-screen left; feathers & glyphs start at their left pos
        left: p.kind === "bird" ? "-10%" : `${p.left}%`,
        fontSize:       `${p.size}px`,
        opacity:        String(p.opacity),
        animation:      `${animName} ${p.dur}s ${p.delay}s linear infinite`,
        // Mobile: NO filter — avoids compositor tile explosion on Android Chrome.
        // Desktop: subtle sepia tint for warmth.
        filter: (!mobile && p.kind !== "glyph")
          ? "sepia(0.5) saturate(1.3) drop-shadow(0 4px 8px rgba(0,0,0,0.65))"
          : "none",
        color:          p.kind === "glyph" ? "rgba(245,193,108,0.6)" : "rgba(255,202,90,0.9)",
        willChange:     "transform, opacity",
        pointerEvents:  "none",
        userSelect:     "none",
        fontFamily:     p.kind === "glyph" ? "monospace" : "inherit",
        // Force own compositor layer without filter
        transform:      "translateZ(0)",
      });

      el.textContent = p.glyph;
      el.setAttribute("aria-hidden", "true");
      container.appendChild(el);
    });

    return () => { container.innerHTML = ""; };
  }, []);

  return <div ref={ref} className="ancient-sky" aria-hidden="true" />;
}
