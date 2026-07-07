/**
 * MessageBubble — renders chat messages with:
 *  - Markdown-style formatting (**bold**, _italic_, • lists, headers)
 *  - Animated typing indicator (three bouncing dots)
 *  - Rich stat/list card blocks
 *  - Inline suggestion chips
 *  - Bot avatar with gradient ring
 */
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  useColorScheme,
  Easing,
} from 'react-native';
import colors from '@/constants/colors';
import type { CardData } from '@/lib/ai/rule-engine';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isTyping?: boolean;
  suggestions?: string[];
  cardData?: CardData;
}

interface Props {
  message: Message;
  onSuggestion?: (query: string) => void;
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingDots({ color }: { color: string }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay(480 - i * 160),
        ])
      )
    );
    const parallel = Animated.parallel(animations);
    parallel.start();
    return () => parallel.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={dotStyles.row}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            dotStyles.dot,
            { backgroundColor: color },
            { transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] },
          ]}
        />
      ))}
    </View>
  );
}

const dotStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});

// ─── Markdown-style Text Renderer ─────────────────────────────────────────────

function FormattedText({ text, color, muted }: { text: string; color: string; muted: string }) {
  // Split into lines and handle • lists and headers
  const lines = text.split('\n');

  return (
    <View style={{ gap: 1 }}>
      {lines.map((line, li) => {
        const trimmed = line.trimStart();

        // Blank line → spacer
        if (trimmed === '') {
          return <View key={li} style={{ height: 4 }} />;
        }

        // Render inline bold/italic within a line
        const renderInline = (s: string, baseStyle: object) => {
          // Split on **bold** and _italic_ patterns
          const parts: Array<{ text: string; bold?: boolean; italic?: boolean }> = [];
          const re = /(\*\*[^*]+\*\*|_[^_]+_)/g;
          let last = 0;
          let m;
          while ((m = re.exec(s)) !== null) {
            if (m.index > last) parts.push({ text: s.slice(last, m.index) });
            const raw = m[0];
            if (raw.startsWith('**')) parts.push({ text: raw.slice(2, -2), bold: true });
            else parts.push({ text: raw.slice(1, -1), italic: true });
            last = m.index + raw.length;
          }
          if (last < s.length) parts.push({ text: s.slice(last) });

          return (
            <Text key={li} style={baseStyle}>
              {parts.map((p, pi) => (
                <Text
                  key={pi}
                  style={[
                    p.bold   ? { fontFamily: 'Inter_700Bold' } : {},
                    p.italic ? { fontFamily: 'Inter_400Regular', color: muted } : {},
                  ]}
                >
                  {p.text}
                </Text>
              ))}
            </Text>
          );
        };

        // • Bullet list item
        if (trimmed.startsWith('• ') || trimmed.startsWith('- ')) {
          const content = trimmed.slice(2);
          return (
            <View key={li} style={fmtStyles.bulletRow}>
              <Text style={[fmtStyles.bullet, { color: muted }]}>•</Text>
              <View style={{ flex: 1 }}>
                {renderInline(content, [fmtStyles.bulletText, { color }])}
              </View>
            </View>
          );
        }

        // Numbered list
        const numberedMatch = trimmed.match(/^(\d+\.) (.+)$/);
        if (numberedMatch) {
          return (
            <View key={li} style={fmtStyles.bulletRow}>
              <Text style={[fmtStyles.bullet, { color: muted }]}>{numberedMatch[1]}</Text>
              <View style={{ flex: 1 }}>
                {renderInline(numberedMatch[2], [fmtStyles.bulletText, { color }])}
              </View>
            </View>
          );
        }

        return renderInline(line, [fmtStyles.bodyText, { color }]);
      })}
    </View>
  );
}

