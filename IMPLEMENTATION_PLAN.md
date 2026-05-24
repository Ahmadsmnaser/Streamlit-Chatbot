# Implementation Plan: RAG + Navigation + Answer Modes

**Stack:** FastAPI (Groq/LangChain) + Next.js (TypeScript, Tailwind, CSS vars)  
**Branch strategy:** one feature branch per feature, merge sequentially  
**Rule:** never rewrite — extend existing files with minimal, clean additions

---

## Codebase snapshot (as of inspection)

```
backend/
  main.py          — FastAPI app, REST + SSE endpoints
  models.py        — Pydantic models (ChatRequest, MessagePayload, etc.)
  llm.py           — ChatGroq wrapper, stream_llm()
  chat_store.py    — In-memory session CRUD
  config.py        — Env vars, model list
  requirements.txt

frontend/src/
  app/
    globals.css    — All CSS (CSS vars, soft purple theme, no Tailwind utilities)
    layout.tsx / page.tsx
  components/
    ChatApp.tsx    — Root shell, orchestrates all hooks + layout
    InputDock.tsx  — Textarea + send button
    Message.tsx    — UIMessage + StreamingMessage renders
    Sidebar.tsx    — Session list + model/temp/sys-prompt settings
    Topbar.tsx     — Title editor + theme toggle
    EmptyState.tsx — Suggestion cards
    Mascot.tsx     — SVG mascot
  hooks/
    useChat.ts     — Stream state, sendMessage, regenerate
    useChatSessions.ts — Session CRUD state
  lib/
    api.ts         — fetch wrappers + streamChat SSE reader
    markdown.tsx   — Custom markdown renderer
    utils.ts       — detectDir()
```

---

## Data model changes (shared between all features)

### Frontend — extend `UIMessage` in `useChat.ts`

```ts
// Current:
export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  time?: number;
  tokens?: number;
  streaming?: boolean;
}

// Extended:
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

export type AnswerMode = 'simple' | 'deep' | 'exam' | 'code' | 'interview';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  time?: number;
  tokens?: number;
  streaming?: boolean;
  // New:
  mode?: AnswerMode;
  citations?: Citation[];
  reasoningSummary?: ReasoningSummary;
  usedRag?: boolean;
}
```

### Backend — extend `ChatRequest` in `models.py`

```python
class ChatRequest(BaseModel):
    messages: list[MessagePayload]
    model: str = "llama-3.1-8b-instant"
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    system_prompt: str = Field(default="You are a helpful assistant.", max_length=2000)
    # New:
    mode: str = Field(default="simple")         # answer mode
    session_id: str | None = None               # for RAG context isolation
```

The SSE done event will be extended to carry `citations` and `reasoning_summary`:
```json
{
  "token": "",
  "done": true,
  "metadata": {
    "model": "...",
    "time": 1.23,
    "citations": [...],
    "reasoning_summary": {...}
  }
}
```

---

## Feature 1: File Upload + RAG + Citations

### Overview

User uploads PDF/TXT/MD → backend extracts text → chunks → embeds → stores in Chroma.  
On chat: retrieve top-k chunks → inject as context → model answers with citations.  
Citations appear under the assistant bubble; a reasoning summary collapses above.

---

### Step 1.1 — Backend: RAG service layer

**New directory:** `backend/services/rag/`

#### `backend/services/rag/__init__.py`
Empty.

#### `backend/services/rag/extractor.py`
Extracts plain text from uploaded files.

```
extract_text(file_bytes: bytes, filename: str) -> list[PageChunk]

PageChunk = {
  text: str,
  page_number: int | None,   # from PDF metadata
  source_file: str,
}
```

- PDF: use `pypdf` (pure Python, no system deps). Iterate pages, extract `.extract_text()`.
- TXT/MD: read as UTF-8, treat as single "page 1".
- Unsupported extension → raise `ValueError("Unsupported file type")`.
- Empty text after extraction → raise `ValueError("File appears to be empty or unreadable")`.

#### `backend/services/rag/chunker.py`
Split page text into overlapping chunks.

```
chunk_pages(pages: list[PageChunk], chunk_size=600, overlap=80) -> list[Chunk]

Chunk = {
  text: str,
  fileName: str,
  pageNumber: int | None,
  chunkIndex: int,
}
```

