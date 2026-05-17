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
        "description": "Fast and efficient, great for most tasks",
    },
    {
        "id": "llama-3.3-70b-versatile",
        "name": "Llama 3.3 70B Versatile",
        "description": "Larger model, better reasoning and quality",
    },
    {
        "id": "mixtral-8x7b-32768",
        "name": "Mixtral 8x7B",
        "description": "Mixture-of-experts model with 32K context",
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
