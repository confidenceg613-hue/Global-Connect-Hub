// TODO(dashboard-redesign): shared decorative art for the feather/sky dashboard theme.
import type { CSSProperties } from "react";

const DOVE_PATH =
  "M21 5c-.7.3-1.4.5-2.2.6A3.9 3.9 0 0 0 20.4 3c-.7.4-1.5.7-2.4 1a3.8 3.8 0 0 0-6.5 2.7c0 .3 0 .6.1.9A11 11 0 0 1 3.4 4.1a3.8 3.8 0 0 0 1.2 5.1c-.6 0-1.2-.2-1.7-.4v.1c0 1.8 1.3 3.4 3.1 3.7-.6.2-1.2.2-1.8.1a3.8 3.8 0 0 0 3.6 2.6A7.7 7.7 0 0 1 2 17a11 11 0 0 0 6 1.7c7.1 0 11-5.9 11-11v-.5c.8-.5 1.5-1.2 2-2.2z";

/** Golden glowing dove — the menu button in the top-right corner. */
export function GoldenBird({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={{ filter: "drop-shadow(0 0 7px rgba(246,197,96,0.7))" }}
      aria-hidden="true"
    >
      <path d={DOVE_PATH} fill="#f4c273" />
    </svg>
  );
}

/** White dove silhouette used inside the sky action cards. */
export function Dove({
  className = "",
  style,
  flip = false,
}: {
  className?: string;
  style?: CSSProperties;
  flip?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={{ ...style, transform: flip ? "scaleX(-1)" : undefined }}
      aria-hidden="true"
    >
      <path d={DOVE_PATH} fill="rgba(255,251,240,0.97)" />
    </svg>
  );
}

/** Stylized feather (Lucide feather shape, filled) for the page backdrop. */
export function FeatherShape({
  left,
  top,
  size,
  rotate = 0,
  flip = false,
  opacity = 0.1,
  color = "#d99a4e",
  blur = 0,
}: {
  left: number;
  top: number;
  size: number;
  rotate?: number;
  flip?: boolean;
  opacity?: number;
  color?: string;
  blur?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="absolute"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        transform: `rotate(${rotate}deg)${flip ? " scaleX(-1)" : ""}`,
        opacity,
        filter: blur ? `blur(${blur}px)` : undefined,
      }}
      aria-hidden="true"
    >
      <path
        d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"
        fill={color}
        stroke={color}
        strokeWidth="0.6"
      />
      <path d="M16 8 2 22" stroke={color} strokeWidth="1" strokeLinecap="round" fill="none" />
      <path d="M17.5 15H9" stroke={color} strokeWidth="0.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Full-screen feather field — the app-wide page backdrop (fixed, decorative). */
export function FeatherBackdrop() {
  const feathers = [
    { left: -6,  top: 2,  size: 150, rotate: -35, opacity: 0.16, blur: 1.5 },
    { left: 78,  top: -4, size: 180, rotate: 40,  opacity: 0.14, blur: 2,   flip: true },
    { left: 40,  top: 9,  size: 110, rotate: 120, opacity: 0.1,  blur: 2.5 },
    { left: -10, top: 26, size: 130, rotate: 70,  opacity: 0.13, blur: 1 },
    { left: 82,  top: 30, size: 120, rotate: -60, opacity: 0.12, blur: 1.5, flip: true },
    { left: 30,  top: 38, size: 90,  rotate: 160, opacity: 0.09, blur: 2 },
    { left: -8,  top: 52, size: 140, rotate: -100, opacity: 0.1, blur: 2 },
    { left: 76,  top: 55, size: 150, rotate: 100, opacity: 0.11, blur: 1.5, flip: true },
    { left: 38,  top: 63, size: 100, rotate: 20,  opacity: 0.09, blur: 2.5 },
    { left: -6,  top: 74, size: 120, rotate: 55,  opacity: 0.1,  blur: 1 },
    { left: 80,  top: 78, size: 130, rotate: -70, opacity: 0.1,  blur: 1.5, flip: true },
    { left: 42,  top: 86, size: 95,  rotate: 140, opacity: 0.08, blur: 2 },
  ];
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      {feathers.map((f, i) => (
        <FeatherShape key={i} {...f} flip={f.flip ?? false} />
      ))}
    </div>
  );}

/** Pampas-grass frond used in the corners of the sky action cards. */
export function Frond({
  className = "",
  style,
  flip = false,
}: {
  className?: string;
  style?: CSSProperties;
  flip?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 44 120"
      fill="none"
      className={className}
      style={{ ...style, transform: flip ? "scaleX(-1)" : undefined }}
      stroke="#e9bd74"
      aria-hidden="true"
    >
      <path d="M22 118C22 82 24 42 32 8" strokeWidth="2.6" strokeLinecap="round" strokeOpacity="0.85" />
      <path d="M22 102C15 96 11 88 9 78" strokeWidth="1.7" strokeOpacity="0.7" />
      <path d="M23 86C30 80 34 72 35 62" strokeWidth="1.7" strokeOpacity="0.7" />
      <path d="M24 68C19 62 16 54 15 46" strokeWidth="1.5" strokeOpacity="0.6" />
      <path d="M26 50C31 44 33 38 33 30" strokeWidth="1.3" strokeOpacity="0.55" />
      <path d="M28 32C26 26 26 20 27 13" strokeWidth="1.1" strokeOpacity="0.5" />
    </svg>
  );
}
