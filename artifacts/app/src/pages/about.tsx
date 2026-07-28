import { Feather, Copyright, Atom, MapPinned, ShieldCheck, Sparkles } from "lucide-react";

const DEV_PHOTO = "/godwin-confidence.jpg";

export default function AboutPage() {
  return (
    <div className="relative space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-500">
      <section className="relative overflow-hidden rounded-3xl border border-amber-500/20 bg-gradient-to-br from-[#25150b] via-[#160f0a] to-[#090807] px-6 py-8 sm:px-10 sm:py-12 shadow-2xl shadow-black/30">
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(circle at 78% 18%, rgba(245, 181, 57, .26), transparent 28%), repeating-linear-gradient(120deg, transparent 0 18px, rgba(245,181,57,.04) 19px 20px)" }} />
        <div className="relative max-w-2xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 font-mono text-[10px] tracking-[.2em] text-amber-300">
            <Feather size={13} /> THE STORY BEHIND DEEPFALCON
          </div>
          <h1 className="font-bold text-4xl tracking-tight text-white sm:text-5xl" style={{ fontFamily: "Syne, system-ui, sans-serif" }}>
            Making the impossible <span className="text-amber-400">visible.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-stone-300">
            DeepFalcon is built around a simple belief: distance should never make care feel impossible.
            It combines consent-led sharing with clear, useful geographical coordination.
          </p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_290px]">
        <article className="rounded-2xl border border-border bg-card/70 p-6 shadow-xl shadow-black/10 sm:p-8">
          <div className="flex flex-wrap items-center gap-4">
            <img
              src={DEV_PHOTO}
              alt="Godwin Confidence, developer of DeepFalcon"
              className="h-20 w-20 rounded-full object-cover object-top ring-4 ring-amber-400/20 shadow-lg shadow-amber-950/40 sm:h-24 sm:w-24"
            />
            <div>
              <p className="font-mono text-[10px] font-bold tracking-[.18em] text-amber-400">CREATOR &amp; DEVELOPER</p>
              <h2 className="mt-1 text-2xl font-bold text-foreground">Godwin Confidence</h2>
              <p className="mt-1 text-sm text-muted-foreground">Chemistry student · Geographical coordination builder</p>
            </div>
          </div>

          <div className="mt-7 space-y-4 text-sm leading-7 text-muted-foreground">
            <p>
              Godwin Confidence is a young, talented builder who studied chemistry and chose to turn his curiosity toward geographical coordination.
              He created DeepFalcon to make the impossible possible: helping people coordinate location, presence, and care with clarity and consent.
            </p>
            <p>
              The project brings a scientist&apos;s attention to detail to real-world mapping—transforming complex location signals into something people can understand and use.
            </p>
          </div>
        </article>

        <aside className="space-y-4">
          <InfoCard icon={Atom} title="The science of curiosity" text="A chemistry background informs a careful, analytical way of building." />
          <InfoCard icon={MapPinned} title="Coordination with purpose" text="Geographical intelligence designed to bring people closer, responsibly." />
          <InfoCard icon={ShieldCheck} title="Consent first" text="Useful technology should respect the person behind every location." />
        </aside>
      </section>

      <footer className="flex flex-col gap-3 rounded-2xl border border-amber-500/15 bg-amber-500/[.045] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-400"><Copyright size={18} /></div>
          <div>
            <p className="text-sm font-semibold text-foreground">© {new Date().getFullYear()} DeepFalcon. All rights reserved.</p>
            <p className="text-xs text-muted-foreground">DeepFalcon, its visual identity, software, and original content are protected.</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-amber-400/80"><Sparkles size={12} /> BUILT BY GODWIN CONFIDENCE</div>
      </footer>
    </div>
  );
}

function InfoCard({ icon: Icon, title, text }: { icon: typeof Atom; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/55 p-5">
      <Icon className="mb-3 h-5 w-5 text-amber-400" />
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  );
}