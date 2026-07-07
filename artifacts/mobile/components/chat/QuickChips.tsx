import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet, useColorScheme } from 'react-native';
import colors from '@/constants/colors';

const CHIPS = [
  { label: '📍 Where was I this week?',    query: 'Summarize my location movements this week' },
  { label: '📊 Analyze my patterns',        query: 'Analyze my movement patterns and habits' },
  { label: '📏 Distance this week',          query: 'How far did I travel this week total?' },
  { label: '🕗 Most visited places',         query: 'What are my most frequently visited places?' },
  { label: '📝 Recent notes',                query: 'Show me my recent location notes' },
  { label: '📅 Yesterday\'s route',          query: 'Summarize my movements yesterday' },
  { label: '🌅 Morning routine',            query: 'What does my typical morning routine look like?' },
  { label: '🏠 Home & work patterns',       query: 'Analyze my home to work commute patterns' },
];

interface Props {
  onSelect: (query: string) => void;
  disabled?: boolean;
}

export default function QuickChips({ onSelect, disabled }: Props) {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? colors.dark : colors.light;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {CHIPS.map((chip) => (
        <TouchableOpacity
          key={chip.label}
          onPress={() => !disabled && onSelect(chip.query)}
          disabled={disabled}
          style={[
            styles.chip,
            {
              backgroundColor: disabled ? `${c.muted}60` : c.muted,
              borderColor: c.border,
            },
          ]}
        >
          <Text style={[styles.chipText, { color: disabled ? c.mutedForeground : c.foreground }]}>
            {chip.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  chip: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
});
