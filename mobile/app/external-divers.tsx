/**
 * External Divers — manage other freedivers' labeled dive data for ML training.
 *
 * Divers can have dives imported from FIT files (fit/buddies/{slug}/) or entered
 * manually. All labeled dives feed the training-data export.
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Modal, Pressable, Alert, ActivityIndicator, Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { Colors } from '../src/constants/colors';
import { fmtSeconds } from '../src/utils/formatters';
import {
  useGuestDivers, useCreateGuestDiver, useDeleteGuestDiver,
  useAddGuestDive, useGuestDives, useLabelGuestDive,
  type GuestDiver, type GuestDive, type Discipline, type TimeSeries,
} from '../src/api/dives';

const DISCIPLINES: { value: Discipline; label: string; color: string }[] = [
  { value: 'CWT',    label: 'CWT',    color: Colors.cyan },
  { value: 'FIM',    label: 'FIM',    color: Colors.orange },
  { value: 'CNF',    label: 'CNF',    color: '#9b7fff' },
  { value: 'WARMUP', label: 'WARMUP', color: Colors.outline },
  { value: 'STA',    label: 'STA',    color: '#7fff9b' },
];

const DISC_COLOR: Record<string, string> = {
  CWT: Colors.cyan,
  FIM: Colors.orange,
  CNF: '#9b7fff',
  WARMUP: Colors.outline,
  STA: '#7fff9b',
};

// ── Mini depth chart ──────────────────────────────────────────────────────────

const MINI_W = 80;
const MINI_H = 36;

function MiniDepthChart({ profile }: { profile: TimeSeries }) {
  const path = useMemo(() => {
    if (profile.length < 2) return null;
    const maxT = profile[profile.length - 1][0];
    const maxD = Math.max(...profile.map((p) => p[1]));
    if (maxD === 0 || maxT === 0) return null;

    const skPath = Skia.Path.Make();
    profile.forEach(([t, d], i) => {
      const x = (t / maxT) * MINI_W;
      const y = (d / maxD) * MINI_H;
      if (i === 0) skPath.moveTo(x, y);
      else skPath.lineTo(x, y);
    });
    return skPath;
  }, [profile]);

  if (!path) return <View style={{ width: MINI_W, height: MINI_H }} />;

  return (
    <Canvas style={{ width: MINI_W, height: MINI_H }}>
      <Path path={path} color={Colors.cyan} style="stroke" strokeWidth={1.5} />
    </Canvas>
  );
}

// ── Discipline picker modal ───────────────────────────────────────────────────

function DisciplinePicker({
  visible, current, onSelect, onClose,
}: {
  visible: boolean;
  current: Discipline | null;
  onSelect: (d: Discipline | null) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={picker.backdrop} onPress={onClose}>
        <Pressable style={picker.sheet} onPress={() => {}}>
          <Text style={picker.title}>SET DISCIPLINE</Text>
          {DISCIPLINES.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[picker.option, current === opt.value && { backgroundColor: opt.color + '20' }]}
              onPress={() => { onSelect(opt.value); onClose(); }}
            >
              <View style={[picker.dot, { backgroundColor: opt.color }]} />
              <Text style={[picker.optLabel, { color: current === opt.value ? opt.color : Colors.onSurface }]}>
                {opt.label}
              </Text>
              {current === opt.value && <MaterialIcons name="check" size={16} color={opt.color} />}
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={picker.option}
            onPress={() => { onSelect(null); onClose(); }}
          >
            <View style={[picker.dot, { backgroundColor: Colors.outline }]} />
            <Text style={[picker.optLabel, { color: Colors.outline }]}>Clear label</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Single dive row in diver detail ──────────────────────────────────────────

function DiveItem({ dive, diverId }: { dive: GuestDive; diverId: string }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const labelMutation = useLabelGuestDive(diverId);

  const discColor = dive.discipline ? DISC_COLOR[dive.discipline] ?? Colors.outline : null;
  const sessionLabel = dive.session_file
    ? dive.session_file.replace(/\.zip$/i, '').replace(/_/g, ' ')
    : null;

  return (
    <>
      <View style={diveItem.wrap}>
        {/* Mini chart */}
        <View style={diveItem.chartBox}>
          {dive.depth_profile && dive.depth_profile.length >= 2
            ? <MiniDepthChart profile={dive.depth_profile as TimeSeries} />
            : <View style={diveItem.noChart}><MaterialIcons name="show-chart" size={14} color={Colors.outline} /></View>
          }
        </View>

        {/* Stats */}
        <View style={{ flex: 1, marginLeft: 10 }}>
          {sessionLabel && (
            <Text style={diveItem.session} numberOfLines={1}>{sessionLabel}</Text>
          )}
          <View style={diveItem.statsRow}>
            <Text style={diveItem.depth}>{dive.max_depth_m.toFixed(1)}m</Text>
            {dive.bottom_time_s != null && (
              <Text style={diveItem.stat}>{fmtSeconds(Math.round(dive.bottom_time_s))}</Text>
            )}
            {dive.dive_number != null && (
              <Text style={diveItem.num}>#{dive.dive_number}</Text>
            )}
          </View>
        </View>

        {/* Discipline badge */}
        <TouchableOpacity
          style={[diveItem.badge, discColor ? { borderColor: discColor + '80' } : diveItem.unlabeled]}
          onPress={() => setPickerOpen(true)}
        >
          {dive.discipline
            ? <Text style={[diveItem.badgeText, { color: discColor! }]}>{dive.discipline}</Text>
            : <Text style={diveItem.unlabeledText}>Label</Text>
          }
        </TouchableOpacity>
      </View>

      <DisciplinePicker
        visible={pickerOpen}
        current={dive.discipline}
        onSelect={(d) => labelMutation.mutate({ diveId: dive.id, discipline: d })}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

