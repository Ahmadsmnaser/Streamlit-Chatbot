'use client';

import { useEffect, useRef, useState } from 'react';
import { detectDir } from '@/lib/utils';
import { Language } from '@/lib/i18n';
import { ModeSelector } from './ModeSelector';
import { AnswerMode } from '@/hooks/useChat';
import { UploadedFile } from '@/hooks/useRag';

interface InputDockProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  mode: AnswerMode;
  onModeChange: (m: AnswerMode) => void;
  onFileSelect?: (file: File) => void;
  uploadedFiles?: UploadedFile[];
  onRemoveFile?: (fileName: string) => void;
  hasMessages?: boolean;
  lang: Language;
}

export function InputDock({ value, onChange, onSend, disabled, mode, onModeChange, onFileSelect, uploadedFiles, onRemoveFile, hasMessages, lang }: InputDockProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dir = detectDir(value);
  const [phToggle, setPhToggle] = useState(false);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 144) + 'px';
  }, [value]);

  useEffect(() => {
    const t = setInterval(() => setPhToggle((p) => !p), 4200);
    return () => clearInterval(t);
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSend();
    }
  };

  const hasText = value.trim().length > 0;

  return (
    <div className="input-dock">
      <div style={{ width: '100%', maxWidth: 768, position: 'relative' }}>
        {uploadedFiles && uploadedFiles.length > 0 && (
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
                <button
                  className="file-chip-remove"
                  onClick={() => onRemoveFile?.(f.fileName)}
                  title="Remove file"
                  aria-label={`Remove ${f.fileName}`}
                >×</button>
              </div>
            ))}
          </div>
        )}
        {!hasMessages && <ModeSelector value={mode} onChange={onModeChange} lang={lang} />}
        <div className="input-shell">
          <input
            type="file"
            ref={fileInputRef}
            accept=".pdf,.txt,.md"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) onFileSelect?.(e.target.files[0]); e.target.value = ''; }}
          />
          <button
            type="button"
            className="upload-btn"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload file"
          >
            <svg className="icon-clip icon-stroke" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <svg className="icon-plus icon-stroke" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <textarea
            ref={taRef}
            className="input-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKey}
            placeholder={phToggle ? 'اسألني أي شي...' : 'Ask me anything...'}
            dir={dir}
            rows={1}
            aria-label="Message input"
          />
          <button
            className={`send-btn ${hasText && !disabled ? 'active' : ''}`}
            onClick={() => hasText && !disabled && onSend()}
            disabled={!hasText || disabled}
            aria-label="Send message"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" className="icon-stroke" aria-hidden="true">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
        <div className="input-hint">
          <kbd>⏎</kbd> to send · <kbd>Shift</kbd>+<kbd>⏎</kbd> for new line
        </div>
      </div>
    </div>
  );
}
