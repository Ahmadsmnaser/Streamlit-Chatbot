"""Database-backed user settings persistence."""

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from models_db import UserSettings


def _now() -> datetime:
    return datetime.now(timezone.utc)


def settings_to_dict(settings: UserSettings) -> dict:
    return {
        "lang": settings.language,
        "fontSize": settings.font_size,
        "nickname": settings.nickname,
        "soundsEnabled": settings.sound,
    }


async def get_user_settings(db: AsyncSession, user_id: str) -> UserSettings:
    settings = await db.get(UserSettings, user_id)
    if settings is None:
        settings = UserSettings(user_id=user_id)
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
    return settings


async def update_user_settings(db: AsyncSession, user_id: str, updates: dict) -> UserSettings:
    settings = await get_user_settings(db, user_id)

    if "lang" in updates and updates["lang"] is not None:
        settings.language = updates["lang"]
    if "fontSize" in updates and updates["fontSize"] is not None:
        settings.font_size = updates["fontSize"]
    if "nickname" in updates and updates["nickname"] is not None:
        settings.nickname = updates["nickname"]
    if "soundsEnabled" in updates and updates["soundsEnabled"] is not None:
        settings.sound = updates["soundsEnabled"]

    settings.updated_at = _now()
    await db.commit()
    await db.refresh(settings)
    return settings
