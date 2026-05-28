'use client';

import { useState, useRef, useCallback } from 'react';
import { streamChat, updateSession, ChatMessage } from '@/lib/api';

export type AnswerMode = 'simple' | 'deep' | 'exam' | 'code' | 'interview';

export interface Citation {
  fileName: string;
  pageNumber?: number;
  chunkIndex?: number;
  snippet: string;
}

export interface ReasoningSummary {
  mode: string;
  usedUploadedFiles: boolean;
  retrievedChunks?: number;
  usedFiles?: string[];
  basis: 'uploaded_files' | 'general_knowledge' | 'mixed';
  confidence: 'high' | 'medium' | 'low';
}

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  time?: number;
  tokens?: number;
  streaming?: boolean;
  mode?: AnswerMode;
  citations?: Citation[];
  reasoningSummary?: ReasoningSummary;
  usedRag?: boolean;
}

interface UseChatOptions {
  accessToken?: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  sessionId: string | null;
  mode: AnswerMode;
  onSessionUpdate?: () => void;
  onStreamDone?: () => void;
}

export function useChat({ accessToken, model, temperature, systemPrompt, sessionId, mode, onSessionUpdate, onStreamDone }: UseChatOptions) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const streamingIdRef = useRef<string>('');

  const loadMessages = useCallback((msgs: ChatMessage[]) => {
    setMessages(
      msgs.map((m, i) => ({
        id: `loaded-${i}`,
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }))
    );
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const sendMessage = useCallback(
    (content: string, sessionIdOverride?: string) => {
      if (!content.trim() || isStreaming || !accessToken) return;

      const userMsg: UIMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content,
      };

      // Build next messages outside the updater so startStream isn't called
      // inside a state setter (React StrictMode calls updaters twice).
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      startStream(nextMessages, sessionIdOverride ?? sessionId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken, isStreaming, messages, model, temperature, systemPrompt, sessionId]
  );

  function startStream(currentMessages: UIMessage[], targetSessionId: string | null = sessionId) {
    const controller = new AbortController();
    abortRef.current = controller;

    const streamId = `b-${Date.now()}`;
    streamingIdRef.current = streamId;

    setIsStreaming(true);
    setStreamingContent('');

    const apiMessages: ChatMessage[] = currentMessages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    let accumulated = '';

    streamChat(
      accessToken,
      {
        messages: apiMessages,
        model,
        temperature,
        system_prompt: systemPrompt,
        mode,
        session_id: targetSessionId ?? undefined,
      },
      controller.signal,
      (token) => {
        accumulated += token;
        setStreamingContent(accumulated);
      },
      (metadata) => {
        const citations = metadata?.citations ?? [];
        const finalMsg: UIMessage = {
          id: streamId,
          role: 'assistant',
          content: accumulated,
          model: metadata?.model ?? model,
          time: metadata?.time,
          tokens: Math.round(accumulated.length / 4),
          mode,
          citations,
          reasoningSummary: metadata?.reasoning_summary,
          usedRag: citations.length > 0,
        };
        setMessages((prev) => [...prev, finalMsg]);
        setIsStreaming(false);
        setStreamingContent('');
        onStreamDone?.();

        // Persist to backend
        if (targetSessionId) {
          const saved: ChatMessage[] = [...apiMessages, { role: 'assistant', content: accumulated }];
          updateSession(accessToken, targetSessionId, { messages: saved }).then(() => {
            onSessionUpdate?.();
          });
        }
      },
      (error) => {
        console.error('Stream error:', error);
        if (accumulated) {
          setMessages((prev) => [
            ...prev,
            { id: streamId, role: 'assistant', content: accumulated + '\n\n*[stream interrupted]*' },
          ]);
        }
        setIsStreaming(false);
        setStreamingContent('');
      }
    );
  }

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    if (streamingContent) {
      setMessages((prev) => [
        ...prev,
        {
          id: streamingIdRef.current,
          role: 'assistant',
          content: streamingContent,
        },
      ]);
    }
    setIsStreaming(false);
    setStreamingContent('');
  }, [streamingContent]);

  const regenerate = useCallback(() => {
    setMessages((prev) => {
      const idx = [...prev].reverse().findIndex((m) => m.role === 'assistant');
      if (idx === -1) return prev;
      const without = prev.slice(0, prev.length - 1 - idx);
      startStream(without, sessionId);
      return without;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    messages,
    isStreaming,
    streamingContent,
    sendMessage,
    cancelStream,
    regenerate,
    loadMessages,
    clearMessages,
  };
}
