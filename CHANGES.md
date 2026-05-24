# Changes Log

## What was built

Three features were added to the existing FastAPI + Next.js chatbot without rewriting any existing logic.

---

## Phase 1 — Data models (both ends)

Established the shared data contract that all three features depend on.

### Backend — `backend/models.py`

Extended `ChatRequest` with two new optional fields:

```python
mode: str = Field(default="simple")   # which answer style to apply
session_id: str | None = None          # used later for RAG context isolation
```

### Frontend — `frontend/src/hooks/useChat.ts`

Added three new exported types and extended `UIMessage`:

```ts
type AnswerMode = 'simple' | 'deep' | 'exam' | 'code' | 'interview'

interface Citation {
  fileName: string
  pageNumber?: number
  chunkIndex?: number
  snippet: string
}

interface ReasoningSummary {
  mode: string
  usedUploadedFiles: boolean
  retrievedChunks?: number
  usedFiles?: string[]
  basis: 'uploaded_files' | 'general_knowledge' | 'mixed'
  confidence: 'high' | 'medium' | 'low'
}

// Added to UIMessage:
mode?: AnswerMode
citations?: Citation[]
reasoningSummary?: ReasoningSummary
usedRag?: boolean
```

### Frontend — `frontend/src/lib/api.ts`

- Mirrored `Citation` and `ReasoningSummary` types for API boundary use.
- Extended `ChatRequest` with `mode?: string` and `session_id?: string`.
- Extended `SSEToken.metadata` to carry `citations` and `reasoning_summary` from the done event.
- Exported `StreamMetadata` type alias so `onDone` callback is fully typed.

---

## Phase 2 — Answer modes (backend)

### New file — `backend/services/modes.py`

Defines a `MODE_PROMPTS` dict mapping each mode name to a system-prompt prefix:

| Mode | Instruction summary |
|---|---|
| `simple` | Clear, brief, beginner-friendly, no jargon |
| `deep` | Comprehensive, technical, no simplification |
| `exam` | Definition → numbered key points → example |
| `code` | Code-first, inline comments, minimal prose |
| `interview` | STAR method, confident, professional |

### Modified — `backend/llm.py`

`stream_llm` now accepts two optional parameters — `citations` and `reasoning_summary` — and includes them in the SSE done event:

```python
async def stream_llm(
    messages, model, temperature,
    citations=None, reasoning_summary=None
):
    ...
    done_event = json.dumps({
        "token": "", "done": True,
        "metadata": {
            "model": model,
            "time": round(elapsed, 2),
            "citations": citations or [],
            "reasoning_summary": reasoning_summary or {},
        },
    })
```

Also removed an unused `AsyncIterator` import that was already in the file.

### Modified — `backend/main.py`

`chat_stream` now:
1. Looks up the mode prefix from `MODE_PROMPTS`.
2. Prepends it to the system prompt before sending to the LLM.
3. Builds a `reasoning_summary` dict (RAG fields default to empty; will be populated in Phase 4).
4. Passes both to `stream_llm`.

```python
mode_prefix = MODE_PROMPTS.get(request.mode, "")
system = f"{mode_prefix}\n\n{request.system_prompt}".strip()

reasoning_summary = {
    "mode": request.mode,
    "usedUploadedFiles": False,
    "retrievedChunks": 0,
    "usedFiles": [],
    "basis": "general_knowledge",
    "confidence": "medium",
}
```

---

## Phase 3 — Answer modes UI + reasoning summary (frontend)

### New file — `frontend/src/components/ModeSelector.tsx`

Five pill buttons rendered inside the input dock, above the text area. Clicking one sets the active mode. The active pill gets the purple gradient. Titles on hover describe each mode.

Placed **inside `InputDock`** (not above it) because `InputDock` uses `position: absolute` — anything rendered before it in the normal flow gets covered.

### New file — `frontend/src/components/ReasoningSummary.tsx`