const fmtStyles = StyleSheet.create({
  bodyText:   { fontSize: 14.5, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  bulletRow:  { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  bullet:     { fontSize: 14.5, fontFamily: 'Inter_400Regular', lineHeight: 21, width: 12 },
  bulletText: { fontSize: 14.5, fontFamily: 'Inter_400Regular', lineHeight: 21, flex: 1 },
});

// ─── Card Block ───────────────────────────────────────────────────────────────

function CardBlock({ card, scheme }: { card: CardData; scheme: 'light' | 'dark' }) {
  const c = scheme === 'dark' ? colors.dark : colors.light;

  return (
    <View style={[cardStyles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={[cardStyles.title, { color: c.foreground }]}>{card.title}</Text>
      <View style={[cardStyles.divider, { backgroundColor: c.border }]} />
      {card.rows.map((row, i) => (
        <View
          key={i}
          style={[
            cardStyles.row,
            { borderTopColor: c.border, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth },
          ]}
        >
          <View style={cardStyles.rowLeft}>
            {row.icon ? <Text style={cardStyles.icon}>{row.icon}</Text> : null}
            <Text style={[cardStyles.label, { color: c.mutedForeground }]}>{row.label}</Text>
          </View>
          <Text style={[cardStyles.value, { color: c.foreground }]}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    overflow: 'hidden',
  },
  title: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { fontSize: 14 },
  label: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  value: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});

// ─── Suggestion Chips ─────────────────────────────────────────────────────────

function SuggestionChips({ chips, onPress, scheme }: { chips: string[]; onPress: (s: string) => void; scheme: 'light' | 'dark' }) {
  const c = scheme === 'dark' ? colors.dark : colors.light;
  return (
    <View style={chipStyles.row}>
      {chips.map((chip, i) => (
        <TouchableOpacity
          key={i}
          onPress={() => onPress(chip)}
          style={[chipStyles.chip, { backgroundColor: c.muted, borderColor: c.border }]}
          activeOpacity={0.7}
        >
          <Text style={[chipStyles.text, { color: c.primary }]}>{chip}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const chipStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  text: { fontSize: 12.5, fontFamily: 'Inter_500Medium' },
});

// ─── Main MessageBubble ───────────────────────────────────────────────────────

export default function MessageBubble({ message, onSuggestion }: Props) {
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const c = scheme === 'dark' ? colors.dark : colors.light;

  const isUser = message.role === 'user';
  const isTyping = message.isTyping;

  // Fade-in animation
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(6)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isUser) {
    return (
      <Animated.View style={[styles.row, styles.userRow, { opacity, transform: [{ translateY }] }]}>
        <View style={[styles.userBubble, { backgroundColor: c.primary }]}>
          <Text style={styles.userText}>{message.content}</Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.row, styles.botRow, { opacity, transform: [{ translateY }] }]}>
      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: `${c.primary}22`, borderColor: `${c.primary}55` }]}>
        <Text style={styles.avatarEmoji}>✦</Text>
      </View>

      {/* Bubble */}
      <View style={[styles.botBubble, { backgroundColor: c.card, borderColor: c.border }]}>
        {isTyping ? (
          <TypingDots color={c.mutedForeground} />
        ) : (
          <>
            <FormattedText
              text={message.content}
              color={c.foreground}
              muted={c.mutedForeground}
            />
            {message.cardData && (
              <CardBlock card={message.cardData} scheme={scheme} />
            )}
            {message.suggestions && message.suggestions.length > 0 && onSuggestion && (
              <SuggestionChips
                chips={message.suggestions}
                onPress={onSuggestion}
                scheme={scheme}
              />
            )}
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginVertical: 4,
    gap: 8,
    maxWidth: '92%',
  },
  userRow: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end',
    maxWidth: '80%',
  },
  botRow: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  userBubble: {
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    fontSize: 14.5,
    fontFamily: 'Inter_400Regular',
    color: '#fff',
    lineHeight: 21,
  },
  botBubble: {
    flex: 1,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  avatarEmoji: { fontSize: 13 },
});
