import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ColorPreset {
  id: string;
  name: string;
  color: { r: number; g: number; b: number };
  // Optional scene fields (older presets only have a colour; these stay undefined there).
  brightness?: number; // 0-100
  intensity?: number; // flame intensity 1-6
  track?: number; // audio track index (0-based); undefined = don't change the sound
}

const KEY_PREFIX = 'glowfire.colorPresets.';

const buildKey = (serialNumber: string) => `${KEY_PREFIX}${serialNumber}`;

export const ColorPresetStorage = {
  async load(serialNumber: string): Promise<ColorPreset[]> {
    try {
      const raw = await AsyncStorage.getItem(buildKey(serialNumber));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ColorPreset[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async save(serialNumber: string, presets: ColorPreset[]): Promise<void> {
    await AsyncStorage.setItem(buildKey(serialNumber), JSON.stringify(presets));
  },
};
