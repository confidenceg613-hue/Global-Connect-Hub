/**
 * PhoneLink AI Chat — fully offline, on-device inference via llama.rn.
 *
 * Features:
 *   - On-device RAG over local SQLite location history
 *   - BM25 + trigram embedding re-ranking
 *   - Streaming token output
 *   - App actions (start/stop tracking, create note, share location)
 *   - Automatic sync from API on mount (caches locally for offline use)
 */
import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  useColorScheme,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';
import { useLocationTracking } from '@/contexts/LocationTrackingContext';
import colors from '@/constants/colors';

import MessageBubble, { type Message } from '@/components/chat/MessageBubble';
import InputBar from '@/components/chat/InputBar';
import QuickChips from '@/components/chat/QuickChips';
import ModelLoader from '@/components/chat/ModelLoader';

import { isModelLoaded, type ModelInfo } from '@/lib/ai/model-manager';
import { runRag, type RagMessage } from '@/lib/ai/rag';
import { parseAction, dispatchAction } from '@/lib/ai/app-actions';
import { saveNote } from '@/lib/db/location-repo';
import { syncAll } from '@/lib/ai/sync';

let _msgCounter = 0;
const uid = () => String(++_msgCounter);

const WELCOME: Message = {
  id: uid(),
  role: 'assistant',
  content: `Hi! I'm your offline AI assistant powered by an on-device language model.\n\nI can help you:\n- **Summarize** your location history\n- **Analyze** movement patterns and habits\n- **Answer** questions like "Where was I last Tuesday?"\n- **Control** the app (start/stop tracking, create notes)\n\nAll data stays 100% on your device. 🔒`,
};

export default function ChatTab() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? colors.dark : colors.light;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const { startTracking, stopTracking, lastLocation } = useLocationTracking();

  // ── Model state ────────────────────────────────────────────────────────────
  const [modelReady, setModelReady] = useState(() => isModelLoaded());
  const [activeModel, setActiveModel] = useState<ModelInfo | null>(null);

  // ── Chat state ─────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [generating, setGenerating] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done'>('idle');
  const abortRef = useRef<AbortController | null>(null);
  const flatRef = useRef<FlatList>(null);
  const historyRef = useRef<RagMessage[]>([]);

  // ── Sync location data from API ────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setSyncStatus('syncing');
    syncAll(userId)
      .then(() => { if (!cancelled) setSyncStatus('done'); })
      .catch(() => { if (!cancelled) setSyncStatus('idle'); });
    return () => { cancelled = true; };
  }, [userId]);

  // ── Abort LLM generation on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // ── Scroll helpers ─────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    flatRef.current?.scrollToEnd({ animated: true });
  }, []);

  // ── Send a message ─────────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (text: string) => {
      if (!activeModel || generating) return;
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Append user message
      const userMsg: Message = { id: uid(), role: 'user', content: text };
      setMessages((prev) => [...prev, userMsg]);
      historyRef.current = [...historyRef.current, { role: 'user', content: text }];
      setTimeout(scrollToBottom, 50);

      // Placeholder streaming message
      const botId = uid();
      setMessages((prev) => [...prev, { id: botId, role: 'assistant', content: '', streaming: true }]);
      setGenerating(true);
      abortRef.current = new AbortController();

      let tokenBuffer = '';

      try {
        const result = await runRag(text, {
          modelInfo: activeModel,
          contactToken: undefined, // uses all synced contacts
          conversationHistory: historyRef.current.slice(-8),
          signal: abortRef.current.signal,
          onToken: (tok) => {
            tokenBuffer += tok;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === botId ? { ...m, content: tokenBuffer } : m,
              ),
            );
          },
        });

        // Finalise message
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId
              ? {
                  ...m,
                  content: result.answer,
                  streaming: false,
                  tokensPerSec: result.tokensPerSec,
                }
              : m,
          ),
        );

        historyRef.current = [
          ...historyRef.current,
          { role: 'assistant', content: result.answer },
        ];

        // Execute AI action command if present
        if (result.action) {
          const action = parseAction(result.action as any);
          const confirmText = await dispatchAction(action, {
            startTracking,
            stopTracking,
            createNote: async (noteText, lat, lng) => {
              await saveNote({
                text: noteText,
                latitude: lat ?? lastLocation?.coords.latitude,
                longitude: lng ?? lastLocation?.coords.longitude,
              });
            },
            shareLocation: () => { router.push('/(tabs)'); },
            navigate: (screen) => { router.push(screen as any); },
          });

          // Show confirmation
          if (confirmText) {
            const confirmMsg: Message = {
              id: uid(),
              role: 'assistant',
              content: `✅ ${confirmText}`,
            };
            setMessages((prev) => [...prev, confirmMsg]);
          }
        }

        setTimeout(scrollToBottom, 100);
      } catch (err: any) {
        const errText = abortRef.current?.signal.aborted
          ? 'Generation stopped.'
          : `Error: ${err?.message ?? 'Unknown error'}`;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, content: errText, streaming: false } : m,
          ),
        );
      } finally {
        setGenerating(false);
        abortRef.current = null;
      }
    },
    [activeModel, generating, scrollToBottom, startTracking, stopTracking, lastLocation, router],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleClear = useCallback(() => {
    setMessages([WELCOME]);
    historyRef.current = [];
  }, []);

  // ── Model ready callback ───────────────────────────────────────────────────
  const handleModelReady = useCallback((model: ModelInfo) => {
    setActiveModel(model);
    setModelReady(true);
  }, []);

  // ── Reversed messages for inverted FlatList ────────────────────────────────
  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  // ── Render: model not loaded ───────────────────────────────────────────────
  if (!modelReady) {
    return <ModelLoader onReady={handleModelReady} />;
  }

  // ── Render: chat UI ────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: c.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: c.card, borderBottomColor: c.border }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>AI Assistant</Text>
          {syncStatus === 'syncing' && (
            <View style={styles.syncRow}>
              <ActivityIndicator size="small" color={c.primary} style={{ marginRight: 4 }} />
              <Text style={[styles.syncText, { color: c.mutedForeground }]}>Syncing…</Text>
            </View>
          )}
          {syncStatus === 'done' && (
            <Text style={[styles.syncText, { color: c.success }]}>✓ Up to date</Text>
          )}
        </View>
        <View style={styles.headerActions}>
          <View style={[styles.offlineBadge, { backgroundColor: `${c.success}20` }]}>
            <Text style={[styles.offlineBadgeText, { color: c.success }]}>100% offline</Text>
          </View>
          <TouchableOpacity onPress={handleClear} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={[styles.clearBtn, { color: c.mutedForeground }]}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages — inverted so newest is at bottom */}
      <FlatList
        ref={flatRef}
        data={reversed}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        inverted
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        ListHeaderComponent={
          // Sits at visual bottom (FlatList is inverted) — quick chips
          <QuickChips onSelect={handleSend} disabled={generating} />
        }
      />

      {/* Input */}
      <InputBar
        onSend={handleSend}
        onStop={handleStop}
        disabled={!activeModel}
        generating={generating}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1 },
  header:  {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerLeft:    { flex: 1, gap: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle:   { fontSize: 18, fontFamily: 'Inter_700Bold' },
  syncRow:       { flexDirection: 'row', alignItems: 'center' },
  syncText:      { fontSize: 11, fontFamily: 'Inter_400Regular' },
  offlineBadge:  { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7 },
  offlineBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.3 },
  clearBtn:      { fontSize: 13, fontFamily: 'Inter_500Medium' },
  listContent:   { paddingVertical: 8 },
});
