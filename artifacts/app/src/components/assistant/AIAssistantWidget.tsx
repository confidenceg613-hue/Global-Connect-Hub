import React, { useEffect, useState } from 'react';
import { useAIAgent } from '@/hooks/use-ai-agent';
import { AIControlPanel } from '@/components/assistant/AIControlPanel';
import { Mic, MicOff, Bot, X } from 'lucide-react';

/**
 * Floating AI Assistant Widget
 * Provides quick access to AI automation controls and voice commands
 */
export function AIAssistantWidget() {
  const { microphoneActive, session, toggleMicrophone, startSession, endSession } = useAIAgent();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true);

  // Start listening for voice commands when microphone is enabled
  useEffect(() => {
    if (!microphoneActive || !('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      console.log('[Voice] Listening...');
    };

    recognition.onresult = (event: any) => {
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          console.log('[Voice] Recognized:', transcript);
          // Voice command processing would go here
        } else {
          interimTranscript += transcript;
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.warn('[Voice] Error:', event.error);
    };

    if (microphoneActive) {
      recognition.start();
    }

    return () => {
      recognition.stop();
    };
  }, [microphoneActive]);

  return (
    <>
      {/* Floating Button */}
      <div className="fixed bottom-4 right-4 z-40">
        {isMinimized ? (
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition transform hover:scale-110 flex items-center justify-center"
            title={isOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
          >
            <Bot className="w-6 h-6" />
          </button>
        ) : null}
      </div>

      {/* Panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-4 z-50 max-w-sm max-h-96 overflow-hidden">
          <div className="bg-slate-950 border border-slate-700 rounded-lg shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-gradient-to-r from-indigo-600/10 to-purple-600/10">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-400" />
                <span className="font-semibold text-slate-100">AI Assistant</span>
                {session && (
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="Session active" />
                )}
              </div>

              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-200 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Controls */}
            <div className="p-4 border-b border-slate-700 flex gap-2">
              {!session ? (
                <button
                  onClick={() => startSession()}
                  className="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded transition"
                >
                  Start Session
                </button>
              ) : (
                <button
                  onClick={() => endSession()}
                  className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition"
                >
                  End Session
                </button>
              )}

              <button
                onClick={toggleMicrophone}
                className={`flex-1 px-3 py-2 text-white text-sm rounded transition flex items-center justify-center gap-2 ${
                  microphoneActive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {microphoneActive ? (
                  <>
                    <MicOff className="w-4 h-4" />
                    Mic Off
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" />
                    Mic On
                  </>
                )}
              </button>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto max-h-64">
              <AIControlPanel />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AIAssistantWidget;