Use a simple sliding-window splitter on `\n` boundaries first, then character fallback. No external splitter library needed for MVP.

#### `backend/services/rag/store.py`
Manages the Chroma vector store, one collection per session.

```python
class RAGStore:
    def __init__(self, session_id: str): ...
    async def add_chunks(self, chunks: list[Chunk]) -> None: ...
    async def search(self, query: str, top_k=4) -> list[RetrievedChunk]: ...
    def clear(self) -> None: ...

RetrievedChunk = Chunk + { score: float }
```

- Use `chromadb` (in-memory by default, persisted to `./chroma_data/{session_id}`).
- Embeddings: use `chromadb`'s default `SentenceTransformerEmbeddingFunction` (all-MiniLM-L6-v2) — no OpenAI key needed.
- One Chroma collection per `session_id`. Recreate on upload.

#### `backend/services/rag/context_builder.py`
Formats retrieved chunks into a context block for the LLM prompt.

```python
def build_context_prompt(chunks: list[RetrievedChunk]) -> str:
    """Returns a formatted context string to inject before the user query."""
```

Format:
```
[Context from uploaded files]
---
Source: report.pdf, page 3
"The scheduler selects the next runnable process..."
---
Source: notes.txt, page 1
"..."
---
Use the above context to answer the question. If the context does not contain enough information, say so.
```

#### `backend/services/rag/citation_formatter.py`
Converts `RetrievedChunk` list into the `Citation` response model.

```python
def format_citations(chunks: list[RetrievedChunk]) -> list[dict]:
    return [
        {
            "fileName": c["fileName"],
            "pageNumber": c.get("pageNumber"),
            "chunkIndex": c["chunkIndex"],
            "snippet": c["text"][:200],
        }
        for c in chunks
    ]
```

---

### Step 1.2 — Backend: upload endpoint

**File:** `backend/main.py`

Add two new endpoints. Do NOT touch the existing `/api/chat` endpoint yet.

```python
from fastapi import UploadFile, File, Form
from services.rag.extractor import extract_text
from services.rag.chunker import chunk_pages
from services.rag.store import RAGStore

# in-memory registry: session_id -> RAGStore
_rag_stores: dict[str, RAGStore] = {}


@app.post("/api/rag/upload")
async def upload_file(
    session_id: str = Form(...),
    file: UploadFile = File(...),
):
    """Extract, chunk, embed, and index an uploaded file for a session."""
    allowed = {".pdf", ".txt", ".md"}
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")

    try:
        pages = extract_text(content, file.filename)
        chunks = chunk_pages(pages)
    except ValueError as e:
        raise HTTPException(422, str(e))

    store = _rag_stores.setdefault(session_id, RAGStore(session_id))
    await store.add_chunks(chunks)

    return {
        "status": "ready",
        "fileName": file.filename,
        "chunks": len(chunks),
    }


@app.delete("/api/rag/{session_id}")
async def clear_rag(session_id: str):
    """Clear indexed files for a session."""
    if session_id in _rag_stores:
        _rag_stores[session_id].clear()
        del _rag_stores[session_id]
    return {"status": "cleared"}
```

---

### Step 1.3 — Backend: wire RAG into `/api/chat`

Extend `ChatRequest` with `session_id` and `mode` (already described in data model section).

In `main.py` `chat_stream()`:

```python
@app.post("/api/chat")
async def chat_stream(request: ChatRequest):
    # ... existing validation ...

    citations = []
    rag_used = False

    # RAG context injection
    if request.session_id and request.session_id in _rag_stores:
        store = _rag_stores[request.session_id]
        last_user_msg = next(
            (m.content for m in reversed(request.messages) if m.role == "user"), ""
        )
        retrieved = await store.search(last_user_msg, top_k=4)
        if retrieved:
            rag_used = True
            citations = format_citations(retrieved)
            context_block = build_context_prompt(retrieved)
            # Prepend context to system prompt
            system = context_block + "\n\n" + request.system_prompt
        else:
            system = request.system_prompt
    else:
        system = request.system_prompt

    # Mode system prompt prefix
    mode_prefix = MODE_PROMPTS.get(request.mode, "")
    if mode_prefix:
        system = mode_prefix + "\n\n" + system

    messages = [{"role": "system", "content": system}]
    for msg in request.messages:
        messages.append({"role": msg.role, "content": msg.content})

    # Build reasoning summary
    reasoning_summary = {
        "mode": request.mode,
        "usedUploadedFiles": rag_used,
        "retrievedChunks": len(citations) if rag_used else 0,
        "usedFiles": list({c["fileName"] for c in citations}) if rag_used else [],
        "basis": "uploaded_files" if rag_used else "general_knowledge",
        "confidence": "high" if rag_used and len(citations) >= 3 else "medium",
    }

    return StreamingResponse(
        stream_llm(
            messages,
            model=request.model,
            temperature=request.temperature,
            citations=citations,
            reasoning_summary=reasoning_summary,
        ),
        media_type="text/event-stream",
        headers={...},
    )
```