A collapsible block that appears under each finished assistant message. Clicking "How this answer was prepared" expands it to show:

- Answer mode used
- Whether uploaded files were used (Yes / No)
- Number of retrieved chunks (if RAG was used)
- File names used (if RAG was used)
- Basis of answer (general knowledge / uploaded docs / mixed)
- Confidence level (green = high, amber = medium, red = low)

### Modified — `frontend/src/hooks/useChat.ts`

- Added `mode: AnswerMode` to `UseChatOptions`.
- `startStream` now passes `mode` and `session_id` in the `streamChat` call.
- On stream done, `mode`, `citations`, `reasoningSummary`, and `usedRag` are attached to the final `UIMessage`.

### Modified — `frontend/src/lib/api.ts`

- `StreamMetadata` type exported so the `onDone` callback carries the full metadata shape including `citations` and `reasoning_summary`.

### Modified — `frontend/src/components/InputDock.tsx`

- Accepts two new props: `mode: AnswerMode` and `onModeChange: (m: AnswerMode) => void`.
- Renders `<ModeSelector>` above the input shell, inside the dock container.

### Modified — `frontend/src/components/ChatApp.tsx`

- Added `mode` state: `useState<AnswerMode>('simple')`.
- Passes `mode` to `useChat` and `mode`/`onModeChange` down to `InputDock`.

### Modified — `frontend/src/components/Message.tsx`

- Imports and renders `<ReasoningSummaryBlock>` for finished assistant messages that have a `reasoningSummary`.

### Modified — `frontend/src/app/globals.css`

Two new sections appended:

**`.mode-selector` / `.mode-btn`**
- Horizontal scrollable strip of pill buttons.
- `pointer-events: auto` restores click events (the parent `.input-dock` sets `pointer-events: none` to avoid blocking scroll).
- Active pill uses `var(--primary-grad)` (purple).

**`.reasoning-block` / `.reasoning-toggle` / `.reasoning-body`**
- Subtle bordered block below assistant bubbles.
- Chevron rotates 180° when open.
- Confidence value colored: green / amber / red.

---

## Bug fix — mode buttons unclickable

`.input-dock` has `pointer-events: none` globally so it doesn't intercept scroll events on the message area. `.input-shell` has `pointer-events: auto` to opt back in. The `ModeSelector` was rendered outside `.input-shell`, so it inherited `none`.

**Fix:** added `pointer-events: auto` to `.mode-selector` in `globals.css`.

---

## File tree of all changes

```
backend/
  models.py                    — extended ChatRequest (+mode, +session_id)
  llm.py                       — stream_llm accepts citations + reasoning_summary
  main.py                      — mode prefix injection, reasoning_summary construction
  services/
    __init__.py                — new (package marker)
    modes.py                   — new (MODE_PROMPTS dict)

frontend/src/
  hooks/
    useChat.ts                 — new types (AnswerMode, Citation, ReasoningSummary),
                                 extended UIMessage, mode wired into stream
  lib/
    api.ts                     — extended ChatRequest, SSEToken, StreamMetadata export
  components/
    ModeSelector.tsx           — new
    ReasoningSummary.tsx       — new
    InputDock.tsx              — mode props + ModeSelector rendered inside dock
    ChatApp.tsx                — mode state, passed to useChat and InputDock
    Message.tsx                — ReasoningSummaryBlock rendered per assistant message
  app/
    globals.css                — .mode-selector, .mode-btn, .reasoning-block styles
```

---

## What comes next (from the plan)

- **Phase 4 — RAG backend:** `pypdf` extraction, chunker, Chroma vector store, `/api/rag/upload` and `/api/rag/{id}` endpoints, RAG context injection into `/api/chat`.
- **Phase 5 — RAG frontend:** `useRag` hook, upload button in `InputDock`, file status chips, citations block in `Message`.
- **Phase 6 — Navigation dots:** `MessageNavDots` component using `IntersectionObserver`, message `id` anchors, smooth scroll + highlight.
