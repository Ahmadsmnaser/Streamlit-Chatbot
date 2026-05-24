'use client';

import { useState } from 'react';
import { Mascot } from './Mascot';
import { detectDir } from '@/lib/utils';
import { renderMarkdown } from '@/lib/markdown';
import { UIMessage } from '@/hooks/useChat';
import { ReasoningSummaryBlock } from './ReasoningSummary';

interface MessageProps {
  msg: UIMessage;
  onRegenerate?: () => void;
}

export function Message({ msg, onRegenerate }: MessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === 'user';
  const dir = detectDir(msg.content);

  const onCopy = () => {
    navigator.clipboard?.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className={`msg ${isUser ? 'user' : 'bot'}`}>
      <div className={`avatar ${isUser ? 'user' : 'bot'}`} aria-hidden="true">
        {isUser ? 'A' : <Mascot size={22} />}
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
            <div className="citations-label">Sources</div>
            {msg.citations.map((c, i) => (
              <div key={i} className="citation-item">
                <span className="citation-src">
                  {i + 1}. {c.fileName}{c.pageNumber ? `, page ${c.pageNumber}` : ''}
                </span>
                <span className="citation-snippet">"{c.snippet}"</span>
              </div>
            ))}
          </div>
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

export function StreamingMessage({ content, onStop }: { content: string; onStop: () => void }) {
  const dir = detectDir(content);
  return (
    <div>
      {content ? (
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
          Stop generating
        </button>
      </div>
    </div>
  );
}
