"""Ahmad's Chatbot — FastAPI Backend.

Provides REST + SSE endpoints for the Next.js frontend.
"""

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from config import AVAILABLE_MODELS, FRONTEND_ORIGIN, MAX_INPUT_LENGTH, logger
from models import (
    ChatRequest,
    ChatSessionCreate,
    ChatSessionUpdate,
    ChatSessionResponse,
    ChatSessionDetail,
    ModelInfo,
)
from llm import stream_llm
from services.modes import MODE_PROMPTS
from services.rag.extractor import extract_text
from services.rag.chunker import chunk_pages
from services.rag.store import RAGStore
from services.rag.context_builder import build_context_prompt
from services.rag.citation_formatter import format_citations
from chat_store import (
    list_chats,
    create_chat,
    get_chat,
    update_chat,
    delete_chat,
)


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Ahmad's Chatbot API",
    description="Backend API for the AI chatbot powered by Groq + LangChain",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory registry: session_id -> RAGStore
_rag_stores: dict[str, RAGStore] = {}


# ── Health Check ──────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


# ── Models ────────────────────────────────────────────────────────────────────

@app.get("/api/models", response_model=list[ModelInfo])
async def get_models():
    """Return available LLM models."""
    return AVAILABLE_MODELS


# ── Chat (Streaming) ─────────────────────────────────────────────────────────

@app.post("/api/chat")
async def chat_stream(request: ChatRequest):
    """Stream a chat response as Server-Sent Events.

    The client sends the full message history and receives streamed tokens.
    Each SSE event is a JSON object:
      - {token: "...", done: false}     — a content chunk
      - {token: "", done: true, metadata: {...}} — stream complete
      - {error: "..."}                  — error occurred
    """
    # Validate the last user message length
    user_messages = [m for m in request.messages if m.role == "user"]
    if user_messages:
        last_msg = user_messages[-1]
        if len(last_msg.content) > MAX_INPUT_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Message too long ({len(last_msg.content)} chars). Max: {MAX_INPUT_LENGTH}",
            )

    citations: list[dict] = []
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
            base_system = context_block + "\n\n" + request.system_prompt
        else:
            base_system = request.system_prompt
    else:
        base_system = request.system_prompt

    # Prepend mode instruction to system prompt
    mode_prefix = MODE_PROMPTS.get(request.mode, "")
    system = f"{mode_prefix}\n\n{base_system}".strip() if mode_prefix else base_system

    # Build reasoning summary
    reasoning_summary = {
        "mode": request.mode,
        "usedUploadedFiles": rag_used,
        "retrievedChunks": len(citations) if rag_used else 0,
        "usedFiles": list({c["fileName"] for c in citations}) if rag_used else [],
        "basis": "uploaded_files" if rag_used else "general_knowledge",
        "confidence": "high" if rag_used and len(citations) >= 3 else "medium",
    }

    # Build message list with system prompt prepended
    messages = [{"role": "system", "content": system}]
    for msg in request.messages:
        messages.append({"role": msg.role, "content": msg.content})

    logger.info(
        "Chat request: model=%s, mode=%s, temperature=%s, messages=%d",
        request.model, request.mode, request.temperature, len(messages),
    )

    return StreamingResponse(
        stream_llm(
            messages,
            model=request.model,
            temperature=request.temperature,
            citations=citations,
            reasoning_summary=reasoning_summary,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── RAG Upload ────────────────────────────────────────────────────────────────

_ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md"}


@app.post("/api/rag/upload")
async def upload_file(
    session_id: str = Form(...),
    file: UploadFile = File(...),
):
    """Extract, chunk, embed, and index an uploaded file for a session."""
    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else ""
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext or '(none)'}")

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

    logger.info("RAG upload: session=%s, file=%s, chunks=%d", session_id, file.filename, len(chunks))
    return {"status": "ready", "fileName": file.filename, "chunks": len(chunks)}


@app.delete("/api/rag/{session_id}")
async def clear_rag(session_id: str):
    """Clear indexed files for a session."""
    if session_id in _rag_stores:
        _rag_stores[session_id].clear()
        del _rag_stores[session_id]
    return {"status": "cleared"}


# ── Chat Sessions CRUD ───────────────────────────────────────────────────────

@app.get("/api/chats", response_model=list[ChatSessionResponse])
async def list_chat_sessions():
    """List all chat sessions, sorted newest first."""
    return list_chats()


@app.post("/api/chats", response_model=ChatSessionDetail, status_code=201)
async def create_chat_session(body: ChatSessionCreate | None = None):
    """Create a new empty chat session."""
    title = body.title if body else "New Chat"
    data = create_chat(title=title)
    data["message_count"] = len(data.get("messages", []))
    return data


@app.get("/api/chats/{chat_id}", response_model=ChatSessionDetail)
async def get_chat_session(chat_id: str):
    """Get a chat session by ID, including all messages."""
    data = get_chat(chat_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    data["message_count"] = len(data.get("messages", []))
    return data


@app.put("/api/chats/{chat_id}", response_model=ChatSessionDetail)
async def update_chat_session(chat_id: str, body: ChatSessionUpdate):
    """Update a chat session's title and/or messages."""
    messages_dicts = None
    if body.messages is not None:
        messages_dicts = [m.model_dump() for m in body.messages]

    data = update_chat(chat_id, title=body.title, messages=messages_dicts)
    if data is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    data["message_count"] = len(data.get("messages", []))
    return data


@app.delete("/api/chats/{chat_id}")
async def delete_chat_session(chat_id: str):
    """Delete a chat session."""
    deleted = delete_chat(chat_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Chat not found")
    return {"status": "deleted", "id": chat_id}
