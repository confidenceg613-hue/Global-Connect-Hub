import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FloatingSparkles } from "./FloatingSparkles";

const WAIT_SECONDS = 120;

const FACTS = [
  { emoji: "😴", text: "Cats sleep 12–16 hours a day — about 70% of their entire lives!" },
  { emoji: "🦴", text: "A cat's purr (25–150 Hz) is the same frequency that promotes bone healing." },
  { emoji: "🎯", text: "Cats can leap up to 6× their own body length in a single bound." },
  { emoji: "👂", text: "Cats have 32 ear muscles and can rotate each ear a full 180°." },
  { emoji: "👃", text: "A cat's nose print is as unique as a human fingerprint — no two alike." },
  { emoji: "🗣️", text: "Cats can make over 100 vocal sounds. Dogs manage about 10." },
  { emoji: "🐱", text: "A group of cats is called a 'clowder'. Kittens together form a 'kindle'." },
  { emoji: "🍯", text: "Honey never spoils — 3,000-year-old honey found in Egyptian tombs was still good." },
  { emoji: "🌍", text: "A single day on Venus is longer than an entire year on Venus." },
  { emoji: "🔺", text: "Cleopatra lived closer in time to the Moon landing than to the Great Pyramids." },
  { emoji: "🍓", text: "Bananas are technically berries — but strawberries aren't." },
  { emoji: "🗼", text: "The Eiffel Tower grows 15 cm taller every summer due to thermal expansion." },
  { emoji: "🐙", text: "Octopuses have three hearts, blue blood, and nine brains." },
  { emoji: "♟️", text: "There are more possible chess games than atoms in the observable universe." },
  { emoji: "⚡", text: "Lightning strikes Earth about 100 times every single second." },
  { emoji: "🧠", text: "Your brain uses 20% of your body's energy despite being only 2% of your weight." },
  { emoji: "🦩", text: "A group of flamingos is called a 'flamboyance'. Very apt." },
  { emoji: "🌊", text: "The Pacific Ocean is larger than all of Earth's landmasses combined." },
  { emoji: "🐝", text: "A single honey bee produces only 1/12th of a teaspoon of honey in its lifetime." },
  { emoji: "🎶", text: "Music has been shown to make plants grow faster — classical works best." },
];

const MOODS = ["🐱", "😺", "😸", "😻", "😼", "😽", "🙀", "🐈"];
const PET_REACTIONS = ["💕", "😻", "✨", "🐾", "💫", "🌸", "⭐", "🎀", "💖", "🌟"];
const ACHIEVEMENTS: Record<number, string> = {
  5: "Kitty whisperer! 🏅",
  10: "Purr master! 🎖️",
  20: "Legendary petter! 👑",
};

/**
 * Cute animated kitty modal shown right after an invite's location consent is
 * granted, while GeoBoard verification (photos/video capture) finishes on the
 * recipient's side. Auto-dismisses after 40 s, or the user can close it early.
 */
