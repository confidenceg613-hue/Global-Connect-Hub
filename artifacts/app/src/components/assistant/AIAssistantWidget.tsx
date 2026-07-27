import React, { useEffect, useState } from 'react';
import { useAIAgent } from '@/hooks/use-ai-agent';
import { AIControlPanel } from '@/components/assistant/AIControlPanel';
import { Mic, MicOff, Bot, X } from 'lucide-react';

/**
 * Floating AI Assistant Widget — Apex amber/navy cyber theme
 */
export function AIAssistantWidget() {
  const { microphoneActive, session, toggleMicrophone, startSession, endSession } = useAIAgent();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true);

  useEffect(() => {
    if (!microphoneActive || !('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          console.log('[Voice] Recognized:', event.results[i][0].transcript);
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.warn('[Voice] Error:', event.error);
    };

    if (microphoneActive) recognition.start();
    return () => { recognition.stop(); };
  }, [microphoneActive]);

  return (
    <>
      {/* Floating Action Button */}
      <div className="fixed bottom-4 right-4 z-40">
        {isMinimized && (
          <button
            onClick={() => setIsOpen(!isOpen)}
            title={isOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
            style={{
              width: 56, height: 56, borderRadius: "50%",
              background: isOpen
                ? "linear-gradient(135deg, #D97706 0%, #B45309 100%)"
                : "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
              boxShadow: "0 0 20px rgba(245,160,8,0.45), 0 4px 12px rgba(0,0,0,0.4)",
              border: "1px solid rgba(245,160,8,0.35)",
              color: "#040A18",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            <Bot size={24} />
          </button>
        )}
      </div>

      {/* Panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-4 z-50 w-80 max-h-96 overflow-hidden rounded-xl"
          style={{
            background: "#040A18",
            border: "1px solid rgba(245,160,8,0.25)",
            boxShadow: "0 0 30px rgba(245,160,8,0.1), 0 20px 48px rgba(0,0,0,0.6)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3"
            style={{
              borderBottom: "1px solid rgba(245,160,8,0.18)",
              background: "linear-gradient(135deg, rgba(245,160,8,0.08) 0%, rgba(217,119,6,0.05) 100%)",
            }}
          >
            <div className="flex items-center gap-2.5">
              <Bot size={18} style={{ color: "#F59E0B" }} />
              <span style={{ fontFamily: "'Share Tech Mono', monospace", color: "#E2E5EE", fontWeight: 600, fontSize: 14, letterSpacing: "0.04em" }}>
                AI ASSISTANT
              </span>
              {session && (
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#F59E0B",
                  boxShadow: "0 0 6px rgba(245,160,8,0.8)", animation: "pulse 2s infinite" }} />
              )}
            </div>
            <button onClick={() => setIsOpen(false)}
              style={{ color: "rgba(245,160,8,0.55)", background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", alignItems: "center" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#F59E0B")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(245,160,8,0.55)")}
            >
              <X size={18} />
            </button>
          </div>

          {/* Quick controls */}
          <div className="flex gap-2 px-4 py-3" style={{ borderBottom: "1px solid rgba(245,160,8,0.12)" }}>
            {!session ? (
              <button onClick={() => startSession()} style={{
                flex: 1, padding: "8px 12px",
                background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                color: "#040A18", fontWeight: 700, fontSize: 13,
                fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.05em",
                border: "none", borderRadius: 6, cursor: "pointer",
              }}>
                START SESSION
              </button>
            ) : (
              <button onClick={() => endSession()} style={{
                flex: 1, padding: "8px 12px",
                background: "rgba(239,68,68,0.15)", color: "#EF4444",
                border: "1px solid rgba(239,68,68,0.3)",
                fontWeight: 700, fontSize: 13,
                fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.05em",
                borderRadius: 6, cursor: "pointer",
              }}>
                END SESSION
              </button>
            )}

            <button onClick={toggleMicrophone} style={{
              flex: 1, padding: "8px 12px",
              background: microphoneActive ? "rgba(239,68,68,0.15)" : "rgba(245,160,8,0.12)",
              color: microphoneActive ? "#EF4444" : "#F59E0B",
              border: microphoneActive ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(245,160,8,0.25)",
              fontWeight: 700, fontSize: 13,
              fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.05em",
              borderRadius: 6, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
              {microphoneActive ? <><MicOff size={14}/> MIC OFF</> : <><Mic size={14}/> MIC ON</>}
            </button>
          </div>

          {/* Content */}
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            <AIControlPanel />
          </div>
        </div>
      )}
    </>
  );
}

export default AIAssistantWidget;
