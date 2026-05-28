'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from 'next-auth';
import { detectDir } from '@/lib/utils';
import { translations, Language } from '@/lib/i18n';

type ThemeMode = 'light' | 'dark' | 'system';

interface TopbarProps {
  title: string;
  onTitleChange: (v: string) => void;
  themeMode: ThemeMode;
  onThemeModeChange: (v: ThemeMode) => void;
  onMobileMenu?: () => void;
  onDelete?: () => void;
  onSettingsOpen: () => void;
  lang: Language;
  user?: Session['user'];
  onSignOut: () => void;
}

export function Topbar({
  title,
  onTitleChange,
  themeMode,
  onThemeModeChange,
  onMobileMenu,
  onDelete,
  onSettingsOpen,
  lang,
  user,
  onSignOut,
}: TopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);
  const t = translations[lang];

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) setThemeMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <header className="topbar" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="icon-btn mobile-menu-btn"
          onClick={onMobileMenu}
          aria-label="Open menu"
          style={{ display: 'none' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" className="icon-stroke" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        
        {/* Settings button in the top left corner (shown when sidebar is collapsed/mobile) */}
        <button
          className="icon-btn topbar-settings-btn"
          onClick={onSettingsOpen}
          aria-label={t.settings}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" className="icon-stroke" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.15.67.39.91.71.24.32.39.7.42 1.09 0 .39-.13.78-.36 1.1A1.65 1.65 0 0 0 19.4 15z" />
          </svg>
        </button>

        <input
          className="chat-title-input"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          dir={detectDir(title)}
          aria-label="Chat title"
        />
      </div>

      <div className="topbar-actions">
        <div style={{ position: 'relative' }} ref={themeRef}>
          <button className="icon-btn" onClick={() => setThemeMenuOpen((o) => !o)} aria-label="Theme settings">
            <span className="theme-switch-icon">
              <svg className="sun" width="20" height="20" viewBox="0 0 24 24" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
                <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
                <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" fill="none" />
              </svg>
              <svg className="moon" width="20" height="20" viewBox="0 0 24 24" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
                <path stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </span>
          </button>
          {themeMenuOpen && (
            <div className="menu" style={{ minWidth: 220, padding: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 4px 8px' }}>
                {t.theme}
              </div>
              <div className="theme-mode-row">
                {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
                  <button
                    key={m}
                    className={`theme-mode-btn ${themeMode === m ? 'active' : ''}`}
                    onClick={() => { onThemeModeChange(m); setThemeMenuOpen(false); }}
                  >
                    {t[`theme${m.charAt(0).toUpperCase() + m.slice(1) as 'Light' | 'Dark' | 'System'}`]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>



        <button className="user-chip" onClick={onSignOut} aria-label="Sign out">
          {user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" className="user-chip-avatar" />
          ) : (
            <span className="user-chip-avatar fallback">{user?.name?.charAt(0) ?? 'U'}</span>
          )}
          <span className="user-chip-name">{user?.name ?? user?.email ?? 'User'}</span>
        </button>

        <div style={{ position: 'relative' }} ref={menuRef}>
          <button className="icon-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="More options">
            <svg width="18" height="18" viewBox="0 0 24 24" className="icon-stroke" aria-hidden="true">
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
          </button>
          {menuOpen && (
            <div className="menu">
              {onDelete && (
                <button className="menu-item" style={{ color: '#d95757' }} onClick={() => { onDelete(); setMenuOpen(false); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" className="icon-stroke" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                  {t.deleteChat}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
