'use client';

import { AnswerMode } from '@/hooks/useChat';

const MODES: { id: AnswerMode; label: string; icon: string; description: string }[] = [
  { id: 'simple',    label: 'Simple',    icon: '💡', description: 'Clear, beginner-friendly answer' },
  { id: 'deep',      label: 'Deep',      icon: '🔬', description: 'Technical, in-depth answer' },
  { id: 'exam',      label: 'Exam',      icon: '📝', description: 'Structured for studying' },
  { id: 'code',      label: 'Code',      icon: '💻', description: 'Implementation focused, code-first' },
  { id: 'interview', label: 'Interview', icon: '🎯', description: 'Job interview style answer' },
];

interface ModeSelectorProps {
  value: AnswerMode;
  onChange: (mode: AnswerMode) => void;
}

export function ModeSelector({ value, onChange }: ModeSelectorProps) {
  return (
    <div className="mode-selector" role="group" aria-label="Answer mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          className={`mode-btn ${value === m.id ? 'active' : ''}`}
          onClick={() => onChange(m.id)}
          title={m.description}
          aria-pressed={value === m.id}
        >
          <span className="mode-icon" aria-hidden="true">{m.icon}</span>
          <span className="mode-label">{m.label}</span>
        </button>
      ))}
    </div>
  );
}