// ── Diver detail modal ────────────────────────────────────────────────────────

function DiverDetailModal({ diver, onClose }: { diver: GuestDiver; onClose: () => void }) {
  const { data: dives, isLoading } = useGuestDives(diver.id);
  const [addDiveOpen, setAddDiveOpen] = useState(false);

  const labeled = useMemo(() => dives?.filter((d) => d.discipline !== null).length ?? 0, [dives]);
  const unlabeled = useMemo(() => dives?.filter((d) => d.discipline === null).length ?? 0, [dives]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#0d0d1a' }}>
        {/* Header */}
        <View style={detail.header}>
          <TouchableOpacity onPress={onClose}>
            <MaterialIcons name="arrow-back" size={20} color={Colors.cyan} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={detail.name}>{diver.display_name}</Text>
            {!isLoading && dives && (
              <Text style={detail.sub}>
                {labeled} labeled · {unlabeled} unlabeled
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={detail.addBtn}
            onPress={() => setAddDiveOpen(true)}
          >
            <MaterialIcons name="add" size={16} color={Colors.cyan} />
            <Text style={detail.addText}>Manual</Text>
          </TouchableOpacity>
        </View>

        {isLoading && (
          <ActivityIndicator color={Colors.cyan} style={{ marginTop: 40 }} />
        )}

        {!isLoading && (!dives || dives.length === 0) && (
          <View style={detail.empty}>
            <MaterialIcons name="water" size={36} color={Colors.outline} />
            <Text style={detail.emptyTitle}>No dives yet</Text>
            <Text style={detail.emptySub}>
              Drop FIT zips in fit/buddies/{diver.id}/ and run:{'\n'}
              python -m src.sync.import_buddy_fits --diver {diver.id}
            </Text>
            <TouchableOpacity style={detail.manualBtn} onPress={() => setAddDiveOpen(true)}>
              <Text style={detail.manualBtnText}>Add Manually</Text>
            </TouchableOpacity>
          </View>
        )}

        {dives && dives.length > 0 && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {unlabeled > 0 && (
              <View style={detail.unlabeledBanner}>
                <MaterialIcons name="label-outline" size={14} color={Colors.orange} />
                <Text style={detail.unlabeledBannerText}>
                  {unlabeled} dive{unlabeled !== 1 ? 's' : ''} need labeling — tap "Label" to set discipline
                </Text>
              </View>
            )}
            {dives.map((d) => <DiveItem key={d.id} dive={d} diverId={diver.id} />)}
          </ScrollView>
        )}

        {addDiveOpen && (
          <AddDiveModal diver={diver} onClose={() => setAddDiveOpen(false)} />
        )}
      </View>
    </Modal>
  );
}

// ── Add Diver Modal ────────────────────────────────────────────────────────────

function AddDiverModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const create = useCreateGuestDiver();

  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync({ id: slugify(trimmed), display_name: trimmed, notes: notes.trim() || undefined });
      setName(''); setNotes('');
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to create diver');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={modal.backdrop} onPress={onClose}>
        <Pressable style={modal.sheet} onPress={() => {}}>
          <Text style={modal.title}>ADD DIVER</Text>

          <Text style={modal.label}>Name</Text>
          <TextInput
            style={modal.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Alice Smith"
            placeholderTextColor={Colors.outline}
            autoFocus
          />

          <Text style={modal.label}>Notes (optional)</Text>
          <TextInput
            style={modal.input}
            value={notes}
            onChangeText={setNotes}
            placeholder="Pool diver, depth specialist…"
            placeholderTextColor={Colors.outline}
          />

          <TouchableOpacity
            style={[modal.btn, (!name.trim() || create.isPending) && modal.btnDisabled]}
            onPress={submit}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={modal.btnText}>Add Diver</Text>
            }
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Add Dive Modal (manual entry) ─────────────────────────────────────────────

function AddDiveModal({ diver, onClose }: { diver: GuestDiver; onClose: () => void }) {
  const [discipline, setDiscipline] = useState<Discipline>('CWT');
  const [depth, setDepth] = useState('');
  const [bottomTime, setBottomTime] = useState('');
  const [descentTime, setDescentTime] = useState('');
  const [ascentTime, setAscentTime] = useState('');
  const [notes, setNotes] = useState('');
  const addDive = useAddGuestDive(diver.id);

  const submit = async () => {
    const d = parseFloat(depth);
    if (isNaN(d) || d <= 0) { Alert.alert('Depth required', 'Enter a valid depth in metres'); return; }
    try {
      await addDive.mutateAsync({
        discipline,
        max_depth_m: d,
        bottom_time_s: bottomTime ? parseFloat(bottomTime) : undefined,
        descent_time_s: descentTime ? parseFloat(descentTime) : undefined,
        ascent_time_s: ascentTime ? parseFloat(ascentTime) : undefined,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Failed to add dive');
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#0d0d1a' }} onPress={Keyboard.dismiss}>
        <View style={addDiveS.header}>
          <TouchableOpacity onPress={onClose}>
            <MaterialIcons name="close" size={22} color={Colors.cyan} />
          </TouchableOpacity>
          <Text style={addDiveS.title}>MANUAL DIVE — {diver.display_name.toUpperCase()}</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView contentContainerStyle={addDiveS.body} keyboardShouldPersistTaps="handled">
          <Text style={addDiveS.label}>Discipline</Text>
          <View style={addDiveS.discRow}>
            {DISCIPLINES.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[addDiveS.discChip, discipline === opt.value && { borderColor: opt.color, backgroundColor: opt.color + '20' }]}
                onPress={() => setDiscipline(opt.value)}
              >
                <Text style={[addDiveS.discText, { color: discipline === opt.value ? opt.color : Colors.outline }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={addDiveS.label}>Max Depth (m) *</Text>
          <TextInput
            style={addDiveS.input}
            value={depth}
            onChangeText={setDepth}
            keyboardType="decimal-pad"
            placeholder="e.g. 28.5"
            placeholderTextColor={Colors.outline}
          />

          <View style={addDiveS.row}>
            <View style={{ flex: 1 }}>
              <Text style={addDiveS.label}>Bottom Time (s)</Text>
              <TextInput style={addDiveS.input} value={bottomTime} onChangeText={setBottomTime}
                keyboardType="decimal-pad" placeholder="e.g. 75" placeholderTextColor={Colors.outline} />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={addDiveS.label}>Descent (s)</Text>
              <TextInput style={addDiveS.input} value={descentTime} onChangeText={setDescentTime}
                keyboardType="decimal-pad" placeholder="e.g. 30" placeholderTextColor={Colors.outline} />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={addDiveS.label}>Ascent (s)</Text>
              <TextInput style={addDiveS.input} value={ascentTime} onChangeText={setAscentTime}
                keyboardType="decimal-pad" placeholder="e.g. 45" placeholderTextColor={Colors.outline} />
            </View>
          </View>

          <Text style={addDiveS.label}>Notes</Text>
          <TextInput
            style={[addDiveS.input, { height: 64, textAlignVertical: 'top' }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any context…"
            placeholderTextColor={Colors.outline}
            multiline
          />

          <TouchableOpacity
            style={[addDiveS.btn, addDive.isPending && addDiveS.btnDisabled]}
            onPress={submit}
            disabled={addDive.isPending}
          >
            {addDive.isPending
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={addDiveS.btnText}>Save Dive</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </Pressable>
    </Modal>
  );
}

// ── Diver row ─────────────────────────────────────────────────────────────────

function DiverRow({ diver }: { diver: GuestDiver }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const deleteDiver = useDeleteGuestDiver();

  const confirmDelete = () => {
    Alert.alert(
      'Remove Diver',
      `Delete ${diver.display_name} and all their ${diver.dive_count} dives?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteDiver.mutate(diver.id) },
      ],
    );
  };

  return (
    <>
      <TouchableOpacity style={row.wrap} onPress={() => setDetailOpen(true)} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <Text style={row.name}>{diver.display_name}</Text>
          <Text style={row.sub}>
            {diver.dive_count} dive{diver.dive_count !== 1 ? 's' : ''}
            {diver.notes ? `  ·  ${diver.notes}` : ''}
          </Text>
        </View>
        <MaterialIcons name="chevron-right" size={18} color={Colors.outline} />
        <TouchableOpacity onPress={confirmDelete} style={{ marginLeft: 4, padding: 4 }}>
          <MaterialIcons name="delete-outline" size={18} color={Colors.outline} />
        </TouchableOpacity>
      </TouchableOpacity>

      {detailOpen && (
        <DiverDetailModal diver={diver} onClose={() => setDetailOpen(false)} />
      )}
    </>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ExternalDiversScreen() {
  const router = useRouter();
  const { data: divers, isLoading } = useGuestDivers();
  const [addDiverOpen, setAddDiverOpen] = useState(false);

  return (
    <View style={s.root}>
      <View style={s.appBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.cyan} />
        </TouchableOpacity>
        <Text style={s.appBarTitle}>EXTERNAL DIVERS</Text>
        <TouchableOpacity onPress={() => setAddDiverOpen(true)}>
          <MaterialIcons name="person-add" size={20} color={Colors.cyan} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        <View style={s.infoBanner}>
          <MaterialIcons name="science" size={16} color={Colors.cyan} />
          <Text style={s.infoText}>
            Import buddy FIT files → label discipline → export training data.{'\n'}
            Drop zips in <Text style={s.code}>fit/buddies/{'<slug>'}/</Text> then run the import script.
          </Text>
        </View>

        {isLoading && <ActivityIndicator color={Colors.cyan} style={{ marginTop: 40 }} />}

        {!isLoading && (!divers || divers.length === 0) && (
          <View style={s.empty}>
            <MaterialIcons name="group" size={36} color={Colors.outline} />
            <Text style={s.emptyTitle}>No divers yet</Text>
            <Text style={s.emptyBody}>
              Add a diver, then import their FIT files or log dives manually.
            </Text>
            <TouchableOpacity style={s.addFirstBtn} onPress={() => setAddDiverOpen(true)}>
              <Text style={s.addFirstText}>Add First Diver</Text>
            </TouchableOpacity>
          </View>
        )}

        {divers && divers.length > 0 && (
          <>
            <Text style={s.sectionTitle}>{divers.length} DIVER{divers.length !== 1 ? 'S' : ''}</Text>
            {divers.map((d) => <DiverRow key={d.id} diver={d} />)}
          </>
        )}

        {divers && divers.length > 0 && (
          <View style={s.exportHint}>
            <MaterialIcons name="download" size={14} color={Colors.outline} />
            <Text style={s.exportHintText}>
              GET /training-data/export — download all labeled dives as JSON
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <AddDiverModal visible={addDiverOpen} onClose={() => setAddDiverOpen(false)} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0d1a' },
  appBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backBtn: { padding: 4 },
  appBarTitle: { color: Colors.onSurface, fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  body: { padding: 16 },
  infoBanner: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: 'rgba(0,212,255,0.06)',
    borderRadius: 10, padding: 12, marginBottom: 20,
    borderWidth: 1, borderColor: 'rgba(0,212,255,0.15)',
  },
  infoText: { flex: 1, color: Colors.onSurfaceVariant, fontSize: 12, lineHeight: 18 },
  code: { fontFamily: 'monospace', color: Colors.cyan, fontSize: 11 },
  sectionTitle: {
    color: Colors.outline, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 8,
  },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTitle: { color: Colors.onSurface, fontSize: 16, fontWeight: '700', marginTop: 12 },
  emptyBody: { color: Colors.outline, fontSize: 13, textAlign: 'center', marginTop: 6, maxWidth: 260 },
  addFirstBtn: {
    marginTop: 20, backgroundColor: Colors.cyan, paddingHorizontal: 24,
    paddingVertical: 12, borderRadius: 10,
  },
  addFirstText: { color: '#000', fontWeight: '700', fontSize: 14 },
  exportHint: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    marginTop: 24, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)',
  },
  exportHintText: { color: Colors.outline, fontSize: 11, flex: 1 },
});

const row = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12,
    padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  name: { color: Colors.onSurface, fontSize: 14, fontWeight: '600' },
  sub: { color: Colors.outline, fontSize: 11, marginTop: 2 },
});

const detail = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  name: { color: Colors.onSurface, fontSize: 15, fontWeight: '700' },
  sub: { color: Colors.outline, fontSize: 11, marginTop: 2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.cyan + '50',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  addText: { color: Colors.cyan, fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyTitle: { color: Colors.onSurface, fontSize: 15, fontWeight: '700', marginTop: 12 },
  emptySub: {
    color: Colors.outline, fontSize: 11, textAlign: 'center', marginTop: 8,
    lineHeight: 18, fontFamily: 'monospace',
  },
  manualBtn: {
    marginTop: 20, backgroundColor: 'rgba(0,212,255,0.12)',
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.cyan + '40',
  },
  manualBtnText: { color: Colors.cyan, fontWeight: '600', fontSize: 13 },
  unlabeledBanner: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: 'rgba(255,140,0,0.08)',
    borderRadius: 8, padding: 10, marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(255,140,0,0.2)',
  },
  unlabeledBannerText: { flex: 1, color: Colors.orange, fontSize: 12 },
});

const diveItem = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10,
    padding: 10, marginBottom: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  chartBox: {
    width: MINI_W, height: MINI_H,
    backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 6,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  noChart: { alignItems: 'center', justifyContent: 'center', width: MINI_W, height: MINI_H },
  session: { color: Colors.outline, fontSize: 9, letterSpacing: 0.5, marginBottom: 2 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  depth: { color: Colors.onSurface, fontSize: 15, fontWeight: '700' },
  stat: { color: Colors.onSurfaceVariant, fontSize: 12 },
  num: { color: Colors.outline, fontSize: 11 },
  badge: {
    borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  unlabeled: { borderColor: Colors.outline + '40', borderStyle: 'dashed' },
  unlabeledText: { color: Colors.outline, fontSize: 11 },
});

const picker = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40,
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  title: { color: Colors.outline, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 12 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  optLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
});

const modal = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  title: { color: Colors.onSurface, fontSize: 12, fontWeight: '700', letterSpacing: 2, marginBottom: 20 },
  label: { color: Colors.outline, fontSize: 11, fontWeight: '600', letterSpacing: 1, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    color: Colors.onSurface, fontSize: 14, padding: 12,
  },
  btn: {
    backgroundColor: Colors.cyan, borderRadius: 10, padding: 14,
    alignItems: 'center', marginTop: 24,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#000', fontWeight: '700', fontSize: 14 },
});

const addDiveS = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  title: { color: Colors.onSurface, fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  body: { padding: 16 },
  label: { color: Colors.outline, fontSize: 11, fontWeight: '600', letterSpacing: 1, marginBottom: 6, marginTop: 14 },
  discRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  discChip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  discText: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    color: Colors.onSurface, fontSize: 14, padding: 12,
  },
  btn: {
    backgroundColor: Colors.cyan, borderRadius: 10, padding: 14,
    alignItems: 'center', marginTop: 28,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#000', fontWeight: '700', fontSize: 14 },
});