Extend `stream_llm()` in `llm.py` to accept and forward `citations` + `reasoning_summary` in the done event:

```python
async def stream_llm(
    messages, model, temperature,
    citations=None, reasoning_summary=None
):
    # ... existing streaming ...
    # In done event:
    done_event = json.dumps({
        "token": "", "done": True,
        "metadata": {
            "model": model,
            "time": round(elapsed, 2),
            "citations": citations or [],
            "reasoning_summary": reasoning_summary or {},
        },
    })
    yield f"data: {done_event}\n\n"
```

---

### Step 1.4 — Backend: answer mode prompts

**New file:** `backend/services/modes.py`

```python
MODE_PROMPTS: dict[str, str] = {
    "simple": "Answer clearly and briefly. Use simple language suitable for a beginner. Avoid jargon.",
    "deep": "Provide a comprehensive, technically detailed answer. Include nuances, edge cases, and depth.",
    "exam": "Structure your answer for studying: start with a definition, then key points as a numbered list, then a short example.",
    "code": "Focus on implementation. Lead with working code examples. Explain code inline with comments. Minimize prose.",
    "interview": "Answer as if in a technical job interview: confident, structured, STAR-method where applicable, professional.",
}
```

Import this in `main.py`.

---

### Step 1.5 — Backend: requirements update

Add to `backend/requirements.txt`:
```
pypdf
chromadb
sentence-transformers
```

---

### Step 1.6 — Frontend: upload API calls

**File:** `frontend/src/lib/api.ts` — add:

```ts
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
```

Also extend `ChatRequest` in `api.ts`:
```ts
export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  temperature: number;
  system_prompt: string;
  mode?: string;          // new
  session_id?: string;    // new
}
```

Extend `SSEToken`:
```ts
export interface SSEToken {
  token?: string;
  done?: boolean;
  error?: string;
  metadata?: {
    model: string;
    time: number;
    citations?: Citation[];          // new
    reasoning_summary?: ReasoningSummary;  // new
  };
}
```

---

### Step 1.7 — Frontend: file state hook

**New file:** `frontend/src/hooks/useRag.ts`

Encapsulates all upload state so `ChatApp` stays clean.

```ts
export function useRag(sessionId: string | null) {
  const [files, setFiles] = useState<UploadedFile[]>([]);

  const upload = useCallback(async (file: File) => {
    if (!sessionId) return;
    const entry: UploadedFile = { fileName: file.name, chunks: 0, status: 'uploading' };
    setFiles(prev => [...prev, entry]);
    try {
      const result = await uploadFile(sessionId, file, (status) => {
        setFiles(prev => prev.map(f => f.fileName === file.name ? { ...f, status } : f));
      });
      setFiles(prev => prev.map(f => f.fileName === file.name ? { ...f, ...result } : f));
    } catch {
      setFiles(prev => prev.map(f => f.fileName === file.name ? { ...f, status: 'failed' } : f));
    }
  }, [sessionId]);

  const clear = useCallback(async () => {
    if (!sessionId) return;
    await clearRag(sessionId);
    setFiles([]);
  }, [sessionId]);

  const hasReadyFiles = files.some(f => f.status === 'ready');

  return { files, upload, clear, hasReadyFiles };
}
```

---

### Step 1.8 — Frontend: upload button + file chip list

**File:** `frontend/src/components/InputDock.tsx`

