import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@table_history_v1';
const MAX_RECORDS = 50;

export interface ContractionData {
  firstAtS: number | null;  // seconds into hold when first contraction occurred
  count: number;            // total contraction count for this hold
}

export interface TableSessionRecord {
  id: number;
  date: string;           // ISO string
  protocolName: string;
  protocolKey: string;
  protocolColor: string;
  holdsCompleted: number;
  totalSets: number;
  totalHoldTimeS: number;
  sessionTimeS: number;
  contractions?: ContractionData[];  // per-hold contraction tracking
}

export async function saveTableSession(record: Omit<TableSessionRecord, 'id'>): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const existing: TableSessionRecord[] = raw ? JSON.parse(raw) : [];
    const next: TableSessionRecord = { ...record, id: Date.now() };
    const trimmed = [next, ...existing].slice(0, MAX_RECORDS);
    await AsyncStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // non-fatal
  }
}

export async function loadTableHistory(): Promise<TableSessionRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
