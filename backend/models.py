"""Pydantic models for API request/response validation."""

from pydantic import BaseModel, Field


# ── Chat Request / Response ───────────────────────────────────────────────────

class MessagePayload(BaseModel):
    """A single message in the conversation."""
    role: str = Field(..., pattern="^(system|user|assistant)$")
    content: str = Field(..., min_length=1, max_length=50000)


class ChatRequest(BaseModel):
    """Request body for the POST /api/chat endpoint."""
    messages: list[MessagePayload] = Field(..., min_length=1)
    model: str = Field(default="llama-3.1-8b-instant")
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    system_prompt: str = Field(default="You are a helpful assistant.", max_length=2000)
    mode: str = Field(default="simple")
    session_id: str | None = None


# ── Chat Session Models ──────────────────────────────────────────────────────

class ChatSessionCreate(BaseModel):
    """Request body for creating a new chat session."""
    title: str = Field(default="New Chat", max_length=200)


class ChatSessionUpdate(BaseModel):
    """Request body for updating a chat session."""
    title: str | None = Field(default=None, max_length=200)
    messages: list[MessagePayload] | None = None


class ChatSessionResponse(BaseModel):
    """Response for a single chat session."""
    id: str
    title: str
    created_at: str
    updated_at: str
    message_count: int


class ChatSessionDetail(ChatSessionResponse):
    """Full chat session including messages."""
    messages: list[dict]


# ── Models Endpoint ──────────────────────────────────────────────────────────

class ModelInfo(BaseModel):
    """Information about an available LLM model."""
    id: str
    name: str
    description: str


# ── Modes Endpoint ────────────────────────────────────────────────────────────

class ModeConfigResponse(BaseModel):
    """Public metadata for a single answer mode (excludes internal prompt)."""
    label: str
    description: str
    model: str
    model_short: str
    temperature: float
    max_tokens: int
    rag_top_k: int


# ── User Settings ─────────────────────────────────────────────────────────────

class UserSettingsPayload(BaseModel):
    """Request body for updating user settings."""
    lang: str | None = Field(default=None, pattern="^(en|ar)$")
    fontSize: str | None = Field(default=None, pattern="^(small|medium|large)$")
    nickname: str | None = Field(default=None, max_length=120)
    soundsEnabled: bool | None = None


class UserSettingsResponse(BaseModel):
    """Persisted user settings response."""
    lang: str
    fontSize: str
    nickname: str
    soundsEnabled: bool
