/**
 * Model download + load progress screen.
 * Shown in place of the chat UI until the model is ready.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  isModelDownloaded,
  downloadModel,
  loadModel,
  deleteModel,
  type ModelInfo,
  type ModelStatus,
} from '@/lib/ai/model-manager';

function bytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

interface Props {
  onReady: (model: ModelInfo) => void;
}

export default function ModelLoader({ onReady }: Props) {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? colors.dark : colors.light;
  const insets = useSafeAreaInsets();

  const [selectedId, setSelectedId] = useState(DEFAULT_MODEL_ID);
  const [status, setStatus] = useState<ModelStatus>('not_downloaded');
  const [progress, setProgress] = useState(0);
  const [bytesWritten, setBytesWritten] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const selectedModel = AVAILABLE_MODELS.find((m) => m.id === selectedId)!;

  const handleStart = useCallback(async () => {
    const model = AVAILABLE_MODELS.find((m) => m.id === selectedId)!;
    abortRef.current = new AbortController();

    try {
      const exists = await isModelDownloaded(model);
      if (!exists) {
        // ── Download ──
        setStatus('downloading');
        setProgress(0);
        setStatusMsg('Downloading model…');
        await downloadModel(
          model,
          (pct, written) => { setProgress(pct); setBytesWritten(written); },
          abortRef.current.signal,
        );
      }

      if (abortRef.current.signal.aborted) return;

      // ── Load ──
      setStatus('loading');
      setStatusMsg('Loading model into memory…');
      await loadModel(model, setStatusMsg);

      setStatus('ready');
      onReady(model);
    } catch (err: any) {
      if (abortRef.current?.signal.aborted) {
        setStatus('not_downloaded');
        setStatusMsg('');
        return;
      }
      setStatus('error');
      setStatusMsg(err?.message ?? 'Unknown error');
    }
  }, [selectedId, onReady]);

  const handleCancel = () => {
    abortRef.current?.abort();
    setStatus('not_downloaded');
    setProgress(0);
    setStatusMsg('');
  };

  const handleDelete = (model: ModelInfo) => {
    Alert.alert(
      'Delete model',
      `Remove "${model.displayName}" to free space?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteModel(model);
            setStatus('not_downloaded');
          },
        },
      ],
    );
  };

  const isActive = status === 'downloading' || status === 'loading' || status === 'verifying';

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top + 16 }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.foreground }]}>🤖 Offline AI</Text>
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
          All inference runs 100% on-device.{'\n'}No data ever leaves your phone.
        </Text>
      </View>

      {/* Model picker */}
      <ScrollView contentContainerStyle={styles.models} showsVerticalScrollIndicator={false}>
        {AVAILABLE_MODELS.map((model) => {
          const isSelected = model.id === selectedId;
          return (
            <TouchableOpacity
              key={model.id}
              onPress={() => !isActive && setSelectedId(model.id)}
              style={[
                styles.modelCard,
                {
                  backgroundColor: isSelected ? `${c.primary}15` : c.card,
                  borderColor: isSelected ? c.primary : c.border,
                },
              ]}
            >
              <View style={styles.modelCardRow}>
                <View style={[styles.radioOuter, { borderColor: isSelected ? c.primary : c.border }]}>
                  {isSelected && <View style={[styles.radioInner, { backgroundColor: c.primary }]} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modelName, { color: c.foreground }]}>{model.displayName}</Text>
                  <Text style={[styles.modelMeta, { color: c.mutedForeground }]}>
                    Context: {model.nCtx} tokens
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDelete(model)}
                  style={styles.deleteBtn}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={{ color: c.destructive, fontSize: 12 }}>✕</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Progress / status */}
        {(isActive || status === 'error') && (
          <View style={[styles.progressBox, { backgroundColor: c.card, borderColor: c.border }]}>
            {status === 'downloading' && (
              <>
                <View style={[styles.progressTrack, { backgroundColor: c.muted }]}>
                  <View style={[styles.progressFill, { backgroundColor: c.primary, width: `${(progress * 100).toFixed(0)}%` }]} />
                </View>
                <Text style={[styles.progressText, { color: c.mutedForeground }]}>
                  {(progress * 100).toFixed(1)}%  ·  {bytes(bytesWritten)} / {bytes(selectedModel.sizeBytes)}
                </Text>
              </>
            )}
            {status === 'loading' && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={c.primary} />
                <Text style={[styles.progressText, { color: c.mutedForeground, marginLeft: 8 }]}>
                  {statusMsg}
                </Text>
              </View>
            )}
            {status === 'error' && (
              <Text style={[styles.errorText, { color: c.destructive }]}>
                ⚠ {statusMsg}
              </Text>
            )}
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.btnRow}>
          {isActive ? (
            <TouchableOpacity style={[styles.btn, styles.cancelBtn, { borderColor: c.border }]} onPress={handleCancel}>
              <Text style={[styles.btnText, { color: c.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.btn, styles.primaryBtn, { backgroundColor: c.primary }]}
              onPress={handleStart}
            >
              <Text style={[styles.btnText, { color: '#fff' }]}>
                {status === 'error' ? 'Retry' : '⬇ Download & Load'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Privacy notice */}
        <View style={[styles.notice, { backgroundColor: `${c.accent}15`, borderColor: `${c.accent}30` }]}>
          <Text style={[styles.noticeText, { color: c.accent }]}>
            🔒 The model file is stored in your app's private storage. It is never uploaded, shared, or backed up to the cloud.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:       { flex: 1 },
  header:     { paddingHorizontal: 24, paddingBottom: 20, gap: 6 },
  title:      { fontSize: 26, fontFamily: 'Inter_700Bold' },
  subtitle:   { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  models:     { paddingHorizontal: 16, gap: 10, paddingBottom: 40 },
  modelCard:  { borderRadius: 12, borderWidth: 1.5, padding: 14 },
  modelCardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  modelName:  { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  modelMeta:  { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  deleteBtn:  { padding: 4 },
  progressBox:{ borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  progressTrack:{ height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressText: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },
  errorText:  { fontSize: 13, fontFamily: 'Inter_500Medium' },
  btnRow:     { marginTop: 4 },
  btn:        { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryBtn: {},
  cancelBtn:  { borderWidth: 1 },
  btnText:    { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  notice:     { borderRadius: 10, borderWidth: 1, padding: 12 },
  noticeText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
});
