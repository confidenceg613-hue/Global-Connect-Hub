/**
 * bird-sprites.tsx
 * Seven hand-crafted SVG birds — each with individually animated parts.
 * Wing/leg animations are driven by CSS classes defined in index.css.
 * All birds face RIGHT (direction of travel).
 */

/** Bat 🦇 — front-facing, dramatic folding wings */
export function BatSVG({ size = 56 }: { size?: number }) {
  const h = size * 0.52;
  return (
    <svg width={size} height={h} viewBox="0 0 80 42" fill="none" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      {/* Left wing */}
      <g className="sky-bat-wing-l">
        <path d="M38,22 C26,14 10,8 1,13 C5,21 15,25 38,25" fill="#5c2080"/>
        <path d="M38,22 L3,14" stroke="#7b3aaa" strokeWidth="0.8" opacity="0.7"/>
        <path d="M38,22 L2,19" stroke="#7b3aaa" strokeWidth="0.8" opacity="0.6"/>
        <path d="M38,22 L8,27" stroke="#7b3aaa" strokeWidth="0.8" opacity="0.5"/>
        <path d="M38,22 C20,26 8,30 2,26" fill="#4a1868" opacity="0.5"/>
      </g>
      {/* Right wing */}
      <g className="sky-bat-wing-r">
        <path d="M42,22 C54,14 70,8 79,13 C75,21 65,25 42,25" fill="#5c2080"/>
        <path d="M42,22 L77,14" stroke="#7b3aaa" strokeWidth="0.8" opacity="0.7"/>
        <path d="M42,22 L78,19" stroke="#7b3aaa" strokeWidth="0.8" opacity="0.6"/>
        <path d="M42,22 L72,27" stroke="#7b3aaa" strokeWidth="0.8" opacity="0.5"/>
        <path d="M42,22 C60,26 72,30 78,26" fill="#4a1868" opacity="0.5"/>
      </g>
      {/* Body */}
      <ellipse cx="40" cy="25" rx="7" ry="5" fill="#2a0f45"/>
      {/* Head */}
      <circle cx="40" cy="17" r="7" fill="#2a0f45"/>
      {/* Ears */}
      <polygon points="34,13 31,4 38,12" fill="#2a0f45"/>
      <polygon points="46,13 49,4 42,12" fill="#2a0f45"/>
      <polygon points="34.5,12 32,6 37.5,11" fill="#7b3aaa" opacity="0.5"/>
      <polygon points="45.5,12 48,6 42.5,11" fill="#7b3aaa" opacity="0.5"/>
      {/* Eyes */}
      <circle cx="37" cy="17" r="2.8" fill="#ff1a55"/>
      <circle cx="43" cy="17" r="2.8" fill="#ff1a55"/>
      <circle cx="36.5" cy="16.5" r="1" fill="#ff99cc" opacity="0.9"/>
      <circle cx="42.5" cy="16.5" r="1" fill="#ff99cc" opacity="0.9"/>
      {/* Nose */}
      <path d="M38,21 Q40,23 42,21" stroke="#4a1868" strokeWidth="1" fill="none"/>
      {/* Fangs */}
      <polygon points="37,24 36,28 38.5,24" fill="rgba(255,255,255,0.75)"/>
      <polygon points="43,24 41.5,24 44,28" fill="rgba(255,255,255,0.75)"/>
    </svg>
  );
}

