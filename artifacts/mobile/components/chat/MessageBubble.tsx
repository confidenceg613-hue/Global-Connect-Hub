/**
 * Chat message bubble with lightweight inline Markdown rendering.
 * Supports: **bold**, *italic*, `code`, ``` code blocks, bullet lists, and plain text.
 */
import React, { memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import colors from '@/constants/colors';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** True while streaming tokens in */
  streaming?: boolean;
  tokensPerSec?: number;
}

interface Props {
  message: Message;
}

// ─── Minimal Markdown renderer ────────────────────────────────────────────────

interface Span {
  type: 'text' | 'bold' | 'italic' | 'code';
  text: string;
}

function parseInline(line: string): Span[] {
  const spans: Span[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) spans.push({ type: 'text', text: line.slice(last, m.index) });
    if (m[0].startsWith('**'))  spans.push({ type: 'bold',   text: m[2] });
    else if (m[0].startsWith('*')) spans.push({ type: 'italic', text: m[3] });
    else if (m[0].startsWith('`')) spans.push({ type: 'code',   text: m[4] });
    last = m.index + m[0].length;
  }
  if (last < line.length) spans.push({ type: 'text', text: line.slice(last) });
  return spans;
}

function SpanText({ span, c }: { span: Span; c: typeof colors.dark }) {
  switch (span.type) {
    case 'bold':   return <Text style={{ fontWeight: '700' }}>{span.text}</Text>;
    case 'italic': return <Text style={{ fontStyle: 'italic' }}>{span.text}</Text>;
    case 'code':
      return (
        <Text style={{ fontFamily: 'monospace', backgroundColor: `${c.muted}88`, borderRadius: 4, paddingHorizontal: 3 }}>
          {span.text}
        </Text>
      );
    default:       return <Text>{span.text}</Text>;
  }
}

interface LineBlock {
  type: 'paragraph' | 'bullet' | 'code_block' | 'heading';
  text: string;
  level?: number;
}

function parseBlocks(content: string): LineBlock[] {
  const lines = content.split('\n');
  const blocks: LineBlock[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  for (const raw of lines) {
    const line = raw;
    if (line.startsWith('```')) {
      if (inCode) {
        blocks.push({ type: 'code_block', text: codeLines.join('\n') });
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    if (line.startsWith('# '))  { blocks.push({ type: 'heading', text: line.slice(2), level: 1 }); continue; }
    if (line.startsWith('## ')) { blocks.push({ type: 'heading', text: line.slice(3), level: 2 }); continue; }
    if (line.startsWith('- ') || line.startsWith('• ') || /^\d+\.\s/.test(line)) {
      blocks.push({ type: 'bullet', text: line.replace(/^[-•]\s|^\d+\.\s/, '') });
      continue;
    }
    if (line.trim()) blocks.push({ type: 'paragraph', text: line });
  }
  if (inCode && codeLines.length) blocks.push({ type: 'code_block', text: codeLines.join('\n') });
  return blocks;
}

function MarkdownBlock({ block, c, textColor }: { block: LineBlock; c: any; textColor: string }) {
  switch (block.type) {
    case 'heading':
      return (
        <Text style={[styles.heading, { color: textColor, fontSize: block.level === 1 ? 16 : 14 }]}>
          {block.text}
        </Text>
      );
    case 'bullet':
      return (
        <View style={styles.bulletRow}>
          <Text style={{ color: textColor, marginRight: 6 }}>•</Text>
          <Text style={[styles.bodyText, { color: textColor, flex: 1 }]}>
            {parseInline(block.text).map((s, i) => <SpanText key={i} span={s} c={c} />)}
          </Text>
        </View>
      );
    case 'code_block':
      return (
        <View style={[styles.codeBlock, { backgroundColor: `${c.muted}99` }]}>
          <Text style={[styles.codeText, { color: textColor }]}>{block.text}</Text>
        </View>
      );
    default:
      return (
        <Text style={[styles.bodyText, { color: textColor }]}>
          {parseInline(block.text).map((s, i) => <SpanText key={i} span={s} c={c} />)}
        </Text>
      );
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({ message }: Props) {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? colors.dark : colors.light;
  const isUser = message.role === 'user';

  if (message.role === 'system') return null;

  const bubbleBg = isUser ? c.primary : c.card;
  const textColor = isUser ? '#fff' : c.foreground;

  const blocks = parseBlocks(message.content);

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      {!isUser && (
        <View style={[styles.avatar, { backgroundColor: `${c.primary}22`, borderColor: `${c.primary}44` }]}>
          <Text style={{ fontSize: 14 }}>🤖</Text>
        </View>
      )}
      <View style={[
        styles.bubble,
        { backgroundColor: bubbleBg },
        isUser ? styles.bubbleUser : styles.bubbleAssistant,
        { borderColor: isUser ? 'transparent' : c.border },
      ]}>
        {message.streaming && blocks.length === 0 ? (
          <ActivityIndicator size="small" color={c.primary} />
        ) : (
          <>
            {blocks.map((block, i) => (
              <MarkdownBlock key={i} block={block} c={c} textColor={textColor} />
            ))}
            {message.streaming && (
              <View style={styles.cursorRow}>
                <View style={[styles.cursor, { backgroundColor: c.primary }]} />
              </View>
            )}
            {!message.streaming && message.tokensPerSec && message.role === 'assistant' && (
              <Text style={[styles.statsText, { color: `${textColor}55` }]}>
                {message.tokensPerSec.toFixed(1)} tok/s
              </Text>
            )}
          </>
        )}
      </View>
    </View>
  );
});

export default MessageBubble;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'flex-end',
    gap: 8,
  },
  rowUser:      { justifyContent: 'flex-end' },
  rowAssistant: { justifyContent: 'flex-start' },
  avatar: {
    width: 32, height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
  },
  bubbleUser:      { borderBottomRightRadius: 4 },
  bubbleAssistant: { borderBottomLeftRadius: 4 },
  bodyText:   { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_400Regular' },
  heading:    { fontFamily: 'Inter_700Bold', marginTop: 4, marginBottom: 2 },
  bulletRow:  { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: 4 },
  codeBlock:  { borderRadius: 8, padding: 10, marginVertical: 4 },
  codeText:   { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  cursorRow:  { flexDirection: 'row', marginTop: 4 },
  cursor:     { width: 2, height: 16, borderRadius: 1 },
  statsText:  { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 4, textAlign: 'right' },
});
