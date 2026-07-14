import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ProtocolSet {
  hold_s: number;
  rest_s: number;
}

interface Protocol {
  key: string;
  type?: string;
  name: string;
  cycles: number;
  hold_s: number;
  rest_s: number;
  rest_end_s?: number;
  color: string;
  sets?: ProtocolSet[];
}

export interface UserSettings {
  name: string;
  depthGoalM: number | null;
}

interface AppState {
  activeProtocol: Protocol | null;
  isOffline: boolean;
  userSettings: UserSettings;
  setActiveProtocol: (p: Protocol | null) => void;
  setOffline: (offline: boolean) => void;
  setUserSettings: (s: Partial<UserSettings>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeProtocol: null,
      isOffline: false,
      userSettings: { name: 'Freediver', depthGoalM: null },
      setActiveProtocol: (activeProtocol) => set({ activeProtocol }),
      setOffline: (isOffline) => set({ isOffline }),
      setUserSettings: (s) =>
        set((state) => ({ userSettings: { ...state.userSettings, ...s } })),
    }),
    {
      name: 'apneaos-user',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist user settings — protocol is transient
      partialize: (state) => ({ userSettings: state.userSettings }),
    }
  )
);
