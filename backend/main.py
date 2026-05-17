"""Ahmad's Chatbot — FastAPI Backend.

Provides REST + SSE endpoints for the Next.js frontend.
"""

from fastapi import FastAPI, HTTPException
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
from chat_store import (
    list_chats,
    create_chat,
    get_chat,
    update_chat,
    delete_chat,
    add_message_to_chat,
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

    # Build message list with system prompt prepended
    messages = [{"role": "system", "content": request.system_prompt}]
    for msg in request.messages:
        messages.append({"role": msg.role, "content": msg.content})

    logger.info(
        "Chat request: model=%s, temperature=%s, messages=%d",
        request.model, request.temperature, len(messages),
    )

    return StreamingResponse(
        stream_llm(messages, model=request.model, temperature=request.temperature),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
