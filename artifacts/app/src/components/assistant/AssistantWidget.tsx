import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

export default function AssistantWidget() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [history, open]);

  const send = async () => {
    if (!input.trim() || !userId) return;
    const msg = input.trim();
    setInput("");
    setHistory((h) => [...h, { role: "user", content: msg }]);
    setLoading(true);

    try {
      const resp = await fetch(`${import.meta.env.BASE_URL || ""}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, message: msg }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json?.error || "Assistant error");
      }
      setHistory((h) => [...h, { role: "assistant", content: json.reply }]);
    } catch (err: any) {
      console.error("Assistant send error:", err);
      toast({ title: "Assistant error", description: err?.message ?? String(err), variant: "destructive" });
      setHistory((h) => [...h, { role: "assistant", content: "Sorry — assistant failed: " + (err?.message ?? String(err)) }]);
    } finally {
      setLoading(false);
    }
  };

  if (!userId) return null; // only for signed-in users

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        className="fixed bottom-6 right-6 z-50 rounded-full bg-indigo-600 text-white p-3 shadow-lg"
        title="Assistant"
      >
        AI
      </button>

      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-96 max-h-[70vh] bg-background border border-border rounded-lg shadow-lg p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold">Assistant</h4>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setOpen(false); }}>Close</Button>
            </div>
          </div>

          <div ref={listRef} className="overflow-auto mb-2 space-y-2 flex-1">
            {history.length === 0 ? (
              <div className="text-sm text-muted-foreground">Ask me about your invites, location, or app features.</div>
            ) : history.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <div className={`inline-block px-3 py-1 rounded ${m.role === "user" ? "bg-primary/10" : "bg-muted/80"}`}>
                  <div className="text-sm">{m.content}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 items-end">
            <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} className="flex-1" />
            <div className="flex flex-col gap-1">
              <Button onClick={send} disabled={loading || !input.trim()}>
                {loading ? "…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
