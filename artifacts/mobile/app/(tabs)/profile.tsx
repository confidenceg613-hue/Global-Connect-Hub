import React from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useGetUser } from '@workspace/api-client-react';

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

  const { data: user, isLoading } = useGetUser(
    { id: userId! },
    { enabled: !!userId }
  );

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 60;

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
