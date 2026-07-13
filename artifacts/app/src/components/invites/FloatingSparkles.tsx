import { motion } from "framer-motion";

interface Particle {
  emoji: string;
  left: string;
  top: string;
  size: number;
  delay: number;
  duration: number;
}

const DEFAULT_PARTICLES: Particle[] = [
  { emoji: "✨", left: "12%", top: "18%", size: 16, delay: 0, duration: 3.2 },
  { emoji: "💫", left: "82%", top: "14%", size: 14, delay: 0.5, duration: 3.6 },
  { emoji: "⭐", left: "20%", top: "72%", size: 12, delay: 1.1, duration: 2.8 },
  { emoji: "✨", left: "88%", top: "66%", size: 15, delay: 0.3, duration: 3.4 },
  { emoji: "💫", left: "6%", top: "48%", size: 12, delay: 1.6, duration: 3.0 },
  { emoji: "⭐", left: "92%", top: "40%", size: 13, delay: 0.9, duration: 3.8 },
];

/**
 * Decorative twinkling particles for premium/celebratory moments (loading +
 * success screens only). Purely visual, `aria-hidden`, and never renders
 * over or replaces any disclosure text.
 */
export function FloatingSparkles({ particles = DEFAULT_PARTICLES }: { particles?: Particle[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {particles.map((p, i) => (
        <motion.span
          key={i}
          className="absolute select-none"
          style={{ left: p.left, top: p.top, fontSize: p.size }}
          initial={{ opacity: 0, scale: 0.4, rotate: -15 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1, 1, 0.4], rotate: [-15, 10, -10, 15] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}
        >
          {p.emoji}
        </motion.span>
      ))}
    </div>
  );
}