/** Black Bird 🐦‍⬛ — sleek side-profile, fast wing flap */
export function BlackBirdSVG({ size = 44 }: { size?: number }) {
  const h = size * 0.6;
  return (
    <svg width={size} height={h} viewBox="0 0 70 42" fill="none" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      {/* Tail */}
      <path d="M14,24 L2,18 L4,28 Z" fill="#1a1a1a"/>
      {/* Body */}
      <ellipse cx="34" cy="26" rx="16" ry="9" fill="#1a1a1a"/>
      {/* Upper wing — flaps */}
      <g className="sky-wing-profile">
        <path d="M28,20 Q38,8 54,12 Q50,20 36,22 Z" fill="#2d2d2d"/>
        <path d="M28,20 Q40,14 52,14" stroke="#3d3d3d" strokeWidth="0.8" opacity="0.6"/>
      </g>
      {/* Head */}
      <circle cx="52" cy="20" r="9" fill="#1a1a1a"/>
      {/* Beak */}
      <path d="M61,19 L68,21 L61,23 Z" fill="#f5c842"/>
      {/* Eye */}
      <circle cx="55" cy="18" r="3" fill="#f5e040"/>
      <circle cx="55" cy="18" r="1.8" fill="#111"/>
      <circle cx="54.5" cy="17.5" r="0.6" fill="white"/>
      {/* Feet */}
      <g className="sky-leg-l">
        <line x1="32" y1="34" x2="28" y2="40" stroke="#444" strokeWidth="1.5"/>
        <line x1="28" y1="40" x2="24" y2="42" stroke="#444" strokeWidth="1.2"/>
        <line x1="28" y1="40" x2="28" y2="43" stroke="#444" strokeWidth="1.2"/>
        <line x1="28" y1="40" x2="32" y2="42" stroke="#444" strokeWidth="1.2"/>
      </g>
      <g className="sky-leg-r">
        <line x1="38" y1="34" x2="42" y2="40" stroke="#444" strokeWidth="1.5"/>
        <line x1="42" y1="40" x2="38" y2="42" stroke="#444" strokeWidth="1.2"/>
        <line x1="42" y1="40" x2="42" y2="43" stroke="#444" strokeWidth="1.2"/>
        <line x1="42" y1="40" x2="46" y2="42" stroke="#444" strokeWidth="1.2"/>
      </g>
    </svg>
  );
}

/** Eagle 🦅 — majestic, slow powerful wing beats */
export function EagleSVG({ size = 64 }: { size?: number }) {
  const h = size * 0.55;
  return (
    <svg width={size} height={h} viewBox="0 0 100 55" fill="none" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      {/* Tail */}
      <path d="M12,32 L2,25 L2,35 L6,38 L12,36 Z" fill="#f5f5e8"/>
      {/* Body */}
      <ellipse cx="46" cy="32" rx="22" ry="12" fill="#8B5E3C"/>
      {/* Upper wing — left side */}
      <g className="sky-wing-eagle">
        <path d="M36,24 Q20,6 4,10 Q8,22 24,28 Q32,30 36,28 Z" fill="#6B4520"/>
        <path d="M36,24 Q46,12 62,14 Q60,24 46,28 Z" fill="#7B5230"/>
        {/* Primary feathers */}
        <path d="M36,24 L6,12" stroke="#5a3810" strokeWidth="0.8" opacity="0.5"/>
        <path d="M36,24 L4,18" stroke="#5a3810" strokeWidth="0.8" opacity="0.5"/>
        <path d="M36,24 L8,24" stroke="#5a3810" strokeWidth="0.8" opacity="0.4"/>
      </g>
      {/* White head */}
      <circle cx="72" cy="24" r="12" fill="#f5f5e8"/>
      {/* Hooked beak */}
      <path d="M84,22 L94,25 L90,28 L84,26 Z" fill="#f5c030"/>
      <path d="M90,25 Q94,26 94,28" stroke="#d4a020" strokeWidth="1"/>
      {/* Eye */}
      <circle cx="76" cy="22" r="3.5" fill="#f5c030"/>
      <circle cx="76" cy="22" r="2" fill="#1a1a1a"/>
      <circle cx="75.5" cy="21.5" r="0.7" fill="white"/>
      {/* Brow ridge */}
      <path d="M72,19 Q77,17 80,20" stroke="#c0b080" strokeWidth="1.5" fill="none"/>
      {/* Talons */}
      <g className="sky-leg-l">
        <line x1="40" y1="43" x2="36" y2="51" stroke="#c08020" strokeWidth="2"/>
        <line x1="36" y1="51" x2="30" y2="54" stroke="#c08020" strokeWidth="1.5"/>
        <line x1="36" y1="51" x2="36" y2="55" stroke="#c08020" strokeWidth="1.5"/>
        <line x1="36" y1="51" x2="42" y2="54" stroke="#c08020" strokeWidth="1.5"/>
      </g>
      <g className="sky-leg-r">
        <line x1="52" y1="43" x2="56" y2="51" stroke="#c08020" strokeWidth="2"/>
        <line x1="56" y1="51" x2="50" y2="54" stroke="#c08020" strokeWidth="1.5"/>
        <line x1="56" y1="51" x2="56" y2="55" stroke="#c08020" strokeWidth="1.5"/>
        <line x1="56" y1="51" x2="62" y2="54" stroke="#c08020" strokeWidth="1.5"/>
      </g>
    </svg>
  );
}

