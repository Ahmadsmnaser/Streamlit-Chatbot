'use client';

import { useState, useEffect } from 'react';
import { UserSettings } from '@/hooks/useSettings';
import { translations, Language } from '@/lib/i18n';
import { fetchModels, Model } from '@/lib/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettings;
  onUpdate: (u: Partial<UserSettings>) => void;
  themeMode: 'light' | 'dark' | 'system';
  onThemeChange: (v: 'light' | 'dark' | 'system') => void;
  model: string;
  onModelChange: (v: string) => void;
  temperature: number;
  onTempChange: (v: number) => void;
  systemPrompt: string;
  onSysPromptChange: (v: string) => void;
  onClearAll: () => void;
  onExport: () => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onUpdate,
  themeMode,
  onThemeChange,
  model,
  onModelChange,
  temperature,
  onTempChange,
  systemPrompt,
  onSysPromptChange,
  onClearAll,
  onExport,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'model' | 'data'>('general');
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const t = translations[settings.lang];

  useEffect(() => {
    fetchModels().then(setAvailableModels).catch(() => {});
  }, []);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-container"
        onClick={(e) => e.stopPropagation()}
        dir={settings.lang === 'ar' ? 'rtl' : 'ltr'}
      >
        <div className="modal-header">
          <h2>{t.settings}</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close settings">
            <svg width="20" height="20" viewBox="0 0 24 24" className="icon-stroke" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <aside className="modal-tabs">
            <button
              className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              {t.tabGeneral}
            </button>
            <button
              className={`tab-btn ${activeTab === 'model' ? 'active' : ''}`}
              onClick={() => setActiveTab('model')}
            >
              {t.tabModel}
            </button>
            <button
              className={`tab-btn ${activeTab === 'data' ? 'active' : ''}`}
              onClick={() => setActiveTab('data')}
            >
              {t.tabData}
            </button>
          </aside>

          <main className="modal-panel">
            {activeTab === 'general' && (
              <div className="settings-group">
                <div className="setting-field">
                  <label htmlFor="lang-select">{t.language}</label>
                  <select
                    id="lang-select"
                    className="select-input"
                    value={settings.lang}
                    onChange={(e) => onUpdate({ lang: e.target.value as Language })}
                  >
                    <option value="en">English</option>
                    <option value="ar">العربية</option>
                  </select>
                </div>

                <div className="setting-field">
                  <label htmlFor="nickname-input">{t.nickname}</label>
                  <input
                    id="nickname-input"
                    type="text"
                    className="text-input"
                    value={settings.nickname}
                    onChange={(e) => onUpdate({ nickname: e.target.value })}
                  />
                </div>

                <div className="setting-field">
                  <label htmlFor="theme-select">{t.theme}</label>
                  <select
                    id="theme-select"
                    className="select-input"
                    value={themeMode}
                    onChange={(e) => onThemeChange(e.target.value as any)}
                  >
                    <option value="light">{t.themeLight}</option>
                    <option value="dark">{t.themeDark}</option>
                    <option value="system">{t.themeSystem}</option>
                  </select>
                </div>

                <div className="setting-field">
                  <label>{t.fontSize}</label>
                  <div className="segmented-control">
                    {(['small', 'medium', 'large'] as const).map((sz) => (
                      <button
                        key={sz}
                        className={`segment-btn ${settings.fontSize === sz ? 'active' : ''}`}
                        onClick={() => onUpdate({ fontSize: sz })}
                      >
                        {t[`fontSize${sz.charAt(0).toUpperCase() + sz.slice(1) as 'Small' | 'Medium' | 'Large'}`]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-field row-layout">
                  <label htmlFor="sound-toggle">{t.soundEffects}</label>
                  <input
                    id="sound-toggle"
                    type="checkbox"
                    className="switch-input"
                    checked={settings.soundsEnabled}
                    onChange={(e) => onUpdate({ soundsEnabled: e.target.checked })}
                  />
                </div>
              </div>
            )}

            {activeTab === 'model' && (
              <div className="settings-group">
                <div className="setting-field">
                  <label>{t.model}</label>
                  <div className="model-list">
                    {availableModels.map((m) => (
                      <button
                        key={m.id}
                        className={`model-option ${model === m.id ? 'active' : ''}`}
                        onClick={() => onModelChange(m.id)}
                        type="button"
                      >
                        <span className="model-option-name">{m.name}</span>
                        <span className="model-option-desc">{m.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-field">
                  <label>{t.temperature}</label>
                  <div className="temp-slider-row">
                    <input
                      type="range"
                      className="temp-slider"
                      min="0"
                      max="2"
                      step="0.1"
                      value={temperature}
                      onChange={(e) => onTempChange(parseFloat(e.target.value))}
                      aria-label={t.temperature}
                    />
                    <span className="temp-pill">{temperature.toFixed(1)}</span>
                  </div>
                </div>

                <div className="setting-field">
                  <label htmlFor="sysprompt-input">{t.systemPrompt}</label>
                  <div className="sysprompt-wrap">
                    <textarea
                      id="sysprompt-input"
                      className="text-input sysprompt"
                      value={systemPrompt}
                      onChange={(e) => onSysPromptChange(e.target.value)}
                      maxLength={500}
                    />
                    <span className="char-count">{systemPrompt.length} / 500</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'data' && (
              <div className="settings-group danger-zone">
                <div className="setting-field">
                  <label>{t.exportData}</label>
                  <button className="action-btn secondary-btn" onClick={onExport}>
                    {t.exportData}
                  </button>
                </div>
                <div className="setting-field">
                  <label>{t.clearData}</label>
                  <button className="action-btn danger-btn" onClick={onClearAll}>
                    {t.clearData}
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