Add a hidden `<input type="file">` and a paperclip button **to the left of the textarea**. On hover, the icon changes from `📎` → `+` using CSS `:hover`.

```tsx
interface InputDockProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  onFileSelect?: (file: File) => void;   // new
  uploadedFiles?: UploadedFile[];        // new
}
```

Inside `input-shell`, before `textarea`:
```tsx
<>
  <input
    type="file"
    ref={fileInputRef}
    accept=".pdf,.txt,.md"
    className="hidden"
    onChange={e => { if (e.target.files?.[0]) onFileSelect?.(e.target.files[0]); }}
  />
  <button
    type="button"
    className="upload-btn"
    onClick={() => fileInputRef.current?.click()}
    aria-label="Upload file"
  >
    <svg className="icon-clip" ...>📎</svg>
    <svg className="icon-plus" ...>+</svg>
  </button>
</>
```

**File chip list** — rendered just above `input-dock` inside `ChatApp.tsx`:

```tsx
{uploadedFiles.length > 0 && (
  <div className="file-chips">
    {uploadedFiles.map(f => (
      <div key={f.fileName} className={`file-chip status-${f.status}`}>
        <span className="file-chip-name">{f.fileName}</span>
        <span className="file-chip-status">{STATUS_LABELS[f.status]}</span>
      </div>
    ))}
  </div>
)}
```

CSS additions to `globals.css`:

```css
/* Upload button */
.upload-btn { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--text-muted); flex-shrink: 0; transition: background 150ms, color 150ms; }
.upload-btn:hover { background: var(--surface-hover); color: var(--primary-2); }
.upload-btn .icon-clip { display: block; }
.upload-btn .icon-plus { display: none; }
.upload-btn:hover .icon-clip { display: none; }
.upload-btn:hover .icon-plus { display: block; }

/* File chips */
.file-chips { display: flex; flex-wrap: wrap; gap: 6px; max-width: 768px; margin: 0 auto; padding: 0 24px 8px; }
.file-chip { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; background: var(--surface); border: 1px solid var(--border); color: var(--text-muted); }
.file-chip-name { font-weight: 500; color: var(--text); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-chip.status-uploading { border-color: var(--accent); }
.file-chip.status-processing { border-color: var(--secondary); }
.file-chip.status-ready { border-color: var(--primary-1); }
.file-chip.status-failed { border-color: #d95757; }
```

---

### Step 1.9 — Frontend: citations in Message.tsx

Add below the bot bubble, only when `msg.citations` is non-empty:

```tsx
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
```

CSS:
```css
.citations { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.citations-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
.citation-item { display: flex; flex-direction: column; gap: 2px; }
.citation-src { font-size: 12px; font-weight: 600; color: var(--primary-2); }
.citation-snippet { font-size: 12px; color: var(--text-muted); font-style: italic; line-height: 1.5; }
```

---

### Step 1.10 — Wire everything in ChatApp.tsx

- Import and call `useRag(activeSessionId)`.
- Pass `hasReadyFiles` and `sessionId` into `useChat` options.
- In `startStream`, include `session_id` and `mode` in the `ChatRequest`.
- Pass `upload` handler and `files` to `InputDock`.
- Render file chips between `.messages-wrap` and `InputDock`.
- On `onDone`: attach `citations` and `reasoningSummary` from `metadata` to the final `UIMessage`.

---

## Feature 2: Message Navigation Dots

### Overview

A vertical strip of small dots on the right edge of the chat area. Each dot = one message. Click scrolls to that message. IntersectionObserver tracks the active dot.

---

### Step 2.1 — Assign IDs to message DOM nodes

In `ChatApp.tsx`, the messages list already has `key={m.id}`. We need the DOM nodes to be reachable. Change the render:

```tsx
{messages.map((m) => (
  <div key={m.id} id={`msg-${m.id}`}>
    <Message msg={m} onRegenerate={m.role === 'assistant' ? regenerate : undefined} />
  </div>
))}
```

No changes to `Message.tsx`.

---

### Step 2.2 — New component: MessageNavDots

**New file:** `frontend/src/components/MessageNavDots.tsx`

