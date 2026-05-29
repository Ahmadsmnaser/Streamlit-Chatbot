"""Ahmad's Chatbot — FastAPI Backend.

Provides REST + SSE endpoints for the Next.js frontend.
"""

from fastapi import Depends, FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from urllib.parse import unquote
from sqlalchemy.ext.asyncio import AsyncSession

from config import ALLOWED_ORIGIN_REGEX, ALLOWED_ORIGINS, AVAILABLE_MODELS, MAX_INPUT_LENGTH, MAX_UPLOAD_SIZE_BYTES, logger
from auth import get_current_user
from database import AsyncSessionLocal, get_db, init_db
from models import (
    ChatRequest,
    ChatSessionCreate,
    ChatSessionUpdate,
    ChatSessionResponse,
    ChatSessionDetail,
    ModelInfo,
    ModeConfigResponse,
    UserSettingsPayload,
    UserSettingsResponse,
)
from llm import stream_llm
from models_db import User
from services.modes import MODES, get_mode
from services.rag.extractor import extract_text
from services.rag.chunker import chunk_pages
from services.rag.store import RAGStore
from services.rag.context_builder import build_context_prompt
from services.rag.citation_formatter import format_citations
from services.profile.schemas import AskAhmadRequest
from services.profile.store import get_profile_store, search_profile
from services.profile.prompt import build_system_prompt, build_context_block
from settings_store import get_user_settings, settings_to_dict, update_user_settings
from chat_store import (
    list_chats,
    create_chat,
    get_chat,
    update_chat,
    delete_chat,
    migrate_legacy_chats,
)


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Ahmad's Chatbot API",
    description="Backend API for the AI chatbot powered by Groq + LangChain",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory registry: user_id:session_id -> RAGStore
_rag_stores: dict[str, RAGStore] = {}


def _rag_key(user_id: str, session_id: str) -> str:
    return f"{user_id}:{session_id}"


@app.on_event("startup")
async def startup() -> None:
    await init_db()
    async with AsyncSessionLocal() as db:
        await migrate_legacy_chats(db)
    # Build the profile RAG index eagerly so the first public request is fast
    get_profile_store()


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


@app.get("/api/modes", response_model=dict[str, ModeConfigResponse])
async def get_modes():
    """Return public metadata for all answer modes."""
    return {
        mode_id: ModeConfigResponse(
            label=cfg["label"],
            description=cfg["description"],
            model=cfg["model"],
            model_short=cfg["model_short"],
            temperature=cfg["temperature"],
            max_tokens=cfg["max_tokens"],
            rag_top_k=cfg["rag_top_k"],
        )
        for mode_id, cfg in MODES.items()
    }


# ── Chat (Streaming) ─────────────────────────────────────────────────────────

@app.post("/api/chat")
async def chat_stream(request: ChatRequest, current_user: User = Depends(get_current_user)):
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

    mode_cfg = get_mode(request.mode)

    citations: list[dict] = []
    rag_used = False

    # RAG context injection using mode-specific top_k
    rag_key = _rag_key(current_user.id, request.session_id) if request.session_id else None
    if rag_key and rag_key in _rag_stores:
        store = _rag_stores[rag_key]
        last_user_msg = next(
            (m.content for m in reversed(request.messages) if m.role == "user"), ""
        )
        retrieved = await store.search(last_user_msg, top_k=mode_cfg["rag_top_k"])
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
    mode_prompt = mode_cfg["prompt"]
    system = f"{mode_prompt}\n\n{base_system}".strip()

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
        "Chat request: model=%s, mode=%s, temperature=%s, max_tokens=%d, messages=%d",
        request.model, request.mode, request.temperature, mode_cfg["max_tokens"], len(messages),
    )

    return StreamingResponse(
        stream_llm(
            messages,
            model=request.model,
            temperature=request.temperature,
            max_tokens=mode_cfg["max_tokens"],
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
    current_user: User = Depends(get_current_user),
):
    """Extract, chunk, embed, and index an uploaded file for a session."""
    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else ""
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext or '(none)'}")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(413, "File too large. Max upload size is 10 MB.")

    try:
        pages = extract_text(content, file.filename)
        chunks = chunk_pages(pages)
    except ValueError as e:
        raise HTTPException(422, str(e))

    rag_key = _rag_key(current_user.id, session_id)
    store = _rag_stores.setdefault(rag_key, RAGStore(rag_key))
    await store.add_chunks(chunks)

    logger.info("RAG upload: session=%s, file=%s, chunks=%d", session_id, file.filename, len(chunks))
    return {"status": "ready", "fileName": file.filename, "chunks": len(chunks)}


