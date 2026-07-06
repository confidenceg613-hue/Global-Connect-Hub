/**
 * Local AI Agent Service - No External API Required
 * Provides autonomous automation capabilities with local inference
 */

export interface AgentAction {
  id: string;
  type: 'map_click' | 'form_submit' | 'button_click' | 'invite_send' | 'location_share' | 'geofence_create';
  target: string;
  params?: Record<string, any>;
  timestamp: number;
  userConsent: boolean;
}

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  autoApprove: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface AgentSession {
  id: string;
  active: boolean;
  startTime: number;
  endTime?: number;
  actions: AgentAction[];
  capabilities: Record<string, boolean>;
}

class AIAgentService {
  private session: AgentSession | null = null;
  private actionLog: AgentAction[] = [];
  private capabilities: Map<string, AgentCapability> = new Map();
  private microphoneActive = false;
  private mediaStream: MediaStream | null = null;

  constructor() {
    this.initializeCapabilities();
    this.loadPreferences();
  }

  private initializeCapabilities() {
    const defaultCapabilities: AgentCapability[] = [
      {
        id: 'map_navigation',
        name: 'Map Navigation',
        description: 'Automated map panning and zooming',
        enabled: true,
        autoApprove: true,
        riskLevel: 'low',
      },
      {
        id: 'location_viewing',
        name: 'Location Viewing',
        description: 'View and analyze shared locations',
        enabled: true,
        autoApprove: true,
        riskLevel: 'low',
      },
      {
        id: 'invite_management',
        name: 'Invite Management',
        description: 'Send and manage contact invites',
        enabled: false,
        autoApprove: false,
        riskLevel: 'medium',
      },
      {
        id: 'location_sharing',
        name: 'Location Sharing',
        description: 'Initiate location sharing with contacts',
        enabled: false,
        autoApprove: false,
        riskLevel: 'high',
      },
      {
        id: 'geofence_automation',
        name: 'Geofence Automation',
        description: 'Create and manage automated geofences',
        enabled: false,
        autoApprove: false,
        riskLevel: 'medium',
      },
      {
        id: 'voice_commands',
        name: 'Voice Commands',
        description: 'Control app via voice when microphone is active',
        enabled: false,
        autoApprove: false,
        riskLevel: 'medium',
      },
    ];

    defaultCapabilities.forEach((cap) => this.capabilities.set(cap.id, cap));
  }

  private loadPreferences() {
    try {
      const saved = localStorage.getItem('ai-agent-preferences');
      if (saved) {
        const prefs = JSON.parse(saved);
        Object.entries(prefs).forEach(([key, value]: [string, any]) => {
          const cap = this.capabilities.get(key);
          if (cap) {
            cap.enabled = value.enabled || false;
            cap.autoApprove = value.autoApprove || false;
          }
        });
      }
    } catch (e) {
      console.warn('Failed to load AI agent preferences:', e);
    }
  }

  private savePreferences() {
    try {
      const prefs: Record<string, any> = {};
      this.capabilities.forEach((cap, key) => {
        prefs[key] = { enabled: cap.enabled, autoApprove: cap.autoApprove };
      });
      localStorage.setItem('ai-agent-preferences', JSON.stringify(prefs));
    } catch (e) {
      console.warn('Failed to save AI agent preferences:', e);
    }
  }

  /**
   * Initialize a new agent session
   */
  public startSession(capabilities?: string[]): AgentSession {
    this.session = {
      id: `session-${Date.now()}`,
      active: true,
      startTime: Date.now(),
      actions: [],
      capabilities: {},
    };

    // Enable specified capabilities or use defaults
    this.capabilities.forEach((cap, key) => {
      this.session!.capabilities[key] = cap.enabled && (!capabilities || capabilities.includes(key));
    });

    return this.session;
  }

  /**
   * End the current agent session
   */
  public endSession() {
    if (this.session) {
      this.session.active = false;
      this.session.endTime = Date.now();
      this.actionLog.push(...this.session.actions);
    }
    this.session = null;
  }

  /**
   * Request permission for a capability
   */
  public requestCapabilityPermission(capabilityId: string): boolean {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) return false;