```tsx
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
        // Pick the topmost intersecting entry
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const id = visible[0].target.id.replace('msg-', '');
          setActiveId(id);
        }
      },
      { threshold: 0.5 }
    );
    messages.forEach(m => {
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
    // Brief highlight
    el.classList.add('msg-highlight');
    setTimeout(() => el.classList.remove('msg-highlight'), 1000);
  };

  const allDots = [
    ...messages,
    ...(isStreaming ? [{ id: 'streaming', role: 'assistant' as const }] : []),
  ];

  if (allDots.length < 2) return null;

  return (
    <div className="nav-dots" aria-label="Message navigation" role="navigation">
      {allDots.map(m => (
        <button
          key={m.id}
          className={`nav-dot role-${m.role} ${activeId === m.id ? 'active' : ''}`}
          onClick={() => scrollTo(m.id)}
          aria-label={`Go to ${m.role} message`}
          title={m.role === 'user' ? 'User message' : 'Assistant message'}
        />
      ))}
    </div>
  );
}
```

---

### Step 2.3 — Place nav dots in ChatApp.tsx

The `.messages-wrap` div already has `position: relative` (via `.messages-wrap` CSS). Add nav dots inside it:

```tsx
<div className="messages-wrap">
  {showEmpty ? (
    <EmptyState onSuggest={handleSuggest} />
  ) : (
    <>
      <MessageNavDots messages={messages} isStreaming={isStreaming} />
      <div className="messages">
        ...
      </div>
    </>
  )}
</div>
```

---

### Step 2.4 — CSS for nav dots

Add to `globals.css`:

```css
/* ============== NAV DOTS ============== */
.nav-dots {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 3;
  max-height: 70vh;
  overflow: hidden;
  align-items: center;
}

.nav-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  transition: width 150ms, height 150ms, background 150ms, opacity 150ms;
  opacity: 0.45;
  padding: 0;
  flex-shrink: 0;
}

.nav-dot.role-user { background: var(--text-muted); }
.nav-dot.role-assistant { background: var(--primary-2); }

.nav-dot.active {
  width: 8px;
  height: 8px;
  opacity: 1;
}

.nav-dot:hover { opacity: 0.85; transform: scale(1.3); }

/* Highlight animation for scrolled-to message */
.msg-highlight {
  animation: msgHighlight 800ms ease-out;
}
@keyframes msgHighlight {
  0% { outline: 2px solid var(--primary-1); outline-offset: 4px; border-radius: 18px; }
  100% { outline: 2px solid transparent; outline-offset: 8px; }
}

/* Hide on small screens */
@media (max-width: 768px) {
  .nav-dots { display: none; }
}
```

---

## Feature 3: Answer Modes + Reasoning Summary

### Overview

A horizontal mode selector above the input (or inline in the input dock).  
Mode state lives in `ChatApp`. On send, mode is passed to `useChat` → `api.ts` → backend.  
After each response, a collapsible "How this answer was prepared" section appears.

---

### Step 3.1 — Mode selector component

**New file:** `frontend/src/components/ModeSelector.tsx`

```tsx
'use client';
import { AnswerMode } from '@/hooks/useChat';

const MODES: { id: AnswerMode; label: string; icon: string; description: string }[] = [
  { id: 'simple',    label: 'Simple',    icon: '💡', description: 'Clear, beginner-friendly' },
  { id: 'deep',      label: 'Deep',      icon: '🔬', description: 'Technical, detailed' },
  { id: 'exam',      label: 'Exam',      icon: '📝', description: 'Structured for studying' },
  { id: 'code',      label: 'Code',      icon: '💻', description: 'Implementation focused' },
  { id: 'interview', label: 'Interview', icon: '🎯', description: 'Job interview style' },
];

interface ModeSelectorProps {
  value: AnswerMode;
  onChange: (mode: AnswerMode) => void;
}

export function ModeSelector({ value, onChange }: ModeSelectorProps) {
  return (
    <div className="mode-selector" role="group" aria-label="Answer mode">
      {MODES.map(m => (
        <button
          key={m.id}
          className={`mode-btn ${value === m.id ? 'active' : ''}`}
          onClick={() => onChange(m.id)}
          title={m.description}
          aria-pressed={value === m.id}
        >
          <span className="mode-icon">{m.icon}</span>
          <span className="mode-label">{m.label}</span>
        </button>
      ))}
    </div>
  );
}
```

---

