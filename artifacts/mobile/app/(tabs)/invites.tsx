import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  Platform,
  useColorScheme,
  KeyboardAvoidingView,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons as _Ionicons } from '@expo/vector-icons';
const Ionicons = _Ionicons as any;
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useListInvites, useCreateInvite } from '@workspace/api-client-react';

type Invite = {
  id: number;
  fromUserId: number;
  toPhone: string;
  toName?: string | null;
  message: string;
  status: 'pending' | 'accepted' | 'declined';
  whatsappLink: string;
  token: string;
  consentPageUrl?: string | null;
  grantedAt?: string | null;
  sentAt: string;
};

function InviteItem({ invite, colors, isDark }: { invite: Invite; colors: any; isDark: boolean }) {
  const statusColor =
    invite.status === 'accepted'
      ? colors.success
      : invite.status === 'declined'
      ? colors.destructive
      : colors.warning;

  const statusLabel =
    invite.status === 'accepted' ? 'Location Granted' :
    invite.status === 'declined' ? 'Declined' : 'Pending';

  const date = new Date(invite.sentAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <View style={[iStyles.card, { backgroundColor: isDark ? colors.card : '#fff', borderColor: colors.border }]}>
      <View style={[iStyles.avatar, { backgroundColor: `${colors.primary}18` }]}>
        <Text style={[iStyles.avatarText, { color: colors.primary }]}>
          {(invite.toName || invite.toPhone)?.[0]?.toUpperCase() ?? '?'}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[iStyles.name, { color: colors.foreground }]} numberOfLines={1}>
          {invite.toName || 'Contact'}
        </Text>
        <Text style={[iStyles.phone, { color: colors.mutedForeground }]}>{invite.toPhone}</Text>
        <View style={[iStyles.statusRow, { backgroundColor: `${statusColor}15` }]}>
          <View style={[iStyles.dot, { backgroundColor: statusColor }]} />
          <Text style={[iStyles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={[iStyles.date, { color: colors.mutedForeground }]}>{date}</Text>
        {invite.grantedAt && (
          <View style={[iStyles.grantBadge, { backgroundColor: `${colors.success}18` }]}>
            <Ionicons name="location" size={11} color={colors.success} />
            <Text style={[iStyles.grantText, { color: colors.success }]}>Has location</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function InvitesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [modalVisible, setModalVisible] = useState(false);
  const [toName, setToName] = useState('');
  const [toPhone, setToPhone] = useState('');
  const [message, setMessage] = useState("Hi! I'd like to share your location. Please click the link to grant access.");
  const [consentType, setConsentType] = useState<'location' | 'notification' | 'messaging'>('location');

  const { data: invites, isLoading, refetch, isRefetching } = useListInvites(
    { userId: userId! },
    { query: { enabled: !!userId } } as any,
  );
  const createInvite = useCreateInvite();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 60;

  const handleCreate = useCallback(() => {
    if (!toPhone.trim()) {
      Alert.alert('Required', 'Please enter a phone number.');
      return;
    }
    if (!message.trim()) {
      Alert.alert('Required', 'Please enter a message.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
      : '';

    createInvite.mutate(
      {
        data: {
          fromUserId: userId!,
          toPhone: toPhone.trim(),
          toName: toName.trim() || undefined,
          message: message.trim(),
          consentType,
          baseUrl,
        },
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setModalVisible(false);
          setToName('');
          setToPhone('');
          setMessage("Hi! I'd like to share your location. Please click the link to grant access.");
          refetch();
        },
        onError: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert('Error', 'Failed to create invite. Please try again.');
        },
      }
    );
  }, [userId, toPhone, toName, message, consentType, createInvite, refetch]);

  const s = makeStyles(colors, isDark);

  const CONSENT_TYPES: Array<{ value: typeof consentType; label: string; icon: string }> = [
    { value: 'location', label: 'Location', icon: 'location-outline' },
    { value: 'notification', label: 'Notifications', icon: 'notifications-outline' },
    { value: 'messaging', label: 'Messaging', icon: 'chatbubble-outline' },
  ];

  return (
    <View style={[s.root]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: topPad + 16 }]}>
        <View>
          <Text style={s.headerTitle}>Invites</Text>
          <Text style={s.headerSub}>{invites?.length ?? 0} total</Text>
        </View>
        <TouchableOpacity
          style={[s.fabSmall, { backgroundColor: colors.primary }]}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={invites ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <InviteItem invite={item as Invite} colors={colors} isDark={isDark} />
          )}
          contentContainerStyle={[s.list, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!!(invites && invites.length > 0)}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="mail-open-outline" size={48} color={colors.mutedForeground} />
              <Text style={s.emptyTitle}>No invites yet</Text>
              <Text style={s.emptySub}>Tap the + button to invite a contact</Text>
            </View>
          }
        />
      )}

      {/* Create invite modal */}
      <Modal visible={modalVisible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={s.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ width: '100%' }}
          >
            <View style={[s.modalCard, { backgroundColor: isDark ? colors.card : '#fff' }]}>
              <View style={s.modalHandle} />
              <View style={s.modalHeader}>
                <Text style={[s.modalTitle, { color: colors.foreground }]}>New Invite</Text>
                <TouchableOpacity onPress={() => setModalVisible(false)} style={s.closeBtn}>
                  <Ionicons name="close" size={20} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={s.formGap}>
                  <View style={s.field}>
                    <Text style={[s.fieldLabel, { color: colors.foreground }]}>Name (optional)</Text>
                    <View style={[s.inputWrap, { backgroundColor: isDark ? colors.background : colors.secondary, borderColor: colors.border }]}>
                      <TextInput
                        style={[s.input, { color: colors.foreground }]}
                        placeholder="Contact name"
                        placeholderTextColor={colors.mutedForeground}
                        value={toName}
                        onChangeText={setToName}
                      />
                    </View>
                  </View>

                  <View style={s.field}>
                    <Text style={[s.fieldLabel, { color: colors.foreground }]}>Phone Number *</Text>
                    <View style={[s.inputWrap, { backgroundColor: isDark ? colors.background : colors.secondary, borderColor: colors.border }]}>
                      <Ionicons name="call-outline" size={16} color={colors.mutedForeground} style={{ marginRight: 8 }} />
                      <TextInput
                        style={[s.input, { color: colors.foreground }]}
                        placeholder="+2349160547567"
                        placeholderTextColor={colors.mutedForeground}
                        value={toPhone}
                        onChangeText={setToPhone}
                        keyboardType="phone-pad"
                      />
                    </View>
                  </View>

                  <View style={s.field}>
                    <Text style={[s.fieldLabel, { color: colors.foreground }]}>Consent Type</Text>
                    <View style={s.typeRow}>
                      {CONSENT_TYPES.map((t) => (
                        <TouchableOpacity
                          key={t.value}
                          style={[
                            s.typeChip,
                            {
                              backgroundColor: consentType === t.value ? colors.primary : isDark ? colors.background : colors.secondary,
                              borderColor: consentType === t.value ? colors.primary : colors.border,
                            },
                          ]}
                          onPress={() => {
                            setConsentType(t.value);
                            Haptics.selectionAsync();
                          }}
                          activeOpacity={0.8}
                        >
                          <Ionicons
                            name={t.icon as any}
                            size={14}
                            color={consentType === t.value ? '#fff' : colors.mutedForeground}
                          />
                          <Text
                            style={[
                              s.typeChipText,
                              { color: consentType === t.value ? '#fff' : colors.mutedForeground },
                            ]}
                          >
                            {t.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={s.field}>
                    <Text style={[s.fieldLabel, { color: colors.foreground }]}>Message</Text>
                    <View style={[s.inputWrap, s.textAreaWrap, { backgroundColor: isDark ? colors.background : colors.secondary, borderColor: colors.border }]}>
                      <TextInput
                        style={[s.input, s.textArea, { color: colors.foreground }]}
                        placeholder="Write your message..."
                        placeholderTextColor={colors.mutedForeground}
                        value={message}
                        onChangeText={setMessage}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[s.sendBtn, { backgroundColor: colors.primary }, createInvite.isPending && { opacity: 0.7 }]}
                    onPress={handleCreate}
                    disabled={createInvite.isPending}
                    activeOpacity={0.85}
                  >
                    {createInvite.isPending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="logo-whatsapp" size={20} color="#fff" />
                        <Text style={s.sendBtnText}>Send via WhatsApp</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const iStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  name: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  phone: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  date: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  grantBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 100,
  },
  grantText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
});

function makeStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      paddingHorizontal: 20,
      paddingBottom: 16,
    },
    headerTitle: {
      fontSize: 28,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      letterSpacing: -0.5,
    },
    headerSub: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      marginTop: 2,
    },
    fabSmall: {
      width: 42,
      height: 42,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    list: { paddingHorizontal: 20, paddingTop: 4 },
    empty: {
      alignItems: 'center',
      paddingTop: 80,
      gap: 10,
    },
    emptyTitle: {
      fontSize: 18,
      fontFamily: 'Inter_600SemiBold',
      color: colors.foreground,
    },
    emptySub: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    modalCard: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingBottom: 40,
      paddingTop: 12,
      maxHeight: '90%',
    },
    modalHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: 'center',
      marginBottom: 16,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
    modalTitle: {
      fontSize: 20,
      fontFamily: 'Inter_700Bold',
    },
    closeBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: isDark ? colors.muted : colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    formGap: { gap: 16 },
    field: { gap: 8 },
    fieldLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
    inputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 10,
      borderWidth: 1,
      paddingHorizontal: 12,
      height: 46,
    },
    input: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
    textAreaWrap: { height: 90, alignItems: 'flex-start', paddingTop: 10 },
    textArea: { height: 70 },
    typeRow: { flexDirection: 'row', gap: 8 },
    typeChip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      height: 38,
      borderRadius: 10,
      borderWidth: 1,
    },
    typeChipText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
    sendBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 52,
      borderRadius: 14,
      marginTop: 4,
    },
    sendBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  });
}
