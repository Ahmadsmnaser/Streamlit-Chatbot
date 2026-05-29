'use client';

import { useCallback, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { askAhmadPublic, AskAhmadMode } from '@/lib/api';
import { renderMarkdown } from '@/lib/markdown';
import { Mascot, MascotLarge } from './Mascot';

const SUGGESTED_QUESTIONS: { icon: string; text: string; question: string; mode: AskAhmadMode }[] = [
  { icon: '👤', text: 'Who is Ahmad Naser?',           question: 'Who is Ahmad Naser?',                              mode: 'portfolio' },
  { icon: '🚀', text: "Strongest projects",            question: "What are Ahmad's strongest projects?",             mode: 'portfolio' },
  { icon: '⚙️', text: 'Fit for backend roles?',        question: 'Is Ahmad a good fit for backend roles?',           mode: 'recruiter' },
  { icon: '🔧', text: 'Fit for systems/low-level?',    question: 'Is Ahmad a good fit for systems or low-level roles?', mode: 'recruiter' },
  { icon: '💡', text: "Explain best projects",         question: "Explain Ahmad's best projects in detail.",         mode: 'portfolio' },
  { icon: '📋', text: 'Match to job description',      question: 'Compare Ahmad to this job description.',           mode: 'job_match' },
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function AskAhmadPanel() {
  const [messages, setMessages]         = useState<Message[]>([]);
  const [input, setInput]               = useState('');
  const [mode, setMode]                 = useState<AskAhmadMode>('portfolio');
  const [jobDescription, setJobDesc]    = useState('');
  const [streaming, setStreaming]       = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const abortRef                        = useRef<AbortController | null>(null);
  const bottomRef                       = useRef<HTMLDivElement>(null);

  const scrollToBottom = () =>
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

  const send = useCallback(
    (question: string) => {
      if (!question.trim() || streaming) return;
      setError(null);

      const userMsg: Message = { role: 'user', content: question.trim() };
      const assistantIdx     = messages.length + 1;

      setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '' }]);
      setInput('');
      setStreaming(true);
      scrollToBottom();

      const controller = new AbortController();
      abortRef.current = controller;

      askAhmadPublic(
        {
          question: question.trim(),
          mode,
          job_description: mode === 'job_match' && jobDescription.trim() ? jobDescription.trim() : undefined,
        },
        controller.signal,
        (token) => {
          setMessages((prev) => {
            const updated = [...prev];
            if (updated[assistantIdx]) {
              updated[assistantIdx] = { ...updated[assistantIdx], content: updated[assistantIdx].content + token };
            }
            return updated;
          });
        },
        (metadata) => {
          setStreaming(false);
          scrollToBottom();
        },
        (err) => {
          setStreaming(false);
          setError(err);
        },
      );
    },
    [streaming, messages.length, mode, jobDescription],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <main className="ask-panel">
      {/* Animated background blobs */}
      <div className="bg-blobs" aria-hidden="true">
        <div className="bg-blob b1" />
        <div className="bg-blob b2" />
        <div className="bg-blob b3" />
      </div>

      {/* Scrollable content */}
      <div className="ask-panel-scroll">
        {!hasMessages ? (
          /* ── Empty / initial state ── */
          <div className="ask-empty">
            <div className="empty-mascot">
              <MascotLarge isTyping={false} isStreaming={false} />
            </div>

            <h1 className="empty-headline">Ask Ahmad&apos;s Bot</h1>
            <p className="empty-sub">
              Ask anything about Ahmad Naser&apos;s background, projects, and skills.<br />
              Answers are grounded in verified profile data only.
            </p>

            {/* Mode selector */}
            <div className="ask-mode-pills">
              {(['portfolio', 'recruiter', 'job_match'] as AskAhmadMode[]).map((m) => (
                <button
                  key={m}
                  className={`ask-mode-pill${mode === m ? ' active' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m === 'portfolio' ? '🗂️ Portfolio' : m === 'recruiter' ? '🤝 Recruiter' : '📋 Job Match'}
                </button>
              ))}
            </div>

            {/* Suggest grid */}
            <div className="suggest-grid">
              {SUGGESTED_QUESTIONS.map((sq, i) => (
                <button
                  key={i}
                  className="suggest-card"
                  disabled={streaming}
                  onClick={() => { setMode(sq.mode); send(sq.question); }}
                >
                  <span className="suggest-icon">{sq.icon}</span>
                  <span className="suggest-text">{sq.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── Messages thread ── */
          <div className="ask-messages">
            {/* Mode pills compact row above thread */}
            <div className="ask-mode-pills" style={{ marginBottom: 8 }}>
              {(['portfolio', 'recruiter', 'job_match'] as AskAhmadMode[]).map((m) => (
                <button
                  key={m}
                  className={`ask-mode-pill${mode === m ? ' active' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m === 'portfolio' ? '🗂️ Portfolio' : m === 'recruiter' ? '🤝 Recruiter' : '📋 Job Match'}
                </button>
              ))}
            </div>

            {messages.map((msg, i) => (
              <div key={i} className={`msg${msg.role === 'user' ? ' user' : ''}`}>
                {/* Avatar */}
                {msg.role === 'assistant' ? (
                  <div className="avatar bot">
                    <Mascot size={22} />
                  </div>
                ) : (
                  <div className="avatar user" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </div>
                )}

                <div className="msg-body">
                  {msg.role === 'assistant' ? (
                    <div className={`bubble bot${streaming && i === messages.length - 1 ? ' streaming' : ''}`}>
                      <div className="md">
                        {msg.content ? renderMarkdown(msg.content) : (
                          <span className="typing-bubble">
                            <span className="dot" /><span className="dot" /><span className="dot" />
                          </span>
                        )}
                      </div>

                    </div>
                  ) : (
                    <div className="bubble user">{msg.content}</div>
                  )}
                </div>
              </div>
            ))}

            {error && (
              <p style={{ textAlign: 'center', color: '#d95757', fontSize: 13 }}>{error}</p>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      <div className="ask-input-area">
        <div className="ask-input-inner">
          {/* Job description (job_match mode only) */}
          {mode === 'job_match' && (
            <textarea
              className="ask-jd-textarea"
              rows={3}
              placeholder="Paste a job description here to match Ahmad against it…"
              value={jobDescription}
              onChange={(e) => setJobDesc(e.target.value)}
            />
          )}

          <form onSubmit={handleSubmit}>
            <div className="input-shell">
              <textarea
                className="input-textarea"
                placeholder="Ask something about Ahmad…"
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={streaming}
              />
              {streaming ? (
                <button type="button" onClick={handleStop} className="stop-gen-btn" style={{ flexShrink: 0, marginBottom: 2 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className={`send-btn${input.trim() ? ' active' : ''}`}
                  disabled={!input.trim()}
                  aria-label="Ask"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* ── Sign-in footer ── */}
      <div className="ask-footer">
        Want private chats and file uploads?{' '}
        <button className="ask-footer-link" onClick={() => signIn('google')}>
          Sign in with Google
        </button>
      </div>
    </main>
  );
}
