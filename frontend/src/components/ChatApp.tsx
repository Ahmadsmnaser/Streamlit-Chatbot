'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Message, StreamingMessage } from './Message';
import { EmptyState } from './EmptyState';
import { InputDock } from './InputDock';
import { useChat, AnswerMode } from '@/hooks/useChat';
import { useChatSessions } from '@/hooks/useChatSessions';
import { useRag } from '@/hooks/useRag';
import { MessageNavDots } from './MessageNavDots';

type ThemeMode = 'light' | 'dark' | 'system';

const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const DEFAULT_TEMP = 0.5;
const DEFAULT_SYSTEM = 'You are a helpful assistant.';

export function ChatApp() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [temperature, setTemperature] = useState(DEFAULT_TEMP);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM);
  const [input, setInput] = useState('');
  const [chatTitle, setChatTitle] = useState('New Chat');
  const [mode, setMode] = useState<AnswerMode>('simple');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    sessions, activeSessionId, refresh: refreshSessions,
    createNewSession, loadSession, removeSession, renameSession,
  } = useChatSessions();

  const { files: uploadedFiles, upload: uploadFile, clear: clearRagFiles } = useRag(activeSessionId);

  const {
    messages, isStreaming, streamingContent,
    sendMessage, cancelStream, regenerate,
    loadMessages, clearMessages,
  } = useChat({
    model, temperature, systemPrompt,
    sessionId: activeSessionId,
    mode,
    onSessionUpdate: refreshSessions,
  });

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
    const session = await createNewSession();
    setChatTitle(session.title);
    clearMessages();
  }, [createNewSession, clearMessages]);

  const handleDeleteSession = useCallback(async (id: string) => {
    await removeSession(id);
    if (id === activeSessionId) {
      clearMessages();
      setChatTitle('New Chat');
    }
  }, [removeSession, activeSessionId, clearMessages]);

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

    // Auto-create session if none active
    if (!activeSessionId) {
      createNewSession(text.slice(0, 60)).then((session) => {
        setChatTitle(session.title);
        sendMessage(text);
      });
    } else {
      sendMessage(text);
    }
  }, [input, isStreaming, activeSessionId, createNewSession, sendMessage]);

  const handleSuggest = useCallback((text: string) => {
    setInput(text);
  }, []);

  const showEmpty = messages.length === 0 && !isStreaming;

  return (
    <div
      className="app"
      data-collapsed={collapsed}
      data-mobile-open={mobileOpen}
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
        onModelChange={setModel}
        temperature={temperature}
        onTempChange={setTemperature}
        systemPrompt={systemPrompt}
        onSysPromptChange={setSystemPrompt}
        onMobileClose={() => setMobileOpen(false)}
      />

      <main className="main">
        <Topbar
          title={chatTitle}
          onTitleChange={handleTitleChange}
          themeMode={themeMode}
          onThemeModeChange={setThemeMode}
          onMobileMenu={() => setMobileOpen(true)}
          onDelete={activeSessionId ? () => handleDeleteSession(activeSessionId) : undefined}
        />

        <div className="messages-wrap">
          {showEmpty ? (
            <EmptyState onSuggest={handleSuggest} />
          ) : (
            <>
              <MessageNavDots messages={messages} isStreaming={isStreaming} />
              <div className="messages">
              {messages.map((m) => (
                <div key={m.id} id={`msg-${m.id}`}>
                  <Message msg={m} onRegenerate={m.role === 'assistant' ? regenerate : undefined} />
                </div>
              ))}
              {isStreaming && (
                <StreamingMessage content={streamingContent} onStop={cancelStream} />
              )}
              <div ref={messagesEndRef} />
              </div>
            </>
          )}
        </div>

        {uploadedFiles.length > 0 && (
          <div className="file-chips">
            {uploadedFiles.map((f) => (
              <div key={f.fileName} className={`file-chip status-${f.status}`}>
                <span className="file-chip-name">{f.fileName}</span>
                <span className="file-chip-status">
                  {f.status === 'uploading' ? 'Uploading…'
                    : f.status === 'processing' ? 'Processing…'
                    : f.status === 'ready' ? `${f.chunks} chunks`
                    : 'Failed'}
                </span>
              </div>
            ))}
            <button className="file-chips-clear" onClick={clearRagFiles} title="Clear uploaded files">×</button>
          </div>
        )}

        <InputDock
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={isStreaming}
          mode={mode}
          onModeChange={setMode}
          onFileSelect={uploadFile}
        />
      </main>
    </div>
  );
}
