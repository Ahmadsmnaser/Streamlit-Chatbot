"""Database-backed chat session persistence."""

import json
import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import Select, delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from config import CHATS_DIR, LOCAL_USER_ID, logger
from models_db import Chat, Message, User


LOCAL_USER_EMAIL = "local@example.invalid"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_dt(value: datetime) -> str:
    return value.isoformat()


def _parse_dt(value: str | None) -> datetime:
    if not value:
        return _now()
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return _now()


def _generate_title(messages: list[dict]) -> str:
    """Auto-generate a title from the first user message."""
    for msg in messages:
        if msg.get("role") == "user":
            text = msg["content"].strip()
            return text[:50] + ("..." if len(text) > 50 else "")
    return "New Chat"


async def ensure_local_user(db: AsyncSession, user_id: str = LOCAL_USER_ID) -> User:
    """Return the current unauthenticated local user, creating it if needed."""
    user = await db.get(User, user_id)
    if user:
        return user

    user = User(id=user_id, email=LOCAL_USER_EMAIL, name="Local User")
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _chat_query(chat_id: str, user_id: str) -> Select[tuple[Chat]]:
    return (
        select(Chat)
        .options(selectinload(Chat.messages))
        .where(Chat.id == chat_id, Chat.user_id == user_id)
    )


def _message_to_dict(message: Message) -> dict:
    data: dict = {
        "role": message.role,
        "content": message.content,
    }
    if message.reasoning is not None:
        data["reasoning"] = message.reasoning
    if message.citations is not None:
        data["citations"] = message.citations
    return data


def _chat_to_summary(chat: Chat) -> dict:
    return {
        "id": chat.id,
        "title": chat.title,
        "created_at": _serialize_dt(chat.created_at),
        "updated_at": _serialize_dt(chat.updated_at),
        "message_count": len(chat.messages),
    }


def _chat_to_detail(chat: Chat) -> dict:
    return {
        **_chat_to_summary(chat),
        "messages": [_message_to_dict(message) for message in chat.messages],
    }


async def migrate_legacy_chats(db: AsyncSession, user_id: str = LOCAL_USER_ID) -> int:
    """Import legacy JSON chat files into the database once."""
    if not os.path.isdir(CHATS_DIR):
        return 0

    await ensure_local_user(db, user_id)
    imported = 0

    for filename in os.listdir(CHATS_DIR):
        if not filename.endswith(".json"):
            continue

        path = os.path.join(CHATS_DIR, filename)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            logger.warning("Skipping corrupt legacy chat file: %s", filename)
            continue

        chat_id = data.get("id")
        if not chat_id or await db.get(Chat, chat_id):
            continue

        chat = Chat(
            id=chat_id,
            user_id=user_id,
            title=data.get("title") or "Untitled",
            created_at=_parse_dt(data.get("created_at")),
            updated_at=_parse_dt(data.get("updated_at")),
        )
        chat.messages = [
            Message(
                chat_id=chat_id,
                role=msg.get("role", "user"),
                content=msg.get("content", ""),
                reasoning=msg.get("reasoning") or msg.get("reasoningSummary"),
                citations=msg.get("citations"),
                position=index,
            )
            for index, msg in enumerate(data.get("messages", []))
            if msg.get("content")
        ]
        db.add(chat)
        imported += 1

    if imported:
        await db.commit()
        logger.info("Imported %d legacy chat files into the database", imported)

    return imported


async def list_chats(db: AsyncSession, user_id: str = LOCAL_USER_ID) -> list[dict]:
    """Return all saved chat sessions for a user, sorted newest first."""
    await ensure_local_user(db, user_id)
    result = await db.execute(
        select(Chat)
        .options(selectinload(Chat.messages))
        .where(Chat.user_id == user_id)
        .order_by(Chat.updated_at.desc())
    )
    return [_chat_to_summary(chat) for chat in result.scalars().all()]


async def create_chat(db: AsyncSession, title: str = "New Chat", user_id: str = LOCAL_USER_ID) -> dict:
    """Create a new empty chat session and return its full data."""
    await ensure_local_user(db, user_id)

    now = _now()
    chat = Chat(
        id=uuid.uuid4().hex[:12],
        user_id=user_id,
        title=title,
        created_at=now,
        updated_at=now,
    )
    db.add(chat)
    await db.commit()
    await db.refresh(chat, attribute_names=["messages"])

    logger.info("Created chat: %s", chat.id)
    return _chat_to_detail(chat)


async def get_chat(db: AsyncSession, chat_id: str, user_id: str = LOCAL_USER_ID) -> dict | None:
    """Load a chat session. Returns None if not found."""
    await ensure_local_user(db, user_id)
    result = await db.execute(_chat_query(chat_id, user_id))
    chat = result.scalar_one_or_none()
    return _chat_to_detail(chat) if chat else None


async def update_chat(
    db: AsyncSession,
    chat_id: str,
    title: str | None = None,
    messages: list[dict] | None = None,
    user_id: str = LOCAL_USER_ID,
) -> dict | None:
    """Update a chat session's title and/or messages. Returns updated data or None."""
    await ensure_local_user(db, user_id)
    result = await db.execute(_chat_query(chat_id, user_id))
    chat = result.scalar_one_or_none()
    if chat is None:
        return None

    if title is not None:
        chat.title = title
    if messages is not None:
        await db.execute(delete(Message).where(Message.chat_id == chat_id))
        chat.messages = [
            Message(
                chat_id=chat_id,
                role=msg["role"],
                content=msg["content"],
                reasoning=msg.get("reasoning") or msg.get("reasoningSummary"),
                citations=msg.get("citations"),
                position=index,
            )
            for index, msg in enumerate(messages)
        ]
        if chat.title == "New Chat":
            chat.title = _generate_title(messages)

    chat.updated_at = _now()
    await db.commit()

    result = await db.execute(_chat_query(chat_id, user_id))
    updated = result.scalar_one()
    logger.info("Updated chat: %s (%d messages)", chat_id, len(updated.messages))
    return _chat_to_detail(updated)


async def delete_chat(db: AsyncSession, chat_id: str, user_id: str = LOCAL_USER_ID) -> bool:
    """Delete a chat session. Returns True if deleted, False if not found."""
    await ensure_local_user(db, user_id)
    result = await db.execute(_chat_query(chat_id, user_id))
    chat = result.scalar_one_or_none()
    if chat is None:
        return False

    await db.delete(chat)
    await db.commit()
    logger.info("Deleted chat: %s", chat_id)
    return True


async def add_message_to_chat(
    db: AsyncSession,
    chat_id: str,
    role: str,
    content: str,
    metadata: dict | None = None,
    user_id: str = LOCAL_USER_ID,
) -> dict | None:
    """Append a message to a chat and save. Returns updated data or None."""
    await ensure_local_user(db, user_id)
    result = await db.execute(_chat_query(chat_id, user_id))
    chat = result.scalar_one_or_none()
    if chat is None:
        return None

    message = Message(
        chat_id=chat_id,
        role=role,
        content=content,
        reasoning=metadata.get("reasoning") if metadata else None,
        citations=metadata.get("citations") if metadata else None,
        position=len(chat.messages),
    )
    chat.messages.append(message)
    chat.updated_at = _now()

    if chat.title == "New Chat" and role == "user":
        chat.title = _generate_title([_message_to_dict(m) for m in chat.messages])

    await db.commit()
    result = await db.execute(_chat_query(chat_id, user_id))
    return _chat_to_detail(result.scalar_one())
