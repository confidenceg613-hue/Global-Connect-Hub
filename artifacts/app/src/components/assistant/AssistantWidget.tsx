import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Bot, X, Send, Trash2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export default function AssistantWidget() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll to bottom whenever messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load history when widget opens
  useEffect(() => {
    if (!open || !userId || messages.length > 0) return;
    fetch(`${BASE}/api/assistant/history?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(data.messages.map((m: any) => ({ role: m.role, content: m.content })));
        } else {
          setMessages([{ role: "assistant", content: "Hi! I'm your PhoneLink assistant. Ask me about location sharing, invites, geofences, SOS alerts, or anything else in the app." }]);
        }
      })
      .catch(() => {
        setMessages([{ role: "assistant", content: "Hi! I'm your PhoneLink assistant. Ask me about location sharing, invites, geofences, SOS alerts, or anything else in the app." }]);
      });
  }, [open, userId]);

  const send = useCallback(async () => {
    if (!input.trim() || !userId || loading) return;
    const msg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    // Placeholder for streaming response
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(`${BASE}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, message: msg }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        const json = await resp.json().catch(() => ({}));
        throw new Error(json?.error ?? "Assistant error");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.done) break;
            if (parsed.content) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content + parsed.content,
                    streaming: true,
                  };
                }
                return updated;
              });
            }
          } catch (e: any) {
            if (e?.message && e.message !== "undefined") throw e;
          }
        }
      }

      // Mark streaming complete
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = { ...last, streaming: false };
        }
        return updated;
      });
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("Assistant error:", err);
      toast({ title: "Assistant error", description: err?.message ?? String(err), variant: "destructive" });
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          updated[updated.length - 1] = { role: "assistant", content: "Sorry, something went wrong. Please try again.", streaming: false };
        }
        return updated;
      });
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [input, userId, loading, toast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clearChat = () => {
    setMessages([{ role: "assistant", content: "Chat cleared. How can I help you?" }]);
  };

  const close = () => {
    abortRef.current?.abort();
    setOpen(false);
  };

  if (!userId) return null;

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Open assistant"
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-colors"
      >
        <Bot className="w-6 h-6" />
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 flex flex-col bg-background border border-border rounded-2xl shadow-2xl overflow-hidden"
          style={{ maxHeight: "min(70vh, 560px)" }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-indigo-500" />
              <span className="font-semibold text-sm">PhoneLink Assistant</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-mono">Kimi K2</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={clearChat} aria-label="Clear chat"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={close} aria-label="Close assistant"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-indigo-600 text-white rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                }`}>
                  {m.content || (m.streaming ? <span className="inline-block w-4 animate-pulse">▋</span> : "")}
                  {m.streaming && m.content && <span className="inline-block w-2 h-3.5 ml-0.5 bg-current opacity-70 animate-pulse rounded-sm" />}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-border bg-muted/20">
            <div className="flex gap-2 items-end">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything… (Enter to send)"
                rows={1}
                className="flex-1 resize-none text-sm min-h-[36px] max-h-[120px]"
                disabled={loading}
                style={{ fieldSizing: "content" } as any}
              />
              <Button
                size="icon"
                onClick={send}
                disabled={loading || !input.trim()}
                className="h-9 w-9 shrink-0 bg-indigo-600 hover:bg-indigo-500"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">Shift+Enter for new line</p>
          </div>
        </div>
      )}
    </>
  );
}
