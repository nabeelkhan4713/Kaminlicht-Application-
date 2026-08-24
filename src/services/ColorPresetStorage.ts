import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ColorPreset {
  id: string;
  name: string;
  color: { r: number; g: number; b: number };
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