### Step 3.2 — Place ModeSelector in ChatApp.tsx

Add `mode` state:
```tsx
const [mode, setMode] = useState<AnswerMode>('simple');
```

Render above `InputDock`, inside `.main`:
```tsx
<ModeSelector value={mode} onChange={setMode} />
<InputDock ... />
```

Pass `mode` into `useChat` options and into `sendMessage`.

---

### Step 3.3 — Mode in useChat.ts

Extend `UseChatOptions`:
```ts
interface UseChatOptions {
  model: string;
  temperature: number;
  systemPrompt: string;
  sessionId: string | null;
  mode: AnswerMode;                // new
  onSessionUpdate?: () => void;
}
```

In `startStream`, include `mode` and `session_id` in the API call:
```ts
streamChat(
  {
    messages: apiMessages,
    model, temperature,
    system_prompt: systemPrompt,
    mode,                         // new
    session_id: sessionId ?? undefined,  // new
  },
  ...
)
```

In `onDone`, attach metadata to `UIMessage`:
```ts
const finalMsg: UIMessage = {
  id: streamId,
  role: 'assistant',
  content: accumulated,
  model: metadata?.model ?? model,
  time: metadata?.time,
  tokens: Math.round(accumulated.length / 4),
  mode: mode,                                      // new
  citations: metadata?.citations ?? [],            // new
  reasoningSummary: metadata?.reasoning_summary,  // new
  usedRag: (metadata?.citations?.length ?? 0) > 0, // new
};
```

---

### Step 3.4 — Reasoning summary component

**New file:** `frontend/src/components/ReasoningSummary.tsx`

```tsx
'use client';
import { useState } from 'react';
import { ReasoningSummary as RS } from '@/hooks/useChat';

const MODE_LABELS: Record<string, string> = {
  simple: 'Simple', deep: 'Deep', exam: 'Exam', code: 'Code', interview: 'Interview',
};

const BASIS_LABELS: Record<string, string> = {
  uploaded_files: 'Uploaded documents',
  general_knowledge: 'General model knowledge',
  mixed: 'Uploaded documents + general knowledge',
};

interface Props { summary: RS; }

export function ReasoningSummaryBlock({ summary }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="reasoning-block">
      <button
        className="reasoning-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" className={`icon-stroke reasoning-chevron ${open ? 'open' : ''}`}>
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
              <div className="reasoning-row">
                <span className="reasoning-key">Files</span>
                <span className="reasoning-val">{summary.usedFiles?.join(', ')}</span>
              </div>
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
```

Render in `Message.tsx` after `.msg-meta`, only for assistant messages with a `reasoningSummary`:

```tsx
{!isUser && !msg.streaming && msg.reasoningSummary && (
  <ReasoningSummaryBlock summary={msg.reasoningSummary} />
)}
```

---

### Step 3.5 — CSS for mode selector + reasoning summary

Add to `globals.css`:

```css
/* ============== MODE SELECTOR ============== */
.mode-selector {
  display: flex;
  gap: 4px;
  max-width: 768px;
  margin: 0 auto;
  padding: 0 24px 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.mode-selector::-webkit-scrollbar { display: none; }

.mode-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  white-space: nowrap;
  transition: background 150ms, color 150ms, border-color 150ms, transform 100ms;
  flex-shrink: 0;
}
.mode-btn:hover { background: var(--surface-hover); color: var(--text); transform: translateY(-1px); }
.mode-btn.active { background: var(--primary-grad); color: white; border-color: transparent; box-shadow: 0 2px 8px rgba(155,135,217,0.3); }
.mode-icon { font-size: 14px; line-height: 1; }

/* ============== REASONING SUMMARY ============== */
.reasoning-block { margin-top: 8px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; font-size: 12.5px; }
.reasoning-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  text-align: start;
  transition: background 150ms, color 150ms;
}
.reasoning-toggle:hover { background: var(--surface-hover); color: var(--text); }
.reasoning-chevron { transition: transform 150ms; }
.reasoning-chevron.open { transform: rotate(180deg); }
.reasoning-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; background: var(--surface); }
.reasoning-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.reasoning-key { color: var(--text-muted); font-size: 12px; flex-shrink: 0; }
.reasoning-val { color: var(--text); font-size: 12px; font-weight: 500; text-align: end; }
.confidence-high { color: #4caf81; }
.confidence-medium { color: #e8a838; }
.confidence-low { color: #d95757; }
```

