"""Authentication helpers for Google ID tokens."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import GOOGLE_CLIENT_ID
from database import get_db
from models_db import User


bearer_scheme = HTTPBearer(auto_error=False)


async def get_or_create_user(
    db: AsyncSession,
    *,
    user_id: str,
    email: str,
    name: str | None = None,
    avatar_url: str | None = None,
) -> User:
    user = await db.get(User, user_id)
    if user is None:
        existing = await db.execute(select(User).where(User.email == email))
        user = existing.scalar_one_or_none()

    if user is None:
        user = User(id=user_id, email=email, name=name, avatar_url=avatar_url)
        db.add(user)
    else:
        user.email = email
        user.name = name
        user.avatar_url = avatar_url

    await db.commit()
    await db.refresh(user)
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GOOGLE_CLIENT_ID is not configured",
        )

    try:
        payload = id_token.verify_oauth2_token(
            credentials.credentials,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    email = payload.get("email")
    subject = payload.get("sub")
    if not email or not subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token missing identity")

    if payload.get("email_verified") is False:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google email is not verified")

    return await get_or_create_user(
        db,
        user_id=subject,
        email=email,
        name=payload.get("name"),
        avatar_url=payload.get("picture"),
    )