/** Owl 🦉 — round, wise, glowing amber eyes */
export function OwlSVG({ size = 48 }: { size?: number }) {
  const h = size * 1.1;
  return (
    <svg width={size} height={h} viewBox="0 0 60 66" fill="none" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      {/* Left wing */}
      <g className="sky-wing-l">
        <path d="M12,44 Q4,36 4,48 Q6,58 12,58 Z" fill="#7a5610"/>
        <path d="M12,50 Q6,52 5,56" stroke="#6a4808" strokeWidth="1" opacity="0.7"/>
        <path d="M12,46 Q5,46 4,50" stroke="#6a4808" strokeWidth="1" opacity="0.6"/>
      </g>
      {/* Right wing */}
      <g className="sky-wing-r">
        <path d="M48,44 Q56,36 56,48 Q54,58 48,58 Z" fill="#7a5610"/>
        <path d="M48,50 Q54,52 55,56" stroke="#6a4808" strokeWidth="1" opacity="0.7"/>
        <path d="M48,46 Q55,46 56,50" stroke="#6a4808" strokeWidth="1" opacity="0.6"/>
      </g>
      {/* Body */}
      <ellipse cx="30" cy="46" rx="18" ry="16" fill="#9B7214"/>
      {/* Belly streaks */}
      <ellipse cx="30" cy="50" rx="11" ry="11" fill="#c4922a" opacity="0.4"/>
      <path d="M26,42 Q30,58 34,42" fill="#c4922a" opacity="0.2"/>
      {/* Head */}
      <circle cx="30" cy="26" r="17" fill="#9B7214"/>
      {/* Facial disc */}
      <ellipse cx="30" cy="27" rx="13" ry="13" fill="#c4922a" opacity="0.35"/>
      {/* Ear tufts */}
      <polygon points="22,11 20,2 26,10" fill="#7a5610"/>
      <polygon points="38,11 40,2 34,10" fill="#7a5610"/>
      <polygon points="22.5,10 21,4 26,9" fill="#c4922a" opacity="0.4"/>
      <polygon points="37.5,10 39,4 34,9" fill="#c4922a" opacity="0.4"/>
      {/* Left eye */}
      <circle cx="24" cy="26" r="7.5" fill="#f5c030"/>
      <circle cx="24" cy="26" r="5.5" fill="#1a1010"/>
      <circle cx="22.5" cy="24.5" r="1.8" fill="white"/>
      <circle cx="25.5" cy="27.5" r="0.8" fill="rgba(255,255,255,0.4)"/>
      {/* Right eye */}
      <circle cx="36" cy="26" r="7.5" fill="#f5c030"/>
      <circle cx="36" cy="26" r="5.5" fill="#1a1010"/>
      <circle cx="34.5" cy="24.5" r="1.8" fill="white"/>
      <circle cx="37.5" cy="27.5" r="0.8" fill="rgba(255,255,255,0.4)"/>
      {/* Beak */}
      <path d="M30,31 L27,36 L33,36 Z" fill="#e8a020"/>
      <path d="M27,34 Q30,32 33,34" stroke="#c08010" strokeWidth="0.8" fill="none"/>
      {/* Feet */}
      <g className="sky-leg-l">
        <line x1="24" y1="60" x2="20" y2="65" stroke="#9B7214" strokeWidth="2"/>
        <line x1="20" y1="65" x2="15" y2="66" stroke="#9B7214" strokeWidth="1.5"/>
        <line x1="20" y1="65" x2="20" y2="67" stroke="#9B7214" strokeWidth="1.5"/>
        <line x1="20" y1="65" x2="25" y2="66" stroke="#9B7214" strokeWidth="1.5"/>
      </g>
      <g className="sky-leg-r">
        <line x1="36" y1="60" x2="40" y2="65" stroke="#9B7214" strokeWidth="2"/>
        <line x1="40" y1="65" x2="35" y2="66" stroke="#9B7214" strokeWidth="1.5"/>
        <line x1="40" y1="65" x2="40" y2="67" stroke="#9B7214" strokeWidth="1.5"/>
        <line x1="40" y1="65" x2="45" y2="66" stroke="#9B7214" strokeWidth="1.5"/>
      </g>
    </svg>
  );
}

