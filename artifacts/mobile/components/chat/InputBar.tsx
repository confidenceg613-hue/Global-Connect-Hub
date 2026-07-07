import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
  Keyboard,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';

interface Props {
  onSend: (text: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  generating?: boolean;
  placeholder?: string;
}

export default function InputBar({
  onSend,
  onStop,
  disabled = false,
  generating = false,
  placeholder = 'Ask about your location history…',
}: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? colors.dark : colors.light;
  const insets = useSafeAreaInsets();

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || generating) return;
    onSend(trimmed);
    setText('');
    Keyboard.dismiss();
  };

  const canSend = text.trim().length > 0 && !disabled && !generating;
  const showStop = generating && onStop;

  return (
    <View style={[
      styles.container,
      {
        backgroundColor: c.card,
        borderTopColor: c.border,
        paddingBottom: Math.max(insets.bottom, 12),
      },
    ]}>
      <View style={[styles.row, { backgroundColor: c.muted, borderColor: c.border }]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: c.foreground }]}
          placeholder={placeholder}
          placeholderTextColor={c.mutedForeground}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={2000}
          returnKeyType="send"
          onSubmitEditing={Platform.OS !== 'ios' ? handleSend : undefined}
          editable={!disabled}
          blurOnSubmit={Platform.OS !== 'ios'}
        />

        {showStop ? (
          <TouchableOpacity onPress={onStop} style={[styles.btn, { backgroundColor: '#ef444420' }]}>
            <Ionicons name="stop" size={20} color="#ef4444" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleSend}
            disabled={!canSend}
            style={[styles.btn, { backgroundColor: canSend ? c.primary : `${c.primary}30` }]}
          >
            {generating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={20} color={canSend ? '#fff' : c.mutedForeground} />
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 10,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 22,
    borderWidth: 1,
    paddingVertical: 6,
    paddingLeft: 14,
    paddingRight: 6,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    maxHeight: 120,
    paddingTop: 4,
    paddingBottom: 4,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
