'use client';

import { useEffect, useState, useRef } from 'react';
import { UIMessage } from '@/hooks/useChat';

interface Props {
  messages: UIMessage[];
  isStreaming: boolean;
}

export function MessageNavDots({ messages, isStreaming }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current?.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const id = visible[0].target.id.replace('msg-', '');
          setActiveId(id);
        }
      },
      { threshold: 0.5 }
    );

    messages.forEach((m) => {
      const el = document.getElementById(`msg-${m.id}`);
      if (el) observer.observe(el);
    });

    observerRef.current = observer;
    return () => observer.disconnect();
  }, [messages]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('msg-highlight');
    setTimeout(() => el.classList.remove('msg-highlight'), 1000);
  };

  const allDots = [
    ...messages,
    ...(isStreaming ? [{ id: 'streaming', role: 'assistant' as const, content: '' }] : []),
  ];

  if (allDots.length < 2) return null;

  return (
    <div className="nav-dots" aria-label="Message navigation" role="navigation">
      {allDots.map((m) => (
        <button
          key={m.id}
          className={`nav-dot role-${m.role}${activeId === m.id ? ' active' : ''}`}
          onClick={() => scrollTo(m.id)}
          aria-label={`Go to ${m.role} message`}
          title={m.role === 'user' ? 'User message' : 'Assistant message'}
        />
      ))}
    </div>
  );
}