/** Penguin 🐧 — waddles with visible walking legs */
export function PenguinSVG({ size = 38 }: { size?: number }) {
  const h = size * 1.6;
  return (
    <svg width={size} height={h} viewBox="0 0 48 76" fill="none" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      {/* Body */}
      <ellipse cx="24" cy="44" rx="17" ry="20" fill="#1a1a2e"/>
      {/* White belly */}
      <ellipse cx="24" cy="48" rx="11" ry="15" fill="#f0f0f0"/>
      {/* Left flipper */}
      <g className="sky-flipper-l">
        <path d="M8,38 Q2,44 4,52 Q8,56 12,50 Q12,44 8,38 Z" fill="#1a1a2e"/>
        <path d="M9,40 Q5,46 6,51" stroke="#2d2d4e" strokeWidth="1" opacity="0.6"/>
      </g>
      {/* Right flipper */}
      <g className="sky-flipper-r">
        <path d="M40,38 Q46,44 44,52 Q40,56 36,50 Q36,44 40,38 Z" fill="#1a1a2e"/>
        <path d="M39,40 Q43,46 42,51" stroke="#2d2d4e" strokeWidth="1" opacity="0.6"/>
      </g>
      {/* Head */}
      <circle cx="24" cy="20" r="16" fill="#1a1a2e"/>
      {/* White face patch */}
      <ellipse cx="24" cy="21" rx="10" ry="11" fill="#f0f0f0"/>
      {/* Eyes */}
      <circle cx="20" cy="17" r="3.5" fill="#f5c842"/>
      <circle cx="20" cy="17" r="2.2" fill="#1a1a2e"/>
      <circle cx="19.2" cy="16.2" r="0.8" fill="white"/>
      <circle cx="28" cy="17" r="3.5" fill="#f5c842"/>
      <circle cx="28" cy="17" r="2.2" fill="#1a1a2e"/>
      <circle cx="27.2" cy="16.2" r="0.8" fill="white"/>
      {/* Beak */}
      <path d="M24,25 L20,30 L28,30 Z" fill="#f5a020"/>
      <path d="M20,27 L28,27" stroke="#d08010" strokeWidth="0.8"/>
      {/* Left leg */}
      <g className="sky-leg-l">
        <rect x="17" y="62" width="6" height="10" rx="3" fill="#f5a020"/>
        <rect x="12" y="70" width="12" height="3" rx="1.5" fill="#f5a020"/>
        <path d="M12,71 L10,74" stroke="#f5a020" strokeWidth="1.5"/>
        <path d="M24,71 L26,74" stroke="#f5a020" strokeWidth="1.5"/>
      </g>
      {/* Right leg */}
      <g className="sky-leg-r">
        <rect x="25" y="62" width="6" height="10" rx="3" fill="#f5a020"/>
        <rect x="20" y="70" width="12" height="3" rx="1.5" fill="#f5a020"/>
        <path d="M20,71 L18,74" stroke="#f5a020" strokeWidth="1.5"/>
        <path d="M32,71 L34,74" stroke="#f5a020" strokeWidth="1.5"/>
      </g>
    </svg>
  );
}

