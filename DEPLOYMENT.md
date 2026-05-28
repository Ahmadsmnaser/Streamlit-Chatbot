# Deployment Guide: Vercel + Render + Neon

This project is prepared for:

- Frontend: Vercel, project root `frontend`
- Backend: Render, Docker service from `backend`
- Database: Neon Postgres

## 1. Create Neon Database

From the repo root, run:

```bash
npx neonctl@latest init
```

Copy the Neon connection string. It usually looks like:

```text
postgresql://USER:PASSWORD@HOST/DB?sslmode=require
```

Use that value directly as `DATABASE_URL`. The backend normalizes it for SQLAlchemy asyncpg.

For local testing against Neon, put the connection string in `backend/.env`, then run migrations from the repo root:

```bash
backend/venv/bin/alembic upgrade head
```

## 2. Deploy Backend To Render

Create a new Render web service from this repository. Use Docker with:

```text
Root Directory: backend
Dockerfile Path: Dockerfile
Health Check Path: /api/health
```

Set these Render environment variables:

```env
GROQ_API_KEY=...
DATABASE_URL=postgresql://...neon...?...sslmode=require
GOOGLE_CLIENT_ID=...
ALLOWED_ORIGINS=http://localhost:3000,https://YOUR-VERCEL-DOMAIN.vercel.app
# Optional: allow Vercel preview/deployment URLs for this project.
ALLOWED_ORIGIN_REGEX=https://ahmadchat-[a-z0-9-]+-ahmad-nasers-projects\.vercel\.app
```

The Docker command runs Alembic migrations before starting FastAPI.

## 3. Deploy Frontend To Vercel

Create a Vercel project with:

```text
Root Directory: frontend
Framework Preset: Next.js
```

Set these Vercel environment variables:

```env
NEXT_PUBLIC_API_URL=https://YOUR-RENDER-SERVICE.onrender.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://YOUR-VERCEL-DOMAIN.vercel.app
```

## 4. Google OAuth Redirects

In Google Cloud Console, add authorized redirect URIs:

```text
http://localhost:3000/api/auth/callback/google
https://YOUR-VERCEL-DOMAIN.vercel.app/api/auth/callback/google
```

Also add authorized JavaScript origins:

```text
http://localhost:3000
https://YOUR-VERCEL-DOMAIN.vercel.app
```

## 5. Final Smoke Test

After both services are deployed:

1. Visit the Vercel URL.
2. Sign in with Google.
3. Create a chat and send a message.
4. Refresh and confirm the chat remains.
5. Change settings and confirm they persist.
6. Upload a RAG file and ask about it.

## Notes

- Render free services may sleep after inactivity, so the first request can be slow.
- Keep `ALLOWED_ORIGINS` updated whenever your Vercel domain changes.
- Do not commit real `.env` files. Use `.env.example` files as templates only.
