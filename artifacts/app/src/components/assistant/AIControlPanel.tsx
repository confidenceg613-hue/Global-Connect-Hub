import React, { useState } from 'react';
import { useAIAgent } from '@/hooks/use-ai-agent';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Mic, MicOff, Settings, Play, Square, Eye, EyeOff } from 'lucide-react';

export function AIControlPanel() {
  const {
    session,
    capabilities,
    microphoneActive,
    actionHistory,
    startSession,
    endSession,
    toggleMicrophone,
    updateCapability,
  } = useAIAgent();

  const [showHistory, setShowHistory] = useState(false);
  const [expandedCapability, setExpandedCapability] = useState<string | null>(null);

  const riskColors: Record<string, string> = {
    low: 'bg-amber-500',
    medium: 'bg-yellow-600',
    high: 'bg-red-500',
  };

  const handleCapabilityToggle = (capId: string, enabled: boolean) => {
    updateCapability(capId, { enabled });
  };

  const handleAutoApproveToggle = (capId: string, autoApprove: boolean) => {
    updateCapability(capId, { autoApprove });
  };

  return (
    <div className="space-y-4 w-full max-w-2xl">
      {/* Session Control */}
      <Card className="border-slate-700 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-lg text-slate-100">AI Agent Control</CardTitle>
          <CardDescription className="text-slate-400">
            {session ? `Session active since ${new Date(session.startTime).toLocaleTimeString()}` : 'No active session'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {!session ? (
              <Button
                onClick={() => startSession()}
                className="bg-amber-500 hover:bg-amber-400 text-[#1A0F08] font-bold"
              >
                <Play className="w-4 h-4 mr-2" />
                Start Session
              </Button>
            ) : (
              <Button onClick={endSession} className="bg-red-600 hover:bg-red-700 text-white">
                <Square className="w-4 h-4 mr-2" />
                End Session
              </Button>
            )}

            <Button
              onClick={toggleMicrophone}
              className={`${
                microphoneActive ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-500'
              } text-white`}
            >
              {microphoneActive ? (
                <>
                  <MicOff className="w-4 h-4 mr-2" />
                  Disable Mic
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 mr-2" />
                  Enable Mic
                </>
              )}
            </Button>
          </div>

          {microphoneActive && (
            <div className="p-3 bg-amber-950/40 border border-amber-700/50 rounded-lg text-amber-200 text-sm flex items-start gap-2">
              <Mic className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                Microphone is active and listening. Voice commands will be processed automatically. Auto-disables after 30
                minutes.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Capabilities */}
      <Card className="border-slate-700 bg-slate-900">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg text-slate-100">Capabilities</CardTitle>
              <CardDescription className="text-slate-400">
                Configure AI automation features and permissions
              </CardDescription>
            </div>
            <Settings className="w-5 h-5 text-slate-400" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {capabilities.map((cap) => (
            <div
              key={cap.id}
              className="border border-slate-700 rounded-lg p-4 hover:bg-slate-800/50 transition"
              onClick={() => setExpandedCapability(expandedCapability === cap.id ? null : cap.id)}
            >
              <div className="flex items-start justify-between cursor-pointer">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-slate-100">{cap.name}</h3>
                    <Badge className={`${riskColors[cap.riskLevel]} text-white text-xs`}>
                      {cap.riskLevel}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-400">{cap.description}</p>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCapabilityToggle(cap.id, !cap.enabled);
                    }}
                    className={`w-10 h-6 rounded-full transition flex items-center px-1 ${
                      cap.enabled ? 'bg-amber-500' : 'bg-stone-600'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition transform ${
                        cap.enabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {expandedCapability === cap.id && cap.enabled && (
                <div className="mt-4 pt-4 border-t border-slate-700 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-slate-300">Auto-approve without confirmation</label>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAutoApproveToggle(cap.id, !cap.autoApprove);
                      }}
                      className={`w-10 h-6 rounded-full transition flex items-center px-1 ${
                        cap.autoApprove ? 'bg-amber-600' : 'bg-stone-600'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white transition transform ${
                          cap.autoApprove ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {cap.riskLevel === 'high' && !cap.autoApprove && (
                    <div className="flex items-start gap-2 p-3 bg-red-950 border border-red-700 rounded text-red-200 text-xs">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>High-risk action. Requires explicit user consent per action.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Action History */}
      <Card className="border-slate-700 bg-slate-900">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg text-slate-100">Action History</CardTitle>
              <CardDescription className="text-slate-400">
                Recent AI agent actions ({actionHistory.length})
              </CardDescription>
            </div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-slate-400 hover:text-slate-200"
            >
              {showHistory ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </CardHeader>

        {showHistory && (
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {actionHistory.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-4">No actions yet</p>
              ) : (
                actionHistory.map((action) => (
                  <div key={action.id} className="p-3 bg-slate-800 rounded text-sm border border-slate-700">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-mono text-slate-300">{action.type}</p>
                        <p className="text-slate-400 text-xs mt-1">
                          {new Date(action.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                      <Badge className={action.userConsent ? 'bg-green-600' : 'bg-gray-600'}>
                        {action.userConsent ? 'Approved' : 'Denied'}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}