/** Turkey 🦃 — strutting with fan tail and walking legs */
export function TurkeySVG({ size = 52 }: { size?: number }) {
  const h = size * 1.1;
  return (
    <svg width={size} height={h} viewBox="0 0 80 88" fill="none" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      {/* Fan tail */}
      <g>
        <path d="M16,40 Q10,24 12,10" stroke="#c0392b" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
        <path d="M16,40 Q8,28 14,16" stroke="#e74c3c" strokeWidth="3" fill="none" strokeLinecap="round"/>
        <path d="M16,40 Q4,34 6,20" stroke="#e67e22" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
        <path d="M16,40 Q6,40 4,28" stroke="#f39c12" strokeWidth="3" fill="none" strokeLinecap="round"/>
        <path d="M16,40 Q6,46 8,34" stroke="#27ae60" strokeWidth="3" fill="none" strokeLinecap="round"/>
        <path d="M16,40 Q8,52 12,42" stroke="#2980b9" strokeWidth="3" fill="none" strokeLinecap="round"/>
        {/* Tip dots */}
        <circle cx="12" cy="10" r="3" fill="#c0392b"/>
        <circle cx="14" cy="16" r="2.5" fill="#e74c3c"/>
        <circle cx="5" cy="20" r="3" fill="#e67e22"/>
        <circle cx="4" cy="28" r="2.5" fill="#f39c12"/>
        <circle cx="8" cy="34" r="2.5" fill="#27ae60"/>
        <circle cx="12" cy="42" r="2.5" fill="#2980b9"/>
      </g>
      {/* Body */}
      <ellipse cx="44" cy="50" rx="20" ry="17" fill="#8B4513"/>
      {/* Wing */}
      <g className="sky-wing-profile">
        <path d="M36,42 Q28,32 20,36 Q22,46 36,50 Z" fill="#6B3410"/>
        <path d="M36,42 Q50,36 60,40 Q58,50 44,50 Z" fill="#7B4020"/>
        <path d="M36,42 L22,37" stroke="#5a2c0a" strokeWidth="0.8" opacity="0.5"/>
        <path d="M36,42 L22,42" stroke="#5a2c0a" strokeWidth="0.8" opacity="0.4"/>
      </g>
      {/* Neck */}
      <path d="M54,38 Q60,30 64,26" stroke="#c0392b" strokeWidth="8" strokeLinecap="round" fill="none"/>
      {/* Head */}
      <circle cx="66" cy="22" r="10" fill="#c0392b"/>
      {/* Snood (dangly bit) */}
      <path d="M62,28 Q59,34 62,38 Q64,38 64,34 Q64,29 62,28" fill="#e74c3c"/>
      {/* Wattle */}
      <path d="M64,26 Q60,30 62,34" stroke="#e74c3c" strokeWidth="3" fill="none" strokeLinecap="round"/>
      {/* Beak */}
      <path d="M76,20 L84,22 L76,25 Z" fill="#f5c030"/>
      {/* Eye */}
      <circle cx="70" cy="19" r="3" fill="#f5c030"/>
      <circle cx="70" cy="19" r="1.8" fill="#1a1a1a"/>
      <circle cx="69.5" cy="18.5" r="0.6" fill="white"/>
      {/* Left leg */}
      <g className="sky-leg-l">
        <line x1="38" y1="65" x2="34" y2="75" stroke="#c08020" strokeWidth="3"/>
        <line x1="34" y1="75" x2="26" y2="79" stroke="#c08020" strokeWidth="2"/>
        <line x1="34" y1="75" x2="34" y2="80" stroke="#c08020" strokeWidth="2"/>
        <line x1="34" y1="75" x2="40" y2="79" stroke="#c08020" strokeWidth="2"/>
      </g>
      {/* Right leg */}
      <g className="sky-leg-r">
        <line x1="50" y1="65" x2="54" y2="75" stroke="#c08020" strokeWidth="3"/>
        <line x1="54" y1="75" x2="46" y2="79" stroke="#c08020" strokeWidth="2"/>
        <line x1="54" y1="75" x2="54" y2="80" stroke="#c08020" strokeWidth="2"/>
        <line x1="54" y1="75" x2="60" y2="79" stroke="#c08020" strokeWidth="2"/>
      </g>
    </svg>
  );
}