    // High-risk actions require explicit consent
    if (capability.riskLevel === 'high' && !capability.autoApprove) {
      return false;
    }

    return capability.enabled;
  }

  /**
   * Execute an automated action
   */
  public executeAction(action: Omit<AgentAction, 'id' | 'timestamp' | 'userConsent'>): AgentAction | null {
    if (!this.session?.active) {
      console.warn('No active agent session');
      return null;
    }

    const capability = this.capabilities.get(action.type);
    if (!capability?.enabled) {
      console.warn(`Capability not enabled: ${action.type}`);
      return null;
    }

    const agentAction: AgentAction = {
      ...action,
      id: `action-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      userConsent: !capability.autoApprove ? this.requestCapabilityPermission(action.type) : true,
    };

    if (agentAction.userConsent) {
      this.session.actions.push(agentAction);
      console.log(`[AI Agent] Executed: ${action.type}`, action.params);
      return agentAction;
    }

    return null;
  }

  /**
   * Enable microphone for voice input (respects browser constraints)
   */
  public async enableMicrophone(): Promise<boolean> {
    try {
      // Browser will show permission prompt if not already granted
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.microphoneActive = true;

      // Auto-disable after 30 minutes for safety
      setTimeout(() => this.disableMicrophone(), 30 * 60 * 1000);

      console.log('[AI Agent] Microphone enabled');
      return true;
    } catch (error) {
      console.error('[AI Agent] Microphone permission denied:', error);
      this.microphoneActive = false;
      return false;
    }
  }

  /**
   * Disable microphone
   */
  public disableMicrophone() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    this.microphoneActive = false;
    console.log('[AI Agent] Microphone disabled');
  }

  /**
   * Check if microphone is currently active
   */
  public isMicrophoneActive(): boolean {
    return this.microphoneActive;
  }

  /**
   * Get all capabilities
   */
  public getCapabilities(): AgentCapability[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * Update capability settings
   */
  public updateCapability(capabilityId: string, updates: Partial<AgentCapability>) {
    const capability = this.capabilities.get(capabilityId);
    if (capability) {
      Object.assign(capability, updates);
      this.savePreferences();
    }
  }

  /**
   * Get action history
   */
  public getActionHistory(limit = 50): AgentAction[] {
    const allActions = [...this.actionLog];
    if (this.session) {
      allActions.push(...this.session.actions);
    }
    return allActions.slice(-limit);
  }

  /**
   * Clear action history
   */
  public clearActionHistory() {
    this.actionLog = [];
    if (this.session) {
      this.session.actions = [];
    }
  }

  /**
   * Get current session info
   */
  public getCurrentSession(): AgentSession | null {
    return this.session;
  }

  /**
   * Simple local intent recognition (no external API)
   * Uses pattern matching and heuristics
   */
  public recognizeIntent(text: string): { intent: string; confidence: number; action?: Partial<AgentAction> } {
    const lowerText = text.toLowerCase();

    // Map intents to patterns and actions
    const patterns = [
      {
        intent: 'map_navigation',
        patterns: ['zoom', 'pan', 'scroll', 'move map', 'show me'],
        confidence: 0.8,
      },
      {
        intent: 'location_viewing',
        patterns: ['show location', 'where', 'find', 'locate', 'see location'],
        confidence: 0.85,
      },
      {
        intent: 'invite_send',
        patterns: ['invite', 'send invite', 'add contact', 'connect'],
        confidence: 0.9,
      },
      {
        intent: 'location_sharing',
        patterns: ['share location', 'enable sharing', 'start sharing', 'share my location'],
        confidence: 0.95,
      },
      {
        intent: 'geofence_create',
        patterns: ['set geofence', 'create fence', 'alert zone', 'boundary'],
        confidence: 0.85,
      },
    ];

    for (const pattern of patterns) {
      if (pattern.patterns.some((p) => lowerText.includes(p))) {
        return {
          intent: pattern.intent,
          confidence: pattern.confidence,
          action: {
            type: pattern.intent as any,
            target: 'auto',
            params: { voice: true, originalText: text },
          },
        };
      }
    }

    return { intent: 'unknown', confidence: 0 };
  }
}

export const aiAgentService = new AIAgentService();
