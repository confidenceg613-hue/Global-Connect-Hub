/**
 * Keyboard-safe scroll view for Expo Go.
 *
 * react-native-keyboard-controller's KeyboardAwareScrollView requires a
 * custom dev build (native module) and crashes in Expo Go. This component
 * uses React Native's built-in ScrollView + KeyboardAvoidingView instead,
 * which works in both Expo Go and production builds.
 *
 * If you ever switch to a custom dev build, you can re-enable the
 * KeyboardAwareScrollView import from react-native-keyboard-controller.
 */
import { KeyboardAvoidingView, Platform, ScrollView, ScrollViewProps, StyleSheet } from 'react-native';

type Props = ScrollViewProps & {
  /** Passed through to ScrollView */
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
};

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  style,
  contentContainerStyle,
  ...props
}: Props) {
  return (
    <KeyboardAvoidingView
      style={[styles.flex, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        contentContainerStyle={contentContainerStyle}
        {...props}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
