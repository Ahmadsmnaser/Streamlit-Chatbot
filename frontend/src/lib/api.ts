const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Model {
  id: string;
  name: string;
  description: string;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  messages?: ChatMessage[];
}

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

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  temperature: number;
  system_prompt: string;
  mode?: string;
  session_id?: string;
}

export interface SSEToken {
  token?: string;
  done?: boolean;
  error?: string;
  metadata?: {
    model: string;
    time: number;
    citations?: Citation[];
    reasoning_summary?: ReasoningSummary;
  };
}

export async function fetchHealth(): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/api/health`);
  return res.json();
}

export async function fetchModels(): Promise<Model[]> {
  const res = await fetch(`${BASE}/api/models`);
  return res.json();
}

export async function fetchSessions(): Promise<ChatSession[]> {
  const res = await fetch(`${BASE}/api/chats`);
  return res.json();
}

export async function createSession(title?: string): Promise<ChatSession> {
  const res = await fetch(`${BASE}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title ?? 'New Chat' }),
  });
  return res.json();
}

export async function fetchSession(id: string): Promise<ChatSession> {
  const res = await fetch(`${BASE}/api/chats/${id}`);
  return res.json();
}

export async function updateSession(
  id: string,
  data: { title?: string; messages?: ChatMessage[] }
): Promise<ChatSession> {
  const res = await fetch(`${BASE}/api/chats/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteSession(id: string): Promise<{ status: string; id: string }> {
  const res = await fetch(`${BASE}/api/chats/${id}`, { method: 'DELETE' });
  return res.json();
}

export type StreamMetadata = SSEToken['metadata'];

export type UploadStatus = 'idle' | 'uploading' | 'processing' | 'ready' | 'failed';

export interface UploadedFile {
  fileName: string;
  chunks: number;
  status: UploadStatus;
}

export async function uploadFile(
  sessionId: string,
  file: File,
  onStatus: (s: UploadStatus) => void
): Promise<UploadedFile> {
  onStatus('uploading');
  const form = new FormData();
  form.append('session_id', sessionId);
  form.append('file', file);
  onStatus('processing');
  const res = await fetch(`${BASE}/api/rag/upload`, { method: 'POST', body: form });
  if (!res.ok) {
    onStatus('failed');
    throw new Error(await res.text());
  }
  const data = await res.json();
  onStatus('ready');
  return data;
}

export async function clearRag(sessionId: string): Promise<void> {
  await fetch(`${BASE}/api/rag/${sessionId}`, { method: 'DELETE' });
}

export function streamChat(
  request: ChatRequest,
  signal: AbortSignal,
  onToken: (token: string) => void,
  onDone: (metadata?: StreamMetadata) => void,
  onError: (error: string) => void
): void {
  // Strip any extra fields from messages before sending
  const cleanMessages = request.messages.map(({ role, content }) => ({ role, content }));

  fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, messages: cleanMessages }),
    signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        onError(`HTTP ${res.status}`);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) { onError('No response body'); return; }
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          try {
            const json: SSEToken = JSON.parse(line.slice(6));
            if (json.error) { onError(json.error); return; }
            if (json.done) { onDone(json.metadata); return; }
            if (json.token) onToken(json.token);
          } catch {
            // skip malformed chunk
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(String(err));
    });
}
