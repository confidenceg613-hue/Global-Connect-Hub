import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  useColorScheme,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useGetUser } from '@workspace/api-client-react';
import { useLocationTracking } from '@/contexts/LocationTrackingContext';

type MenuItem = {
  icon: string;
  label: string;
  sub?: string;
  onPress: () => void;
  danger?: boolean;
  value?: string;
};

function MenuRow({ item, colors, isDark }: { item: MenuItem; colors: any; isDark: boolean }) {
  return (
    <TouchableOpacity
      style={[mStyles.row, { borderBottomColor: colors.border }]}
      onPress={item.onPress}
      activeOpacity={0.7}
    >
      <View style={[mStyles.iconWrap, { backgroundColor: item.danger ? '#ef444420' : `${colors.primary}18` }]}>
        <Ionicons
          name={item.icon as any}
          size={18}
          color={item.danger ? colors.destructive : colors.primary}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[mStyles.label, { color: item.danger ? colors.destructive : colors.foreground }]}>
          {item.label}
        </Text>
        {item.sub && <Text style={[mStyles.sub, { color: colors.mutedForeground }]}>{item.sub}</Text>}
      </View>
      {item.value ? (
        <Text style={[mStyles.value, { color: colors.mutedForeground }]}>{item.value}</Text>
      ) : (
        !item.danger && <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId, logout } = useAuth();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [tokenInput, setTokenInput] = useState('');
  const [editingToken, setEditingToken] = useState(false);

  const { data: user, isLoading } = useGetUser(
    { id: userId! },
    { enabled: !!userId }
  );

  const {
    status: trackingStatus,
    errorMessage: trackingError,
    trackingToken,
    lastLocation,
    setTrackingToken,
    startTracking,
    stopTracking,
  } = useLocationTracking();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 60;

  const handleSaveToken = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      Alert.alert('Required', 'Please paste your invite token.');
      return;
    }
    await setTrackingToken(trimmed);
    setTokenInput('');
    setEditingToken(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleClearToken = async () => {
    Alert.alert('Clear Token', 'Stop sharing your location and remove the tracking token?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          stopTracking();
          await setTrackingToken(null);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
      },
    ]);
  };

  const handleToggleTracking = async () => {
    if (trackingStatus === 'active') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      stopTracking();
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await startTracking();
    }
  };

  const trackingColor =
    trackingStatus === 'active'
      ? colors.success
      : trackingStatus === 'error'
      ? colors.destructive
      : trackingStatus === 'requesting'
      ? colors.warning
      : colors.mutedForeground;

  const trackingLabel =
    trackingStatus === 'active'
      ? 'Sharing location'
      : trackingStatus === 'requesting'
      ? 'Requesting permission…'
      : trackingStatus === 'error'
      ? 'Error'
      : 'Not sharing';

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          await logout();
          router.replace('/');
        },
      },
    ]);
  };

  const menuItems: MenuItem[] = [
    {
      icon: 'person-outline',
      label: 'Account',
      sub: 'View and edit your profile information',
      onPress: () => {},
    },
    {
      icon: 'shield-checkmark-outline',
      label: 'Privacy & Consents',
      sub: 'Manage what you share with others',
      onPress: () => {},
    },
    {
      icon: 'notifications-outline',
      label: 'Notifications',
      sub: 'Push notification preferences',
      onPress: () => {},
    },
    {
      icon: 'information-circle-outline',
      label: 'App Version',
      value: '1.0.0',
      onPress: () => {},
    },
  ];

  const dangerItems: MenuItem[] = [
    {
      icon: 'log-out-outline',
      label: 'Sign Out',
      onPress: handleLogout,
      danger: true,
    },
  ];

  const s = makeStyles(colors, isDark);

  return (
    <View style={[s.root]}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: topPad + 16, paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar + name */}
        <View style={s.avatarSection}>
          <View style={[s.avatar, { backgroundColor: `${colors.primary}22` }]}>
            {isLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[s.avatarText, { color: colors.primary }]}>
                {user?.name?.[0]?.toUpperCase() ?? '?'}
              </Text>
            )}
          </View>
          <Text style={[s.name, { color: colors.foreground }]} numberOfLines={1}>
            {user?.name ?? '—'}
          </Text>
          <View style={s.phoneRow}>
            <Ionicons name="call-outline" size={13} color={colors.mutedForeground} />
            <Text style={[s.phone, { color: colors.mutedForeground }]}>
              {user ? `${user.countryCode} ${user.phoneNumber}` : '—'}
            </Text>
          </View>

          {/* Trust badge */}
          <View style={[s.trustBadge, { backgroundColor: `${colors.primary}15`, borderColor: `${colors.primary}30` }]}>
            <Ionicons name="shield-checkmark" size={14} color={colors.primary} />
            <Text style={[s.trustText, { color: colors.primary }]}>Verified identity</Text>
          </View>
        </View>

        {/* User ID card */}
        <View style={[s.idCard, { backgroundColor: isDark ? colors.card : '#fff', borderColor: colors.border }]}>
          <Text style={[s.idLabel, { color: colors.mutedForeground }]}>User ID</Text>
          <Text style={[s.idValue, { color: colors.foreground }]}>#{userId}</Text>
        </View>

        {/* ── Location Tracking Card ── */}
        <View style={[s.trackingCard, { backgroundColor: isDark ? colors.card : '#fff', borderColor: colors.border }]}>
          {/* Header row */}
          <View style={s.trackingHeader}>
            <View style={[s.trackingDot, { backgroundColor: trackingColor }]} />
            <Text style={[s.trackingTitle, { color: colors.foreground }]}>Location Sharing</Text>
            <Text style={[s.trackingStatus, { color: trackingColor }]}>{trackingLabel}</Text>
          </View>

          {/* Last position */}
          {lastLocation && (
            <Text style={[s.trackingCoords, { color: colors.mutedForeground }]}>
              {lastLocation.coords.latitude.toFixed(5)}, {lastLocation.coords.longitude.toFixed(5)}
              {lastLocation.coords.accuracy != null
                ? `  ±${Math.round(lastLocation.coords.accuracy)}m`
                : ''}
            </Text>
          )}

          {/* Error message */}
          {trackingStatus === 'error' && trackingError && (
            <Text style={[s.trackingError, { color: colors.destructive }]}>{trackingError}</Text>
          )}

          {/* Token section */}
          {!trackingToken && !editingToken && (
            <TouchableOpacity
              style={[s.tokenSetBtn, { borderColor: colors.border }]}
              onPress={() => setEditingToken(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="key-outline" size={14} color={colors.mutedForeground} />
              <Text style={[s.tokenSetText, { color: colors.mutedForeground }]}>Set invite token to start sharing</Text>
            </TouchableOpacity>
          )}

          {editingToken && (
            <View style={s.tokenInputRow}>
              <View style={[s.tokenInputWrap, { backgroundColor: isDark ? colors.background : colors.secondary, borderColor: colors.border }]}>
                <TextInput
                  style={[s.tokenInput, { color: colors.foreground }]}
                  placeholder="Paste invite token…"
                  placeholderTextColor={colors.mutedForeground}
                  value={tokenInput}
                  onChangeText={setTokenInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <TouchableOpacity
                style={[s.tokenSaveBtn, { backgroundColor: colors.primary }]}
                onPress={handleSaveToken}
                activeOpacity={0.85}
              >
                <Text style={s.tokenSaveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          )}

          {trackingToken && (
            <View style={s.tokenRow}>
              <Ionicons name="key" size={12} color={colors.mutedForeground} />
              <Text style={[s.tokenValue, { color: colors.mutedForeground }]} numberOfLines={1}>
                {trackingToken.slice(0, 8)}…{trackingToken.slice(-6)}
              </Text>
              <TouchableOpacity onPress={handleClearToken} hitSlop={8}>
                <Ionicons name="close-circle" size={15} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          )}

          {/* Start / Stop button */}
          {trackingToken && (
            <TouchableOpacity
              style={[
                s.trackingToggleBtn,
                {
                  backgroundColor:
                    trackingStatus === 'active' ? `${colors.destructive}18` : `${colors.primary}18`,
                  borderColor:
                    trackingStatus === 'active' ? colors.destructive : colors.primary,
                },
              ]}
              onPress={handleToggleTracking}
              disabled={trackingStatus === 'requesting'}
              activeOpacity={0.8}
            >
              {trackingStatus === 'requesting' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Ionicons
                    name={trackingStatus === 'active' ? 'stop-circle-outline' : 'navigate-outline'}
                    size={16}
                    color={trackingStatus === 'active' ? colors.destructive : colors.primary}
                  />
                  <Text
                    style={[
                      s.trackingToggleText,
                      { color: trackingStatus === 'active' ? colors.destructive : colors.primary },
                    ]}
                  >
                    {trackingStatus === 'active' ? 'Stop Sharing' : 'Start Sharing'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Menu */}
        <View style={[s.section, { backgroundColor: isDark ? colors.card : '#fff', borderColor: colors.border }]}>
          {menuItems.map((item, i) => (
            <MenuRow key={item.label} item={item} colors={colors} isDark={isDark} />
          ))}
        </View>

        {/* Danger zone */}
        <View style={[s.section, { backgroundColor: isDark ? colors.card : '#fff', borderColor: colors.border }]}>
          {dangerItems.map((item) => (
            <MenuRow key={item.label} item={item} colors={colors} isDark={isDark} />
          ))}
        </View>

        <Text style={[s.footer, { color: colors.mutedForeground }]}>
          PhoneLink — Trust-first identity & consent management
        </Text>
      </ScrollView>
    </View>
  );
}

const mStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  sub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  value: { fontSize: 13, fontFamily: 'Inter_400Regular' },
});

function makeStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingHorizontal: 20 },
    avatarSection: { alignItems: 'center', marginBottom: 24, gap: 8 },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    avatarText: { fontSize: 34, fontFamily: 'Inter_700Bold' },
    name: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
    phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    phone: { fontSize: 14, fontFamily: 'Inter_400Regular' },
    trustBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 100,
      borderWidth: 1,
      marginTop: 4,
    },
    trustText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
    idCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginBottom: 16,
    },
    idLabel: { fontSize: 13, fontFamily: 'Inter_400Regular' },
    idValue: { fontSize: 15, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },
    // ── Tracking card ──
    trackingCard: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
      marginBottom: 16,
      gap: 10,
    },
    trackingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    trackingDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    trackingTitle: {
      flex: 1,
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
    },
    trackingStatus: {
      fontSize: 12,
      fontFamily: 'Inter_500Medium',
    },
    trackingCoords: {
      fontSize: 11,
      fontFamily: 'Inter_400Regular',
    },
    trackingError: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
    },
    tokenSetBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    tokenSetText: {
      fontSize: 12,
      fontFamily: 'Inter_400Regular',
    },
    tokenInputRow: {
      flexDirection: 'row',
      gap: 8,
    },
    tokenInputWrap: {
      flex: 1,
      borderRadius: 10,
      borderWidth: 1,
      paddingHorizontal: 10,
      height: 40,
      justifyContent: 'center',
    },
    tokenInput: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
    },
    tokenSaveBtn: {
      borderRadius: 10,
      paddingHorizontal: 16,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    tokenSaveBtnText: {
      fontSize: 13,
      fontFamily: 'Inter_600SemiBold',
      color: '#fff',
    },
    tokenRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    tokenValue: {
      flex: 1,
      fontSize: 11,
      fontFamily: 'Inter_400Regular',
    },
    trackingToggleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 10,
      borderWidth: 1,
      height: 40,
    },
    trackingToggleText: {
      fontSize: 13,
      fontFamily: 'Inter_600SemiBold',
    },
    // ── Other ──
    section: {
      borderRadius: 16,
      borderWidth: 1,
      overflow: 'hidden',
      marginBottom: 16,
    },
    footer: {
      fontSize: 11,
      fontFamily: 'Inter_400Regular',
      textAlign: 'center',
      marginTop: 8,
    },
  });
}
