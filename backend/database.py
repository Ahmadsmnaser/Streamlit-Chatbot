"""Async database session setup for the FastAPI backend."""

import os
from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from config import DATA_DIR, DATABASE_URL
from models_db import Base


if DATABASE_URL.startswith("sqlite"):
    os.makedirs(DATA_DIR, exist_ok=True)

engine = create_async_engine(DATABASE_URL, echo=False, future=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    """Yield a request-scoped async database session."""
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    """Create tables for local SQLite development.

    Production deployments should run Alembic migrations instead.
    """
    if not DATABASE_URL.startswith("sqlite"):
        return

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        result = await conn.execute(text("PRAGMA table_info(user_settings)"))
        columns = {row[1] for row in result.fetchall()}
        if "nickname" not in columns:
            await conn.execute(text("ALTER TABLE user_settings ADD COLUMN nickname VARCHAR(120) NOT NULL DEFAULT 'User'"))
