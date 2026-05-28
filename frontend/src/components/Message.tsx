'use client';

import { useState } from 'react';
import { Mascot } from './Mascot';
import { detectDir } from '@/lib/utils';
import { renderMarkdown } from '@/lib/markdown';
import { UIMessage } from '@/hooks/useChat';
import { ReasoningSummaryBlock } from './ReasoningSummary';
import { translations, Language } from '@/lib/i18n';

interface MessageProps {
  msg: UIMessage;
  onRegenerate?: () => void;
  userNickname?: string;
  lang?: Language;
}

function ThinkingBlock({ thinking, lang = 'en' }: { thinking: string; lang?: Language }) {
  const [open, setOpen] = useState(false);
  const label = lang === 'ar' ? 'عرض التفكير' : 'View thinking';
  const hideLabel = lang === 'ar' ? 'إخفاء التفكير' : 'Hide thinking';

  return (
    <div className="thinking-block">
      <button
        className="thinking-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" className="icon-stroke" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6L15 17H9l-.3-2.1C6.7 13.7 5 11.5 5 9a7 7 0 0 1 7-7z" />
          <line x1="9" y1="21" x2="15" y2="21" />
          <line x1="9.5" y1="17" x2="14.5" y2="17" />
        </svg>
        {open ? hideLabel : label}
        <svg width="11" height="11" viewBox="0 0 24 24" className={`icon-stroke reasoning-chevron${open ? ' open' : ''}`} aria-hidden="true" style={{ marginInlineStart: 'auto' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <pre className="thinking-body">{thinking.trim()}</pre>
      )}
    </div>
  );
}

export function Message({ msg, onRegenerate, userNickname = 'User', lang = 'en' }: MessageProps) {
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const isUser = msg.role === 'user';
  const dir = detectDir(msg.content);
  const t = translations[lang];

  const onCopy = () => {
    navigator.clipboard?.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const initialLetter = userNickname.trim() ? userNickname.trim().charAt(0).toUpperCase() : 'U';

  return (
    <div className={`msg ${isUser ? 'user' : 'bot'}`}>
      <div className={`avatar ${isUser ? 'user' : 'bot'}`} aria-hidden="true">
        {isUser ? initialLetter : <Mascot size={22} />}
      </div>
      <div className="msg-body">
        {isUser ? (
          <div className="bubble user" dir={dir}>{msg.content}</div>
        ) : (
          <div className={`bubble bot ${msg.streaming ? 'streaming' : ''}`} dir={dir}>
            <div className="md">{renderMarkdown(msg.content)}</div>
            {msg.streaming && <span className="cursor-blink" />}
          </div>
        )}

        {!isUser && !msg.streaming && msg.model && (
          <div className="msg-meta">
            <span>📦 {msg.model}</span>
            {msg.time != null && <><span className="dot">·</span><span>⏱ {msg.time.toFixed(2)}s</span></>}
            {msg.tokens && <><span className="dot">·</span><span>{msg.tokens} tokens</span></>}
          </div>
        )}

        {!isUser && msg.citations && msg.citations.length > 0 && (
          <div className="citations">
            <button className="citations-toggle" onClick={() => setSourcesOpen(o => !o)} aria-expanded={sourcesOpen}>
              <svg width="12" height="12" viewBox="0 0 24 24" className={`icon-stroke reasoning-chevron${sourcesOpen ? ' open' : ''}`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {t.citations} ({msg.citations.length})
            </button>
            {sourcesOpen && msg.citations.map((c, i) => (
              <div key={i} className="citation-item">
                <span className="citation-src">
                  {i + 1}. {c.fileName}{c.pageNumber ? `, page ${c.pageNumber}` : ''}
                </span>
                <span className="citation-snippet">"{c.snippet}"</span>
              </div>
            ))}
          </div>
        )}

        {!isUser && !msg.streaming && msg.thinking && (
          <ThinkingBlock thinking={msg.thinking} lang={lang} />
        )}

        {!isUser && !msg.streaming && msg.reasoningSummary && (
          <ReasoningSummaryBlock summary={msg.reasoningSummary} />
        )}

        {!msg.streaming && (
          <div className="msg-actions">
            <button className="msg-action-btn" onClick={onCopy} aria-label="Copy message">
              {copied
                ? <svg width="14" height="14" viewBox="0 0 24 24" className="icon-stroke" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" className="icon-stroke" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              }
            </button>
            {!isUser && onRegenerate && (
              <button className="msg-action-btn" onClick={onRegenerate} aria-label="Regenerate response">
                <svg width="14" height="14" viewBox="0 0 24 24" className="icon-stroke" aria-hidden="true">
                  <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function StreamingMessage({ content, onStop, lang = 'en', isThinking = false }: { content: string; onStop: () => void; lang?: Language; isThinking?: boolean }) {
  const dir = detectDir(content);
  const t = translations[lang];
  return (
    <div>
      {isThinking && !content ? (
        <div className="msg bot">
          <div className="avatar bot" aria-hidden="true"><Mascot size={22} /></div>
          <div className="msg-body">
            <div className="bubble bot thinking-bubble">
              <svg width="14" height="14" viewBox="0 0 24 24" className="icon-stroke thinking-pulse" aria-hidden="true">
                <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6L15 17H9l-.3-2.1C6.7 13.7 5 11.5 5 9a7 7 0 0 1 7-7z" />
                <line x1="9" y1="21" x2="15" y2="21" />
                <line x1="9.5" y1="17" x2="14.5" y2="17" />
              </svg>
              <span className="thinking-label">{lang === 'ar' ? 'يفكّر...' : 'Thinking…'}</span>
            </div>
          </div>
        </div>
      ) : content ? (
        <div className="msg bot">
          <div className="avatar bot" aria-hidden="true"><Mascot size={22} /></div>
          <div className="msg-body">
            <div className="bubble bot streaming" dir={dir}>
              <div className="md">{renderMarkdown(content)}</div>
              <span className="cursor-blink" />
            </div>
          </div>
        </div>
      ) : (
        <div className="msg bot">
          <div className="avatar bot" aria-hidden="true"><Mascot size={22} /></div>
          <div className="msg-body">
            <div className="bubble bot typing-bubble">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        </div>
      )}
      <div style={{ marginInlineStart: 48, marginTop: -12 }}>
        <button className="stop-gen-btn" onClick={onStop}>
          <svg width="12" height="12" viewBox="0 0 24 24" className="icon-stroke" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          {t.stopGenerating}
        </button>
      </div>
    </div>
  );
}