---

## File change summary

### New files

| Path | Purpose |
|------|---------|
| `backend/services/__init__.py` | Package marker |
| `backend/services/rag/__init__.py` | Package marker |
| `backend/services/rag/extractor.py` | PDF/TXT/MD → PageChunk |
| `backend/services/rag/chunker.py` | PageChunk → Chunk |
| `backend/services/rag/store.py` | Chroma wrapper per session |
| `backend/services/rag/context_builder.py` | Chunks → LLM context string |
| `backend/services/rag/citation_formatter.py` | Chunks → Citation dicts |
| `backend/services/modes.py` | MODE_PROMPTS dict |
| `frontend/src/hooks/useRag.ts` | Upload state management |
| `frontend/src/components/MessageNavDots.tsx` | Navigation dots UI |
| `frontend/src/components/ModeSelector.tsx` | Mode picker UI |
| `frontend/src/components/ReasoningSummary.tsx` | Collapsible summary UI |

### Modified files

| Path | Change |
|------|--------|
| `backend/requirements.txt` | Add pypdf, chromadb, sentence-transformers |
| `backend/models.py` | Add `mode`, `session_id` to `ChatRequest` |
| `backend/main.py` | Add `/api/rag/upload`, `/api/rag/{id}`, wire RAG + mode into `/api/chat` |
| `backend/llm.py` | Pass citations + reasoning_summary in done event |
| `frontend/src/hooks/useChat.ts` | Extend `UIMessage`, `UseChatOptions`; attach metadata on done |
| `frontend/src/lib/api.ts` | Add `uploadFile`, `clearRag`; extend `ChatRequest`, `SSEToken` |
| `frontend/src/app/globals.css` | Add CSS for upload btn, chips, dots, mode selector, reasoning |
| `frontend/src/components/ChatApp.tsx` | Add `mode`, `useRag`, `ModeSelector`, `MessageNavDots`, file chips, msg IDs |
| `frontend/src/components/InputDock.tsx` | Add upload button + file input |
| `frontend/src/components/Message.tsx` | Add citations block + ReasoningSummaryBlock |

---

## Implementation order

1. **Data model changes** (both ends) — no visible effect yet, safe first step
2. **Feature 3: Answer Modes** (backend modes.py + wire into chat) — simplest, no new deps
3. **Feature 3: Mode Selector UI + Reasoning Summary UI** — pure frontend, no backend dep
4. **Feature 1: RAG backend** (install deps, extractor, chunker, store, endpoints)
5. **Feature 1: RAG frontend** (useRag, upload button, chips, citations in Message)
6. **Feature 2: Nav Dots** — last, since it depends on message IDs being in the DOM

Each step is independently testable before moving to the next.

---

## How to run and test

### Backend

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt        # pick up new deps
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm run dev                            # runs on http://localhost:3000
```

### Test checklist per feature

#### Feature 3 (Modes)
- [ ] Select "Code" mode → send a question → response should be code-heavy
- [ ] Select "Simple" → ask a technical question → response should be beginner-friendly
- [ ] Reasoning summary collapses/expands on click
- [ ] Reasoning summary shows correct mode name and "No uploaded files were used"

#### Feature 1 (RAG)
- [ ] Upload a PDF → chip shows `Uploading... → Processing... → Ready`
- [ ] Ask a question about the PDF → answer starts with "Based on the uploaded file..."
- [ ] Citations show file name, page number, snippet under the answer
- [ ] Upload an unsupported file type → error state shown
- [ ] Upload empty file → error state shown
- [ ] Ask unrelated question → "uploaded files do not contain enough relevant information"
- [ ] Reasoning summary shows "Uploaded files used: Yes", file name, chunk count

#### Feature 2 (Nav Dots)
- [ ] Send several messages → dots appear on the right
- [ ] User messages = gray dots, assistant = purple
- [ ] Click a dot → smooth scroll to that message + brief highlight ring
- [ ] Active dot is visibly larger
- [ ] Dots hidden on mobile (< 768px)
- [ ] Works correctly with long conversations (20+ messages)
