import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
  useColorScheme,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons as _Ionicons } from '@expo/vector-icons';
const Ionicons = _Ionicons as any;
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useGetUser, useListInvites } from '@workspace/api-client-react';

function StatusDot({ status }: { status: string }) {
  const colors = useColors();
  const color =
    status === 'accepted'
      ? colors.success
      : status === 'declined'
      ? colors.destructive
      : colors.warning;
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function InviteCard({ invite, colors, isDark }: { invite: any; colors: any; isDark: boolean }) {
  const date = new Date(invite.sentAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const statusLabel =
    invite.status === 'accepted'
      ? 'Granted'
      : invite.status === 'declined'
      ? 'Declined'
      : 'Pending';

  const statusColor =
    invite.status === 'accepted'
      ? colors.success
      : invite.status === 'declined'
      ? colors.destructive
      : colors.warning;

  return (
    <View style={[cardStyles.card, { backgroundColor: isDark ? colors.card : '#fff', borderColor: colors.border }]}>
      <View style={[cardStyles.avatar, { backgroundColor: isDark ? colors.muted : colors.secondary }]}>
        <Text style={[cardStyles.avatarText, { color: colors.primary }]}>
          {(invite.toName || invite.toPhone)?.[0]?.toUpperCase() ?? '?'}
        </Text>
      </View>
      <View style={cardStyles.info}>
        <Text style={[cardStyles.name, { color: colors.foreground }]} numberOfLines={1}>
          {invite.toName || invite.toPhone}
        </Text>
        <Text style={[cardStyles.phone, { color: colors.mutedForeground }]} numberOfLines={1}>
          {invite.toPhone}
        </Text>
      </View>
      <View style={cardStyles.right}>
        <View style={[cardStyles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
          <StatusDot status={invite.status} />
          <Text style={[cardStyles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        <Text style={[cardStyles.date, { color: colors.mutedForeground }]}>{date}</Text>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { data: user } = useGetUser(
    userId!,
    { query: { enabled: !!userId, retry: 1 } } as any,
  );

  const {
    data: invites,
    isLoading,
    refetch,
    isRefetching,
  } = useListInvites(
    { userId: userId! },
    { query: { enabled: !!userId } } as any,
  );

  const accepted = invites?.filter((i: any) => i.status === 'accepted') ?? [];
  const pending = invites?.filter((i: any) => i.status === 'pending') ?? [];

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 60;

  const s = makeStyles(colors, isDark);

  return (
    <View style={[s.root]}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: topPad + 16, paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Welcome back,</Text>
            <Text style={s.userName} numberOfLines={1}>
              {user?.name ?? 'Loading...'}
            </Text>
          </View>
          <View style={[s.shieldBadge, { backgroundColor: isDark ? colors.card : '#fff', borderColor: colors.border }]}>
            <Ionicons name="shield-checkmark" size={22} color={colors.primary} />
          </View>
        </View>

        {/* Stats row */}
        <View style={s.statsRow}>
          <View style={[s.statCard, { backgroundColor: isDark ? colors.card : '#fff', borderColor: colors.border }]}>
            <Text style={[s.statNum, { color: colors.primary }]}>{invites?.length ?? 0}</Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>Total Invites</Text>
          </View>
          <View style={[s.statCard, { backgroundColor: isDark ? colors.card : '#fff', borderColor: colors.border }]}>
            <Text style={[s.statNum, { color: colors.success }]}>{accepted.length}</Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>Granted</Text>
          </View>
          <View style={[s.statCard, { backgroundColor: isDark ? colors.card : '#fff', borderColor: colors.border }]}>
            <Text style={[s.statNum, { color: colors.warning }]}>{pending.length}</Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>Pending</Text>
          </View>
        </View>

        {/* SOS Button */}
        <TouchableOpacity
          style={s.sosBtn}
          activeOpacity={0.85}
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            Alert.alert('SOS Alert', 'SOS functionality uses push notifications. Ensure notifications are set up on the web app first.');
          }}
        >
          <Ionicons name="warning" size={22} color="#fff" />
          <Text style={s.sosBtnText}>SOS Alert</Text>
        </TouchableOpacity>

        {/* Quick action */}
        <TouchableOpacity
          style={[s.actionCard, { backgroundColor: isDark ? colors.card : '#fff', borderColor: colors.border }]}
          activeOpacity={0.8}
          onPress={() => router.push('/(tabs)/invites')}
        >
          <View style={[s.actionIcon, { backgroundColor: `${colors.primary}18` }]}>
            <Ionicons name="person-add-outline" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.actionTitle, { color: colors.foreground }]}>Invite Contact</Text>
            <Text style={[s.actionSub, { color: colors.mutedForeground }]}>Send a WhatsApp consent invite</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>

        {/* Recent activity */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Recent Activity</Text>

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : !invites || invites.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="mail-outline" size={40} color={colors.mutedForeground} />
              <Text style={s.emptyText}>No invites yet</Text>
              <Text style={s.emptySub}>Invite contacts to start sharing locations</Text>
            </View>
          ) : (
            invites.slice(0, 5).map((invite: any) => (
              <InviteCard key={invite.id} invite={invite} colors={colors} isDark={isDark} />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ dot: { width: 6, height: 6, borderRadius: 3 } });

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  phone: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  right: { alignItems: 'flex-end', gap: 4 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
  },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  date: { fontSize: 11, fontFamily: 'Inter_400Regular' },
});

function makeStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingHorizontal: 20 },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 24,
    },
    greeting: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    userName: {
      fontSize: 26,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      letterSpacing: -0.5,
      maxWidth: 240,
    },
    shieldBadge: {
      width: 44,
      height: 44,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statsRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 16,
    },
    statCard: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1,
      padding: 14,
      alignItems: 'center',
      gap: 4,
    },
    statNum: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
    statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
    sosBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: '#c0392b',
      borderRadius: 14,
      height: 52,
      marginBottom: 16,
      shadowColor: '#c0392b',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 10,
      elevation: 5,
    },
    sosBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.5 },
    actionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      borderRadius: 12,
      borderWidth: 1,
      padding: 16,
      marginBottom: 28,
    },
    actionIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
    actionSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
    section: { gap: 0 },
    sectionTitle: {
      fontSize: 16,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      marginBottom: 14,
    },
    empty: {
      alignItems: 'center',
      paddingVertical: 40,
      gap: 8,
    },
    emptyText: {
      fontSize: 16,
      fontFamily: 'Inter_600SemiBold',
      color: colors.foreground,
    },
    emptySub: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
    },
  });
}
