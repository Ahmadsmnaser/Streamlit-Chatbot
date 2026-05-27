"""Configuration — environment variables, constants, and logging for the backend."""

import logging
import os
import sys
from dotenv import load_dotenv

# Load .env from backend dir first, then project root as fallback
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# ── API Keys ──────────────────────────────────────────────────────────────────
GROQ_API_KEY: str | None = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    print("ERROR: GROQ_API_KEY is not set.")
    sys.exit(1)

# ── CORS ──────────────────────────────────────────────────────────────────────
FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")

# ── Model Defaults ────────────────────────────────────────────────────────────
DEFAULT_MODEL: str = "llama-3.1-8b-instant"
DEFAULT_TEMPERATURE: float = 0.0
DEFAULT_SYSTEM_PROMPT: str = "You are a helpful assistant."

# ── Available Models ──────────────────────────────────────────────────────────
AVAILABLE_MODELS: list[dict] = [
    {
        "id": "llama-3.1-8b-instant",
        "name": "Llama 3.1 8B Instant",
        "description": "Best for speed — fastest responses for everyday questions",
    },
    {
        "id": "llama-3.3-70b-versatile",
        "name": "Llama 3.3 70B Versatile",
        "description": "Best all-rounder — strong reasoning, writing, and analysis",
    },
    {
        "id": "meta-llama/llama-4-scout-17b-16e-instruct",
        "name": "Llama 4 Scout 17B",
        "description": "Best for long documents — 10M token context window",
    },
    {
        "id": "mixtral-8x7b-32768",
        "name": "Mixtral 8x7B",
        "description": "Best for multilingual — strong across many languages with 32K context",
    },
    {
        "id": "qwen/qwen3-32b",
        "name": "Qwen3 32B",
        "description": "Best for reading files — deep comprehension and structured extraction",
    },
    {
        "id": "groq/compound",
        "name": "Groq Compound",
        "description": "Best for complex tasks — multi-step reasoning and tool use",
    },
    {
        "id": "groq/compound-mini",
        "name": "Groq Compound Mini",
        "description": "Best for quick reasoning — compound intelligence at faster speed",
    },
    {
        "id": "openai/gpt-oss-120b",
        "name": "GPT OSS 120B",
        "description": "Best for accuracy — OpenAI's largest open-source model",
    },
    {
        "id": "openai/gpt-oss-20b",
        "name": "GPT OSS 20B",
        "description": "Best balance — OpenAI quality at a lighter, faster size",
    },
    {
        "id": "allam-2-7b",
        "name": "ALLaM 2 7B",
        "description": "Best for Arabic — purpose-built for Arabic language and culture",
    },
]

# ── Limits ────────────────────────────────────────────────────────────────────
MAX_HISTORY_LENGTH: int = 40
MAX_INPUT_LENGTH: int = 4000

# ── Data ──────────────────────────────────────────────────────────────────────
DATA_DIR: str = os.path.join(os.path.dirname(__file__), "data")
CHATS_DIR: str = os.path.join(DATA_DIR, "chats")

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_FORMAT: str = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"


def setup_logging() -> logging.Logger:
    """Configure and return the application logger."""
    logger = logging.getLogger("chatbot_api")
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)

    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter(LOG_FORMAT))
    logger.addHandler(ch)

    return logger


logger: logging.Logger = setup_logging()
