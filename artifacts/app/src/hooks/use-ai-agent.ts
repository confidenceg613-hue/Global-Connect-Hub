import { useEffect, useState, useCallback } from 'react';
import { aiAgentService, AgentSession, AgentCapability, AgentAction } from '@/services/ai-agent';

export function useAIAgent() {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [capabilities, setCapabilities] = useState<AgentCapability[]>([]);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [actionHistory, setActionHistory] = useState<AgentAction[]>([]);

  // Load initial state
  useEffect(() => {
    setCapabilities(aiAgentService.getCapabilities());
    setActionHistory(aiAgentService.getActionHistory());
  }, []);

  const startSession = useCallback((caps?: string[]) => {
    const newSession = aiAgentService.startSession(caps);
    setSession(newSession);
    return newSession;
  }, []);

  const endSession = useCallback(() => {
    aiAgentService.endSession();
    setSession(null);
  }, []);

  const executeAction = useCallback((action: Omit<AgentAction, 'id' | 'timestamp' | 'userConsent'>) => {
    const result = aiAgentService.executeAction(action);
    if (result) {
      setActionHistory((prev) => [...prev, result]);
    }
    return result;
  }, []);

  const toggleMicrophone = useCallback(async () => {
    if (microphoneActive) {
      aiAgentService.disableMicrophone();
      setMicrophoneActive(false);
    } else {
      const enabled = await aiAgentService.enableMicrophone();
      setMicrophoneActive(enabled);
    }
  }, [microphoneActive]);

  const updateCapability = useCallback((capId: string, updates: Partial<AgentCapability>) => {
    aiAgentService.updateCapability(capId, updates);
    setCapabilities(aiAgentService.getCapabilities());
  }, []);

  const recognizeIntent = useCallback((text: string) => {
    return aiAgentService.recognizeIntent(text);
  }, []);

  return {
    session,
    capabilities,
    microphoneActive,
    actionHistory,
    startSession,
    endSession,
    executeAction,
    toggleMicrophone,
    updateCapability,
    recognizeIntent,
  };
}