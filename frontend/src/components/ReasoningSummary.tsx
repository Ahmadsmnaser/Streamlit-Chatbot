'use client';

import { useState } from 'react';
import { ReasoningSummary } from '@/hooks/useChat';

const MODE_LABELS: Record<string, string> = {
  simple: 'Simple',
  deep: 'Deep',
  exam: 'Exam',
  code: 'Code',
  interview: 'Interview',
};

const BASIS_LABELS: Record<string, string> = {
  uploaded_files: 'Uploaded documents',
  general_knowledge: 'General model knowledge',
  mixed: 'Uploaded documents + general knowledge',
};

interface Props {
  summary: ReasoningSummary;
}

export function ReasoningSummaryBlock({ summary }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="reasoning-block">
      <button
        className="reasoning-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          className={`icon-stroke reasoning-chevron ${open ? 'open' : ''}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        How this answer was prepared
      </button>

      {open && (
        <div className="reasoning-body">
          <div className="reasoning-row">
            <span className="reasoning-key">Answer mode</span>
            <span className="reasoning-val">{MODE_LABELS[summary.mode] ?? summary.mode}</span>
          </div>
          <div className="reasoning-row">
            <span className="reasoning-key">Uploaded files used</span>
            <span className="reasoning-val">{summary.usedUploadedFiles ? 'Yes' : 'No'}</span>
          </div>
          {summary.usedUploadedFiles && (
            <>
              <div className="reasoning-row">
                <span className="reasoning-key">Retrieved chunks</span>
                <span className="reasoning-val">{summary.retrievedChunks}</span>
              </div>
              {summary.usedFiles && summary.usedFiles.length > 0 && (
                <div className="reasoning-row">
                  <span className="reasoning-key">Files</span>
                  <span className="reasoning-val">{summary.usedFiles.join(', ')}</span>
                </div>
              )}
            </>
          )}
          <div className="reasoning-row">
            <span className="reasoning-key">Basis of answer</span>
            <span className="reasoning-val">{BASIS_LABELS[summary.basis] ?? summary.basis}</span>
          </div>
          <div className="reasoning-row">
            <span className="reasoning-key">Confidence</span>
            <span className={`reasoning-val confidence-${summary.confidence}`}>
              {summary.confidence.charAt(0).toUpperCase() + summary.confidence.slice(1)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
