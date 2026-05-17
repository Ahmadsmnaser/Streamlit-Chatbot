"""Chat session storage — JSON-file-based persistence for chat history."""

import json
import os
import uuid
from datetime import datetime, timezone

from config import CHATS_DIR, logger


def _ensure_dir() -> None:
    """Create the chats directory if it doesn't exist."""
    os.makedirs(CHATS_DIR, exist_ok=True)


def _chat_path(chat_id: str) -> str:
    """Return the file path for a given chat ID."""
    return os.path.join(CHATS_DIR, f"{chat_id}.json")


def _generate_title(messages: list[dict]) -> str:
    """Auto-generate a title from the first user message."""
    for msg in messages:
        if msg.get("role") == "user":
            text = msg["content"].strip()
            return text[:50] + ("…" if len(text) > 50 else "")
    return "New Chat"


# ── CRUD Operations ──────────────────────────────────────────────────────────

def list_chats() -> list[dict]:
    """Return all saved chat sessions, sorted newest first.

    Each item: {id, title, created_at, updated_at, message_count}
    """
    _ensure_dir()
    chats = []
    for filename in os.listdir(CHATS_DIR):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(CHATS_DIR, filename)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            chats.append({
                "id": data["id"],
                "title": data.get("title", "Untitled"),
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
                "message_count": len(data.get("messages", [])),
            })
        except (json.JSONDecodeError, KeyError):
            logger.warning("Skipping corrupt chat file: %s", filename)
    chats.sort(key=lambda c: c.get("updated_at", ""), reverse=True)
    return chats


def create_chat(title: str = "New Chat") -> dict:
    """Create a new empty chat session and return its full data."""
    _ensure_dir()
    chat_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()

    data = {
        "id": chat_id,
        "title": title,
        "created_at": now,
        "updated_at": now,
        "messages": [],
    }

    path = _chat_path(chat_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    logger.info("Created chat: %s", chat_id)
    return data


def get_chat(chat_id: str) -> dict | None:
    """Load a chat session from disk. Returns None if not found."""
    path = _chat_path(chat_id)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def update_chat(chat_id: str, title: str | None = None, messages: list[dict] | None = None) -> dict | None:
    """Update a chat session's title and/or messages. Returns updated data or None."""
    data = get_chat(chat_id)
    if data is None:
        return None

    if title is not None:
        data["title"] = title
    if messages is not None:
        data["messages"] = messages
        # Auto-update title if it was "New Chat" and we now have user messages
        if data["title"] == "New Chat":
            data["title"] = _generate_title(messages)

    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    path = _chat_path(chat_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    logger.info("Updated chat: %s (%d messages)", chat_id, len(data.get("messages", [])))
    return data


def delete_chat(chat_id: str) -> bool:
    """Delete a chat session. Returns True if deleted, False if not found."""
    path = _chat_path(chat_id)
    try:
        os.remove(path)
        logger.info("Deleted chat: %s", chat_id)
        return True
    except FileNotFoundError:
        return False


def add_message_to_chat(chat_id: str, role: str, content: str, metadata: dict | None = None) -> dict | None:
    """Append a message to a chat and save. Returns updated data or None."""
    data = get_chat(chat_id)
    if data is None:
        return None

    msg: dict = {"role": role, "content": content}
    if metadata:
        msg["metadata"] = metadata
    data["messages"].append(msg)

    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Auto-update title from first user message
    if data["title"] == "New Chat" and role == "user":
        data["title"] = _generate_title(data["messages"])

    path = _chat_path(chat_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return data
