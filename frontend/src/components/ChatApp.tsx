'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Message, StreamingMessage } from './Message';
import { EmptyState } from './EmptyState';
import { InputDock } from './InputDock';
import { useChat, AnswerMode } from '@/hooks/useChat';
import { useChatSessions } from '@/hooks/useChatSessions';
import { useRag } from '@/hooks/useRag';
import { MessageNavDots } from './MessageNavDots';
import { useSettings } from '@/hooks/useSettings';
import { translations } from '@/lib/i18n';
import { SettingsModal } from './SettingsModal';
import { SignInPage } from './SignInPage';
import { Mascot } from './Mascot';
import { fetchSession, fetchModes, ModeConfig } from '@/lib/api';

type ThemeMode = 'light' | 'dark' | 'system';

const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const DEFAULT_TEMP = 0.5;
const DEFAULT_SYSTEM = 'You are a helpful assistant.';

export function ChatApp() {
  const { data: session, status } = useSession();
  const accessToken = session?.accessToken;

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [temperature, setTemperature] = useState(DEFAULT_TEMP);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM);
  const [input, setInput] = useState('');
  const [chatTitle, setChatTitle] = useState('New Chat');
  const [mode, setMode] = useState<AnswerMode>('simple');
  const [modeConfigs, setModeConfigs] = useState<Record<string, ModeConfig>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { settings, updateSettings, loaded: settingsLoaded } = useSettings(accessToken);
  const t = translations[settings.lang];

  // Synth bubble sound generator using Web Audio API
  const playSynthSound = useCallback((type: 'send' | 'recv') => {
    if (!settings.soundsEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();

      if (type === 'send') {
        // Soft cute synth bubble pop for sending messages
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        const now = ctx.currentTime;
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.12);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        osc.start(now);
        osc.stop(now + 0.12);
      } else {
        // Double pitch pop for receiving messages
        const now = ctx.currentTime;

        // Tone 1
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(320, now);
        osc1.frequency.exponentialRampToValueAtTime(480, now + 0.08);
        gain1.gain.setValueAtTime(0.15, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc1.start(now);
        osc1.stop(now + 0.08);

        // Tone 2 (delayed, higher frequency)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(480, now + 0.07);
        osc2.frequency.exponentialRampToValueAtTime(720, now + 0.18);
        gain2.gain.setValueAtTime(0.15, now + 0.07);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc2.start(now + 0.07);
        osc2.stop(now + 0.18);
      }
    } catch (e) {
      console.error('Failed to play synth sound', e);
    }
  }, [settings.soundsEnabled]);

  const {
    sessions, activeSessionId, refresh: refreshSessions,
    createNewSession, loadSession, removeSession, renameSession,
  } = useChatSessions(accessToken);

  const { files: uploadedFiles, upload: uploadFile, remove: removeRagFile } = useRag(activeSessionId, accessToken);

  const {
    messages, isStreaming, isThinking, streamingContent,
    sendMessage, cancelStream, regenerate,
    loadMessages, clearMessages,
  } = useChat({
    accessToken,
    model, temperature, systemPrompt,
    sessionId: activeSessionId,
    mode,
    onSessionUpdate: refreshSessions,
    onStreamDone: () => playSynthSound('recv'),
  });

  // Fetch mode configs once on mount
  useEffect(() => {
    fetchModes().then(setModeConfigs).catch(console.error);
  }, []);

  // When mode changes, auto-apply that mode's model + temperature defaults
  const handleModeChange = useCallback((newMode: AnswerMode) => {
    setMode(newMode);
    const cfg = modeConfigs[newMode];
    if (cfg) {
      setModel(cfg.model);
      setTemperature(cfg.temperature);
    }
  }, [modeConfigs]);

  // Apply theme
  useEffect(() => {
    let resolved = themeMode;
    if (themeMode === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', resolved);
    // Persist
    localStorage.setItem('theme', themeMode);
  }, [themeMode]);

  // Restore theme from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('theme') as ThemeMode | null;
    if (saved) setThemeMode(saved);
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingContent]);

  const handleSelectSession = useCallback(async (id: string) => {
    const session = await loadSession(id);
    if (session) {
      setChatTitle(session.title);
      if (session.messages && session.messages.length > 0) {
        loadMessages(session.messages);
      } else {
        clearMessages();
      }
    }
  }, [loadSession, loadMessages, clearMessages]);

  const handleNewChat = useCallback(async () => {
    const session = await createNewSession(t.newChat);
    setChatTitle(session.title);
    clearMessages();
  }, [createNewSession, clearMessages, t]);

  const handleDeleteSession = useCallback(async (id: string) => {
    await removeSession(id);
    if (id === activeSessionId) {
      clearMessages();
      setChatTitle(t.newChat);
    }
  }, [removeSession, activeSessionId, clearMessages, t]);

  const handleTitleChange = useCallback(async (title: string) => {
    setChatTitle(title);
    if (activeSessionId) {
      await renameSession(activeSessionId, title);
    }
  }, [activeSessionId, renameSession]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    const text = input;
    setInput('');
    playSynthSound('send');

    // Auto-create session if none active
    if (!activeSessionId) {
      createNewSession(text.slice(0, 60)).then((session) => {
        setChatTitle(session.title);
        sendMessage(text, session.id);
      });
    } else {
      sendMessage(text);
    }
  }, [input, isStreaming, activeSessionId, createNewSession, sendMessage, playSynthSound]);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!activeSessionId) {
      // No session yet — create one first, then pass its ID directly to upload
      const session = await createNewSession(t.newChat);
      setChatTitle(session.title);
      uploadFile(file, session.id);
    } else {
      uploadFile(file);
    }
  }, [activeSessionId, createNewSession, uploadFile, t]);

  const handleSuggest = useCallback((text: string) => {
    setInput(text);
  }, []);

  const handleClearAll = useCallback(async () => {
    if (!window.confirm(t.clearConfirm)) return;
    try {
      await Promise.all(sessions.map((s) => removeSession(s.id)));
      clearMessages();
      setChatTitle(t.newChat);
      setSettingsOpen(false);
    } catch (e) {
      console.error('Failed to clear sessions', e);
    }
  }, [sessions, removeSession, clearMessages, t]);

  const handleExportData = useCallback(async () => {
    try {
      const fullSessions = await Promise.all(
        sessions.map(async (s) => {
          try {
            if (!accessToken) return s;
            return await fetchSession(accessToken, s.id);
          } catch {
            return s;
          }
        })
      );

      const blob = new Blob([JSON.stringify(fullSessions, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chatbot_history_export_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export sessions', e);
    }
  }, [accessToken, sessions]);

  const showEmpty = messages.length === 0 && !isStreaming;

  if (status === 'loading' || (status === 'authenticated' && !settingsLoaded)) {
    return (
      <main className="signin-page">
        <section className="signin-panel compact">
          <Mascot size={44} />
          <div className="signin-copy">
            <h1>Ahmad's Chatbot</h1>
            <p>Loading your workspace...</p>
          </div>
        </section>
      </main>
    );
  }

  if (status !== 'authenticated' || !accessToken) {
    return <SignInPage />;
  }

  return (
    <div
      className="app"
      data-collapsed={collapsed}
      data-mobile-open={mobileOpen}
      data-font-size={settings.fontSize}
      dir={settings.lang === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="bg-blobs" aria-hidden="true">
        <div className="bg-blob b1" />
        <div className="bg-blob b2" />
        <div className="bg-blob b3" />
      </div>

      <div className="mobile-scrim" onClick={() => setMobileOpen(false)} />

      <Sidebar
        collapsed={collapsed}
        onCollapseToggle={() => setCollapsed((c) => !c)}
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={handleSelectSession}
        onDelete={handleDeleteSession}
        onNewChat={handleNewChat}
        model={model}
        temperature={temperature}
        onSettingsOpen={() => setSettingsOpen(true)}
        lang={settings.lang}
        onMobileClose={() => setMobileOpen(false)}
      />

      <main className="main">
        <Topbar
          title={chatTitle === 'New Chat' ? t.newChat : chatTitle}
          onTitleChange={handleTitleChange}
          themeMode={themeMode}
          onThemeModeChange={setThemeMode}
          onMobileMenu={() => setMobileOpen(true)}
          onDelete={activeSessionId ? () => handleDeleteSession(activeSessionId) : undefined}
          onSettingsOpen={() => setSettingsOpen(true)}
          lang={settings.lang}
          user={session.user}
          onSignOut={() => signOut()}
          nickname={settings.nickname}
          onNicknameChange={(v) => updateSettings({ nickname: v })}
        />

        <MessageNavDots messages={messages} />

        <div className="messages-wrap">
          {showEmpty ? (
            <EmptyState onSuggest={handleSuggest} lang={settings.lang} />
          ) : (
            <>
              <div className="messages">
                {messages.map((m) => (
                  <div key={m.id} id={`msg-${m.id}`}>
                    <Message
                      msg={m}
                      onRegenerate={m.role === 'assistant' ? regenerate : undefined}
                      userNickname={settings.nickname}
                      lang={settings.lang}
                    />
                  </div>
                ))}
                {isStreaming && (
                  <StreamingMessage
                    content={streamingContent}
                    onStop={cancelStream}
                    lang={settings.lang}
                    isThinking={isThinking}
                  />
                )}
                <div ref={messagesEndRef} />
              </div>
            </>
          )}
        </div>

        <InputDock
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={isStreaming}
          mode={mode}
          onModeChange={handleModeChange}
          modeConfigs={modeConfigs}
          onFileSelect={handleFileSelect}
          uploadedFiles={uploadedFiles}
          onRemoveFile={removeRagFile}
          hasMessages={messages.length > 0}
          lang={settings.lang}
        />
      </main>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={updateSettings}
        themeMode={themeMode}
        onThemeChange={setThemeMode}
        model={model}
        onModelChange={setModel}
        temperature={temperature}
        onTempChange={setTemperature}
        systemPrompt={systemPrompt}
        onSysPromptChange={setSystemPrompt}
        onClearAll={handleClearAll}
        onExport={handleExportData}
      />
    </div>
  );
}
