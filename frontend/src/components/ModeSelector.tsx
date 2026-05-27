'use client';

import { AnswerMode } from '@/hooks/useChat';
import { Language, translations } from '@/lib/i18n';

const MODES: { id: AnswerMode; icon: string }[] = [
  { id: 'simple', icon: '💡' },
  { id: 'deep', icon: '🔬' },
  { id: 'exam', icon: '📝' },
  { id: 'code', icon: '💻' },
  { id: 'interview', icon: '🎯' },
];

interface ModeSelectorProps {
  value: AnswerMode;
  onChange: (mode: AnswerMode) => void;
  lang: Language;
}

export function ModeSelector({ value, onChange, lang }: ModeSelectorProps) {
  const t = translations[lang];

  return (
    <div className="mode-selector" role="group" aria-label={t.howPrepared}>
      {MODES.map((m) => {
        const modeText = t.modes[m.id];

        return (
          <button
            key={m.id}
            className={`mode-btn ${value === m.id ? 'active' : ''}`}
            onClick={() => onChange(m.id)}
            title={modeText.desc}
            aria-pressed={value === m.id}
          >
            <span className="mode-icon" aria-hidden="true">{m.icon}</span>
            <span className="mode-label">{modeText.label}</span>
          </button>
        );
      })}
    </div>
  );
}