@app.delete("/api/rag/{session_id}/files/{file_name:path}")
async def delete_rag_file(
    session_id: str,
    file_name: str,
    current_user: User = Depends(get_current_user),
):
    """Delete indexed chunks for one uploaded file in a session."""
    decoded_file_name = unquote(file_name)
    rag_key = _rag_key(current_user.id, session_id)
    if rag_key in _rag_stores:
        await _rag_stores[rag_key].delete_file(decoded_file_name)
    return {"status": "deleted", "fileName": decoded_file_name}


@app.delete("/api/rag/{session_id}")
async def clear_rag(session_id: str, current_user: User = Depends(get_current_user)):
    """Clear indexed files for a session."""
    rag_key = _rag_key(current_user.id, session_id)
    if rag_key in _rag_stores:
        _rag_stores[rag_key].clear()
        del _rag_stores[rag_key]
    return {"status": "cleared"}


# ── Public: Ask Ahmad ────────────────────────────────────────────────────────

@app.post("/api/public/ask-ahmad")
async def ask_ahmad_public(request: AskAhmadRequest):
    """Public endpoint — no auth required.

    Answers questions about Ahmad Naser using only the verified Profile RAG.
    Never accesses private user chats or user-uploaded files.
    Streams response as Server-Sent Events identical in shape to /api/chat.
    """
    if len(request.question) > MAX_INPUT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Question too long ({len(request.question)} chars). Max: {MAX_INPUT_LENGTH}",
        )

    retrieved = await search_profile(request.question, top_k=5)

    context_block = build_context_block(retrieved)
    system_prompt = build_system_prompt(request.mode)

    if request.mode == "job_match" and request.job_description:
        jd_block = f"\n\n## Job Description Provided by Recruiter\n{request.job_description}"
        system_prompt = system_prompt + jd_block

    system = (context_block + "\n\n" + system_prompt).strip() if context_block else system_prompt

    citations = [
        {
            "fileName": c["source_file"],
            "pageNumber": None,
            "snippet": c["text"][:200],
            "score": c["score"],
            "sectionTitle": c.get("section_title"),
        }
        for c in retrieved
    ]

    grounded = len(retrieved) > 0
    confidence: str
    if grounded and len(retrieved) >= 3:
        confidence = "high"
    elif grounded:
        confidence = "medium"
    else:
        confidence = "low"

    reasoning_summary = {
        "mode": f"public:{request.mode}",
        "usedUploadedFiles": False,
        "retrievedChunks": len(citations),
        "usedFiles": list({c["source_file"] for c in retrieved}),
        "basis": "profile_knowledge_base" if grounded else "no_profile_data",
        "confidence": confidence,
        "grounded": grounded,
    }

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": request.question},
    ]

    logger.info(
        "Public ask-ahmad: mode=%s, grounded=%s, chunks=%d",
        request.mode, grounded, len(retrieved),
    )

    return StreamingResponse(
        stream_llm(
            messages,
            model="llama-3.3-70b-versatile",
            temperature=0.3,
            max_tokens=1024,
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


# ── Chat Sessions CRUD ───────────────────────────────────────────────────────

@app.get("/api/chats", response_model=list[ChatSessionResponse])
async def list_chat_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all chat sessions, sorted newest first."""
    return await list_chats(db, user_id=current_user.id)


@app.post("/api/chats", response_model=ChatSessionDetail, status_code=201)
async def create_chat_session(
    body: ChatSessionCreate | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new empty chat session."""
    title = body.title if body else "New Chat"
    data = await create_chat(db, title=title, user_id=current_user.id)
    data["message_count"] = len(data.get("messages", []))
    return data


@app.get("/api/chats/{chat_id}", response_model=ChatSessionDetail)
async def get_chat_session(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a chat session by ID, including all messages."""
    data = await get_chat(db, chat_id, user_id=current_user.id)
    if data is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    data["message_count"] = len(data.get("messages", []))
    return data


@app.put("/api/chats/{chat_id}", response_model=ChatSessionDetail)
async def update_chat_session(
    chat_id: str,
    body: ChatSessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a chat session's title and/or messages."""
    messages_dicts = None
    if body.messages is not None:
        messages_dicts = [m.model_dump() for m in body.messages]

    data = await update_chat(db, chat_id, title=body.title, messages=messages_dicts, user_id=current_user.id)
    if data is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    data["message_count"] = len(data.get("messages", []))
    return data


@app.delete("/api/chats/{chat_id}")
async def delete_chat_session(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a chat session."""
    deleted = await delete_chat(db, chat_id, user_id=current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Chat not found")
    return {"status": "deleted", "id": chat_id}


# ── User Settings ─────────────────────────────────────────────────────────────

@app.get("/api/settings", response_model=UserSettingsResponse)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    settings = await get_user_settings(db, current_user.id)
    return settings_to_dict(settings)


@app.put("/api/settings", response_model=UserSettingsResponse)
async def put_settings(
    body: UserSettingsPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    settings = await update_user_settings(db, current_user.id, body.model_dump(exclude_unset=True))
    return settings_to_dict(settings)
