'use client';

import { MascotLarge } from './Mascot';
import { Language, translations } from '@/lib/i18n';

const SUGGESTIONS = {
  en: [
    { icon: '💡', text: 'Explain quantum computing simply' },
    { icon: '✉️', text: 'Help me write a professional email' },
    { icon: '🧠', text: "What's the difference between AI and ML?" },
    { icon: '🚀', text: 'Give me 3 business ideas for students' },
  ],
  ar: [
    { icon: '💡', text: 'اشرح لي الحوسبة الكمية بتبسيط' },
    { icon: '✉️', text: 'ساعدني في كتابة بريد إلكتروني رسمي' },
    { icon: '🧠', text: 'ما الفرق بين الذكاء الاصطناعي وتعلم الآلة؟' },
    { icon: '🚀', text: 'أعطني ٣ أفكار مشاريع للطلاب' },
  ]
};

interface EmptyStateProps {
  onSuggest: (text: string) => void;
  lang?: Language;
}

export function EmptyState({ onSuggest, lang = 'en' }: EmptyStateProps) {
  const t = translations[lang];
  const list = SUGGESTIONS[lang] || SUGGESTIONS.en;

  const headline = lang === 'ar' ? 'مرحباً، كيف يُمكنني مساعدتك؟' : 'Hi, how can I help you today?';
  const subline = lang === 'ar' ? 'اختر أحد الاقتراحات أو اكتب سؤالك في الأسفل.' : 'Pick a starter or just type below.';

  return (
    <div className="empty-state" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="empty-mascot">
        <MascotLarge />
      </div>
      <h1 className="empty-headline">{headline}</h1>
      <div className="empty-sub">{subline}</div>

      <div className="suggest-grid">
        {list.map((s, i) => (
          <button
            key={i}
            className="suggest-card"
            onClick={() => onSuggest(s.text)}
          >
            <span className="suggest-icon">{s.icon}</span>
            <span className="suggest-text">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
