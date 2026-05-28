import { useState, useEffect, useCallback } from 'react';
import { Language } from '../lib/i18n';
import { fetchSettings, updateSettingsApi } from '@/lib/api';

export interface UserSettings {
  lang: Language;
  fontSize: 'small' | 'medium' | 'large';
  nickname: string;
  soundsEnabled: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  lang: 'en',
  fontSize: 'medium',
  nickname: 'User',
  soundsEnabled: true,
};

export function useSettings(accessToken?: string) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!accessToken) {
      setSettings(DEFAULT_SETTINGS);
      setLoaded(false);
      return;
    }

    setLoaded(false);
    fetchSettings(accessToken)
      .then((serverSettings) => {
        if (!cancelled) setSettings({ ...DEFAULT_SETTINGS, ...serverSettings });
      })
      .catch((e) => {
        console.error('Failed to fetch settings', e);
        if (!cancelled) setSettings(DEFAULT_SETTINGS);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const updateSettings = useCallback((updates: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      if (accessToken) {
        updateSettingsApi(accessToken, updates).catch((e) => {
          console.error('Failed to save settings', e);
        });
      }
      return next;
    });
  }, [accessToken]);

  return { settings, updateSettings, loaded };
}
