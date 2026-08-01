/**
 * PhoneLink AI — Advanced Rule-Based Chat Interface
 *
 * Zero native deps. Instant responses. Full location data awareness.
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
  Animated,
  Easing,
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

import {
  processMessage,
  createContext,
  type ConversationContext,
} from '@/lib/ai/rule-engine';
import { saveNote } from '@/lib/db/location-repo';
import { syncAll } from '@/lib/ai/sync';

let _msgId = 0;
const uid = () => String(++_msgId);

const WELCOME: Message = {
  id: uid(),
  role: 'assistant',
  content: `👋 Hi! I'm **PhoneLink AI**, your personal location assistant.\n\nI can answer questions about your movements, travel patterns, routes, and more — all from data stored on your device.\n\nWhat would you like to know?`,
  suggestions: [
    'Where was I this week?',
    'Analyze my patterns',
    'How far did I travel?',
    'What can you do?',
  ],
};

const TYPING_MSG = (id: string): Message => ({
  id,
  role: 'assistant',
  content: '',
  isTyping: true,
});

export default function ChatTab() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? colors.dark : colors.light;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const { startTracking, stopTracking, lastLocation, status: trackingStatus } = useLocationTracking();

  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [responding, setResponding] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done'>('idle');
  const flatRef = useRef<FlatList>(null);
  const ctxRef = useRef<ConversationContext>(createContext());

  // ── Sync on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setSyncStatus('syncing');
    syncAll(userId)
      .then(() => { if (!cancelled) setSyncStatus('done'); })
      .catch(() => { if (!cancelled) setSyncStatus('idle'); });
    return () => { cancelled = true; };
  }, [userId]);

  // ── Keep context in sync with tracking state ───────────────────────────────
  useEffect(() => {
    ctxRef.current = {
      ...ctxRef.current,
      isTracking: trackingStatus === 'active',
    };
  }, [trackingStatus]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 60);
  }, []);

  // ── Send message ───────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text: string) => {
    if (responding || !text.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Append user message
    const userMsg: Message = { id: uid(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    scrollToBottom();

    // Show typing indicator
    const typingId = uid();
    setResponding(true);
    setMessages(prev => [...prev, TYPING_MSG(typingId)]);
    scrollToBottom();

    try {
      const { response, nextContext } = await processMessage(
        text,
        ctxRef.current,
        { isTracking: trackingStatus === 'active' },
      );
      ctxRef.current = nextContext;

      // Delay simulates thinking (scaled to response complexity)
      const delay = response.typingMs ?? 600;
      await new Promise(r => setTimeout(r, Math.min(delay, 1500)));

      // Replace typing indicator with real response
      const botMsg: Message = {
        id: typingId,
        role: 'assistant',
        content: response.text,
        suggestions: response.suggestions,
        cardData: response.cardData,
      };
      setMessages(prev => prev.map(m => m.id === typingId ? botMsg : m));
      scrollToBottom();

      // Execute app action if any
      if (response.action) {
        const { type, noteText } = response.action;
        if (type === 'START_TRACKING') {
          await startTracking();
        } else if (type === 'STOP_TRACKING') {
          await stopTracking();
        } else if (type === 'CREATE_NOTE' && noteText) {
          await saveNote({
            text: noteText,
            latitude: lastLocation?.coords.latitude,
            longitude: lastLocation?.coords.longitude,
          });
        } else if (type === 'SHARE_LOCATION') {
          router.push('/(tabs)');
        }
      }
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === typingId
          ? { ...m, content: '⚠️ Something went wrong. Please try again.', isTyping: false }
          : m,
      ));
    } finally {
      setResponding(false);
    }
  }, [responding, trackingStatus, startTracking, stopTracking, lastLocation, router, scrollToBottom]);

  const handleSuggestion = useCallback((q: string) => {
    if (!responding) handleSend(q);
  }, [responding, handleSend]);

  const handleClear = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMessages([WELCOME]);
    ctxRef.current = createContext();
  }, []);

  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: c.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* ── Header ── */}
      <View style={[
        styles.header,
        { paddingTop: insets.top + 8, backgroundColor: c.card, borderBottomColor: c.border },
      ]}>
        <View style={styles.headerLeft}>
          <View style={styles.headerTitleRow}>
            <View style={[styles.aiBadge, { backgroundColor: c.primary }]}>
              <Text style={styles.aiBadgeText}>AI</Text>
            </View>
            <Text style={[styles.headerTitle, { color: c.foreground }]}>PhoneLink AI</Text>
          </View>
          {syncStatus === 'syncing' && (
            <View style={styles.syncRow}>
              <ActivityIndicator size="small" color={c.primary} style={{ marginRight: 4 }} />
              <Text style={[styles.syncText, { color: c.mutedForeground }]}>Syncing data…</Text>
            </View>
          )}
          {syncStatus === 'done' && (
            <Text style={[styles.syncText, { color: c.success }]}>✓ Data up to date</Text>
          )}
        </View>
        <View style={styles.headerActions}>
          <View style={[styles.statusDot, { backgroundColor: trackingStatus === 'active' ? c.success : c.muted }]} />
          <TouchableOpacity onPress={handleClear} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={[styles.clearBtn, { color: c.mutedForeground }]}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Messages ── */}
      <FlatList
        ref={flatRef}
        data={reversed}
        keyExtractor={m => m.id}
        renderItem={({ item }) => (
          <MessageBubble message={item} onSuggestion={handleSuggestion} />
        )}
        inverted
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        ListHeaderComponent={
          <QuickChips onSelect={handleSend} disabled={responding} />
        }
      />

      {/* ── Input ── */}
      <InputBar
        onSend={handleSend}
        disabled={responding}
        generating={responding}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerLeft: { flex: 1, gap: 2 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiBadge: {
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  aiBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: 0.5,
  },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  syncRow: { flexDirection: 'row', alignItems: 'center' },
  syncText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  clearBtn: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  listContent: { paddingVertical: 8 },
});