export function ConnectingKitty({ name, onClose }: { name: string; onClose: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(WAIT_SECONDS);
  const [factIndex, setFactIndex] = useState(() => Math.floor(Math.random() * FACTS.length));
  const [moodIndex, setMoodIndex] = useState(0);
  const [petCount, setPetCount] = useState(0);
  const [petBursts, setPetBursts] = useState<{ id: number; emoji: string; angle: number }[]>([]);
  const [achievement, setAchievement] = useState<string | null>(null);

  // Countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (secondsLeft !== 0) return;
    const t = setTimeout(onClose, 600);
    return () => clearTimeout(t);
  }, [secondsLeft, onClose]);

  // Cycle facts every 5 s
  useEffect(() => {
    const id = setInterval(() => setFactIndex((i) => (i + 1) % FACTS.length), 5000);
    return () => clearInterval(id);
  }, []);

  // Cycle cat mood every 8 s
  useEffect(() => {
    const id = setInterval(() => setMoodIndex((i) => (i + 1) % MOODS.length), 8000);
    return () => clearInterval(id);
  }, []);

  const handlePet = useCallback(() => {
    const next = petCount + 1;
    setPetCount(next);
    const id = Date.now() + Math.random();
    const emoji = PET_REACTIONS[Math.floor(Math.random() * PET_REACTIONS.length)];
    const angle = Math.random() * 360;
    setPetBursts((b) => [...b, { id, emoji, angle }]);
    setTimeout(() => setPetBursts((b) => b.filter((x) => x.id !== id)), 1000);
    if (ACHIEVEMENTS[next]) {
      setAchievement(ACHIEVEMENTS[next]);
      setTimeout(() => setAchievement(null), 2200);
    }
  }, [petCount]);

  const progress = ((WAIT_SECONDS - secondsLeft) / WAIT_SECONDS) * 100;
  const fact = FACTS[factIndex];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      data-testid="modal-connecting-kitty"
    >
      <motion.div
        className="relative max-w-xs w-full rounded-3xl shadow-2xl overflow-hidden"
        style={{
          background: "linear-gradient(160deg, #fff0f8 0%, #f5e8ff 55%, #ede9fe 100%)",
          border: "1px solid rgba(236,72,153,0.2)",
        }}
        initial={{ opacity: 0, scale: 0.88, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.38, type: "spring", bounce: 0.4 }}
      >
        <FloatingSparkles />

        <div className="relative z-10 p-6 text-center">
          {/* Header — pulses gently */}
          <motion.p
            className="text-sm font-black text-violet-700 mb-3 tracking-tight"
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          >
            🎉 {name} just connected!
          </motion.p>

          {/* Cat with concentric pulse rings */}
          <div className="relative flex items-center justify-center my-4" style={{ height: 120 }}>
            {[{ w: 78,  del: 0   },
              { w: 104, del: 0.5 },
              { w: 130, del: 1.0 }].map(({ w, del }, i) => (
              <motion.div
                key={i}
                className="absolute rounded-full"
                style={{
                  width: w, height: w,
                  border: i === 0
                    ? "2px solid rgba(236,72,153,0.45)"
                    : i === 1
                    ? "1.5px solid rgba(168,85,247,0.3)"
                    : "1px solid rgba(168,85,247,0.15)",
                }}
                animate={{ scale: [1, 1.1, 1], opacity: [0.7, 0.15, 0.7] }}
                transition={{ duration: 2.2, repeat: Infinity, delay: del, ease: "easeInOut" }}
              />
            ))}

            {/* Achievement pop */}
            <AnimatePresence>
              {achievement && (
                <motion.div
                  className="absolute -top-2 left-1/2 z-30 px-4 py-1.5 rounded-full text-xs font-black text-white shadow-lg"
                  style={{
                    background: "linear-gradient(90deg,#e91e63,#9c27b0)",
                    transform: "translateX(-50%)",
                    whiteSpace: "nowrap",
                  }}
                  initial={{ scale: 0.4, opacity: 0, y: 6 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.4, opacity: 0, y: -6 }}
                  transition={{ type: "spring", bounce: 0.6 }}
                >
                  {achievement}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Mood-cycling cat */}
            <AnimatePresence mode="wait">
              <motion.button
                key={moodIndex}
                type="button"
                onClick={handlePet}
                aria-label="pet the cat"
                className="relative text-6xl select-none cursor-pointer bg-transparent border-none p-0 z-10"
                initial={{ scale: 0.3, rotateY: -90, opacity: 0 }}
                animate={{ scale: 1, rotateY: 0, opacity: 1, y: [0, -8, 0] }}
                exit={{ scale: 0.3, rotateY: 90, opacity: 0 }}
                transition={{
                  scale: { duration: 0.3 },
                  rotateY: { duration: 0.3 },
                  opacity: { duration: 0.25 },
                  y: { duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: 0.35 },
                }}
                whileTap={{ scale: 1.45 }}
              >
                {MOODS[moodIndex]}
              </motion.button>
            </AnimatePresence>

            {/* Pet burst emojis fly outward in random directions */}
            <AnimatePresence>
              {petBursts.map((burst) => {
                const rad = (burst.angle * Math.PI) / 180;
                return (
                  <motion.span
                    key={burst.id}
                    className="absolute text-xl select-none pointer-events-none z-20"
                    style={{ left: "50%", top: "50%", translateX: "-50%", translateY: "-50%" }}
                    initial={{ x: 0, y: 0, scale: 0.5, opacity: 1 }}
                    animate={{ x: Math.cos(rad) * 65, y: Math.sin(rad) * 65, scale: 1.4, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.85, ease: "easeOut" }}
                  >
                    {burst.emoji}
                  </motion.span>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Pet count badge */}
          <AnimatePresence>
            {petCount > 0 && (
              <motion.p
                className="text-[11px] font-semibold text-pink-500 mb-1"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {petCount} {petCount === 1 ? "pet" : "pets"} given 🐾
              </motion.p>
            )}
          </AnimatePresence>

          <p className="text-foreground font-bold text-base mb-0.5">
            {secondsLeft > 0 ? `Setting up… ${secondsLeft}s` : "Almost ready! ✨"}
          </p>
          <p className="text-muted-foreground text-xs mb-3">
            {petCount === 0 ? "Tap the kitty while you wait 🐾" : "Verifying & syncing live location"}
          </p>

          {/* Progress bar with animated shimmer */}
          <div className="relative h-2.5 w-full rounded-full overflow-hidden mb-4"
            style={{ background: "rgba(236,72,153,0.12)" }}>
            <motion.div
              className="h-full rounded-full relative overflow-hidden"
              style={{ background: "linear-gradient(90deg,#f472b6,#a855f7,#f472b6)", backgroundSize: "200% 100%" }}
              animate={{ width: `${progress}%`, backgroundPosition: ["0% 50%", "200% 50%", "0% 50%"] }}
              transition={{
                width: { duration: 1, ease: "linear" },
                backgroundPosition: { duration: 2, repeat: Infinity, ease: "linear" },
              }}
            />
          </div>

          {/* Fact card — slides in/out every 5 s */}
          <div className="relative overflow-hidden rounded-2xl mb-4" style={{ minHeight: 72 }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={factIndex}
                className="rounded-2xl p-3.5 text-left"
                style={{
                  background: "rgba(236,72,153,0.07)",
                  border: "1px solid rgba(236,72,153,0.18)",
                }}
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -16, scale: 0.96 }}
                transition={{ duration: 0.38, ease: "easeOut" }}
              >
                <p className="text-[9px] font-black tracking-widest uppercase text-pink-500 mb-1.5">
                  ✦ Did you know? ✦
                </p>
                <p className="text-xs text-violet-800 font-semibold leading-snug">
                  {fact.emoji} {fact.text}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            data-testid="button-dismiss-kitty"
          >
            {secondsLeft === 0 ? "Done — close" : "Skip"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
