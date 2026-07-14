import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_BASE_URL } from '../constants/api';

interface SettingsState {
  baseUrl: string;
  apiKey: string;
  depthUnit: 'm' | 'ft';
  setBaseUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  setDepthUnit: (unit: 'm' | 'ft') => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: '',
      depthUnit: 'm',
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setApiKey: (apiKey) => set({ apiKey }),
      setDepthUnit: (depthUnit) => set({ depthUnit }),
    }),
    {
      name: 'apneaos-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
