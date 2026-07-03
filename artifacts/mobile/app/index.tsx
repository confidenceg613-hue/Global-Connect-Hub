import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  useColorScheme,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCreateUser } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';

const ACCESS_CODE = '419';

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId, login, isLoading } = useAuth();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('+234');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [step, setStep] = useState<'info' | 'code'>('info');

  const createUser = useCreateUser();

  useEffect(() => {
    if (!isLoading && userId) {
      router.replace('/(tabs)');
    }
  }, [userId, isLoading]);

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const handleNext = () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter your full name.');
      return;
    }
    if (!phone.trim()) {
      Alert.alert('Required', 'Please enter your phone number.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep('code');
  };

  const handleSubmit = () => {
    if (code !== ACCESS_CODE) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (newAttempts >= 3) {
        Alert.alert('Too many attempts', 'Please try again later.');
        setCode('');
        setAttempts(0);
        setStep('info');
      } else {
        Alert.alert('Wrong code', `${3 - newAttempts} attempt(s) remaining.`);
        setCode('');
      }
      return;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const cleanCode = countryCode.startsWith('+') ? countryCode : `+${countryCode}`;
    const iso = cleanCode === '+234' ? 'NG' : cleanCode === '+1' ? 'US' : 'US';

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    createUser.mutate(
      {
        data: {
          name: name.trim(),
          phoneNumber: cleanPhone,
          countryCode: cleanCode,
          countryIso: iso,
        },
      },
      {
        onSuccess: async (user) => {
          await login(user.id);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace('/(tabs)');
        },
        onError: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert('Error', 'Failed to sign in. Please try again.');
        },
      }
    );
  };

  const s = makeStyles(colors, isDark);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={s.logoRow}>
            <View style={s.logoIcon}>
              <Ionicons name="shield-checkmark" size={28} color={colors.primary} />
            </View>
            <Text style={s.logoText}>PhoneLink</Text>
          </View>

          {/* Hero */}
          <View style={s.hero}>
            <Text style={s.heroTitle}>
              {step === 'info' ? 'Get Started' : 'Enter Access Code'}
            </Text>
            <Text style={s.heroSub}>
              {step === 'info'
                ? 'Register your phone to manage location sharing and consents.'
                : 'Enter your access code to continue.'}
            </Text>
          </View>

          {step === 'info' ? (
            <View style={s.form}>
              {/* Name */}
              <View style={s.field}>
                <Text style={s.label}>Full Name</Text>
                <View style={s.inputWrap}>
                  <Ionicons name="person-outline" size={18} color={colors.mutedForeground} style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    placeholder="GODWIN Confidence"
                    placeholderTextColor={colors.mutedForeground}
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                </View>
              </View>

              {/* Phone */}
              <View style={s.field}>
                <Text style={s.label}>Phone Number</Text>
                <View style={s.phoneRow}>
                  <View style={[s.inputWrap, s.countryCodeWrap]}>
                    <TextInput
                      style={[s.input, s.countryCodeInput]}
                      placeholder="+234"
                      placeholderTextColor={colors.mutedForeground}
                      value={countryCode}
                      onChangeText={setCountryCode}
                      keyboardType="phone-pad"
                    />
                  </View>
                  <View style={[s.inputWrap, { flex: 1 }]}>
                    <Ionicons name="call-outline" size={18} color={colors.mutedForeground} style={s.inputIcon} />
                    <TextInput
                      style={s.input}
                      placeholder="9160547567"
                      placeholderTextColor={colors.mutedForeground}
                      value={phone}
                      onChangeText={setPhone}
                      keyboardType="phone-pad"
                      returnKeyType="done"
                    />
                  </View>
                </View>
              </View>

              <TouchableOpacity style={s.primaryBtn} onPress={handleNext} activeOpacity={0.85}>
                <Text style={s.primaryBtnText}>Continue</Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.form}>
              <View style={s.field}>
                <Text style={s.label}>Access Code</Text>
                <View style={s.inputWrap}>
                  <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    placeholder="• • • • •"
                    placeholderTextColor={colors.mutedForeground}
                    value={code}
                    onChangeText={setCode}
                    secureTextEntry
                    autoFocus
                    keyboardType="number-pad"
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[s.primaryBtn, createUser.isPending && s.primaryBtnDisabled]}
                onPress={handleSubmit}
                activeOpacity={0.85}
                disabled={createUser.isPending}
              >
                {createUser.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={s.primaryBtnText}>Sign In</Text>
                    <Ionicons name="arrow-forward" size={20} color="#fff" />
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={s.backBtn}
                onPress={() => { setStep('info'); setCode(''); }}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={18} color={colors.mutedForeground} />
                <Text style={s.backBtnText}>Back</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Trust badges */}
          <View style={s.badges}>
            {[
              { icon: 'lock-closed', label: 'Bank-grade consent tracking' },
              { icon: 'globe-outline', label: 'International phone registration' },
              { icon: 'checkmark-circle-outline', label: 'Granular permission controls' },
            ].map((b) => (
              <View key={b.label} style={s.badge}>
                <Ionicons name={b.icon as any} size={16} color={colors.primary} />
                <Text style={s.badgeText}>{b.label}</Text>
              </View>
            ))}
          </View>

          <Text style={s.terms}>
            By continuing, you agree to our terms of service and privacy policy.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>, isDark: boolean) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: 24,
      paddingBottom: 48,
    },
    logoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 24,
      marginBottom: 40,
    },
    logoIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(54,88,202,0.15)' : 'rgba(54,88,202,0.1)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoText: {
      fontSize: 22,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      letterSpacing: -0.5,
    },
    hero: {
      marginBottom: 32,
    },
    heroTitle: {
      fontSize: 32,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      letterSpacing: -1,
      marginBottom: 8,
    },
    heroSub: {
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      lineHeight: 22,
    },
    form: {
      gap: 20,
      marginBottom: 40,
    },
    field: {
      gap: 8,
    },
    label: {
      fontSize: 13,
      fontFamily: 'Inter_600SemiBold',
      color: colors.foreground,
      letterSpacing: 0.1,
    },
    inputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? colors.card : colors.secondary,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      height: 52,
    },
    inputIcon: {
      marginRight: 10,
    },
    input: {
      flex: 1,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      color: colors.foreground,
    },
    phoneRow: {
      flexDirection: 'row',
      gap: 10,
    },
    countryCodeWrap: {
      width: 90,
      flex: 0,
    },
    countryCodeInput: {
      textAlign: 'center',
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: 14,
      height: 54,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
      elevation: 6,
    },
    primaryBtnDisabled: {
      opacity: 0.7,
    },
    primaryBtnText: {
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
      color: '#fff',
    },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      height: 44,
    },
    backBtnText: {
      fontSize: 14,
      fontFamily: 'Inter_500Medium',
      color: colors.mutedForeground,
    },
    badges: {
      gap: 14,
      marginBottom: 32,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    badgeText: {
      fontSize: 14,
      fontFamily: 'Inter_500Medium',
      color: colors.foreground,
    },
    terms: {
      fontSize: 11,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
      lineHeight: 16,
    },
  });
}