/** Butterfly 🦋 — symmetric wings that open and close */
export function ButterflySVG({ size = 56 }: { size?: number }) {
  const h = size * 0.75;
  return (
    <svg width={size} height={h} viewBox="0 0 100 75" fill="none" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      {/* Upper left wing */}
      <g className="sky-butterfly-ul">
        <path d="M48,34 C36,18 18,12 6,18 C2,30 12,42 28,40 C38,40 46,38 48,36 Z" fill="#e8820a"/>
        <path d="M48,34 C36,18 18,12 6,18" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.4"/>
        <circle cx="20" cy="24" r="5" fill="#1a1a1a" opacity="0.45"/>
        <circle cx="12" cy="32" r="3.5" fill="#1a1a1a" opacity="0.35"/>
        <path d="M30,36 Q22,28 16,30" stroke="#f5c030" strokeWidth="1.5" opacity="0.6" fill="none"/>
        <ellipse cx="32" cy="30" rx="4" ry="6" fill="#f5c030" opacity="0.3" transform="rotate(-20,32,30)"/>
      </g>
      {/* Upper right wing */}
      <g className="sky-butterfly-ur">
        <path d="M52,34 C64,18 82,12 94,18 C98,30 88,42 72,40 C62,40 54,38 52,36 Z" fill="#e8820a"/>
        <path d="M52,34 C64,18 82,12 94,18" fill="none" stroke="#1a1a1a" strokeWidth="1" opacity="0.4"/>
        <circle cx="80" cy="24" r="5" fill="#1a1a1a" opacity="0.45"/>
        <circle cx="88" cy="32" r="3.5" fill="#1a1a1a" opacity="0.35"/>
        <path d="M70,36 Q78,28 84,30" stroke="#f5c030" strokeWidth="1.5" opacity="0.6" fill="none"/>
        <ellipse cx="68" cy="30" rx="4" ry="6" fill="#f5c030" opacity="0.3" transform="rotate(20,68,30)"/>
      </g>
      {/* Lower left wing */}
      <g className="sky-butterfly-ll">
        <path d="M48,38 C36,42 24,52 22,62 C28,70 40,66 46,56 C48,50 48,42 48,40 Z" fill="#f5a020"/>
        <circle cx="32" cy="56" r="3.5" fill="#1a1a1a" opacity="0.4"/>
        <path d="M42,50 Q34,52 30,58" stroke="#f5c842" strokeWidth="1.2" opacity="0.5" fill="none"/>
      </g>
      {/* Lower right wing */}
      <g className="sky-butterfly-lr">
        <path d="M52,38 C64,42 76,52 78,62 C72,70 60,66 54,56 C52,50 52,42 52,40 Z" fill="#f5a020"/>
        <circle cx="68" cy="56" r="3.5" fill="#1a1a1a" opacity="0.4"/>
        <path d="M58,50 Q66,52 70,58" stroke="#f5c842" strokeWidth="1.2" opacity="0.5" fill="none"/>
      </g>
      {/* Body */}
      <ellipse cx="50" cy="38" rx="4" ry="20" fill="#2d1a08"/>
      {/* Head */}
      <circle cx="50" cy="18" r="5" fill="#2d1a08"/>
      {/* Antennae */}
      <path d="M48,14 Q42,6 38,4" stroke="#2d1a08" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <circle cx="38" cy="4" r="2.5" fill="#2d1a08"/>
      <path d="M52,14 Q58,6 62,4" stroke="#2d1a08" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <circle cx="62" cy="4" r="2.5" fill="#2d1a08"/>
    </svg>
  );
}
