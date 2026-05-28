# Ahmad's Chatbot

A production-ready AI chat application built with a Next.js frontend and a FastAPI backend. The app supports Google sign-in, streamed LLM responses, persistent chat history, user settings, multiple answer modes, and session-scoped retrieval over uploaded documents.

## Overview

Ahmad's Chatbot is a full-stack conversational assistant designed as part of the AI Agents Course. It started as a simple chatbot and has evolved into a deployable web app with authentication, database-backed sessions, and RAG-powered file Q&A.

The frontend provides a polished chat experience with streaming messages, markdown rendering, chat management, settings, themes, and document upload controls. The backend exposes a typed REST/SSE API, verifies Google ID tokens, stores user data with SQLAlchemy, streams Groq model output through LangChain, and indexes uploaded documents with Chroma embeddings.

## Features

- Google OAuth sign-in with NextAuth.js
- Per-user chat history, messages, and settings
- Streaming assistant responses over Server-Sent Events
- Multiple answer modes: Simple, Deep, Exam, Code, and Interview
- Groq-hosted model options including Llama, Mixtral, Qwen, Compound, GPT OSS, and ALLaM
- RAG uploads for `.pdf`, `.txt`, and `.md` files up to 10 MB
- Citation metadata and reasoning summaries for uploaded-file answers
- Markdown and code rendering in chat responses
- Chat create, rename, delete, export, regenerate, and cancel controls
- English/Arabic language setting, font size setting, theme selection, and optional sounds
- SQLite for local development and PostgreSQL/Neon for production
- Alembic migrations and Docker-ready backend deployment

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Auth | NextAuth.js v5 with Google OAuth |
| Backend | FastAPI, Pydantic, Uvicorn |
| LLM | Groq via LangChain `ChatGroq` |
| RAG | Chroma, HuggingFace sentence-transformer embeddings, PyPDF |
| Database | SQLAlchemy async ORM, SQLite locally, PostgreSQL/Neon in production |
| Migrations | Alembic |
| Deployment | Vercel frontend, Render Docker backend, Neon Postgres |

## Project Structure

```text
.
├── backend/
│   ├── main.py                 # FastAPI app, chat, RAG, sessions, settings
│   ├── llm.py                  # Groq/LangChain streaming integration
│   ├── auth.py                 # Google ID token verification
│   ├── database.py             # Async SQLAlchemy engine/session setup
│   ├── models_db.py            # ORM models
│   ├── services/
│   │   ├── modes.py            # Answer mode configuration
│   │   └── rag/                # Extraction, chunking, retrieval, citations
│   └── alembic/                # Database migrations
├── frontend/
│   ├── src/app/                # Next.js app router
│   ├── src/components/         # Chat UI components
│   ├── src/hooks/              # Chat, sessions, settings, RAG hooks
│   └── src/lib/                # API client, i18n, markdown helpers
├── DEPLOYMENT.md               # Vercel + Render + Neon deployment guide
├── render.yaml                 # Render backend service definition
└── README.md
```

## Prerequisites

- Python 3.12 recommended
- Node.js 20.9 or newer
- Groq API key
- Google OAuth client ID and secret
- Optional for production: Neon PostgreSQL database

## Local Development

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd chatbot_streamlit
```

### 2. Configure the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Update `backend/.env`:

```env
GROQ_API_KEY=your-groq-api-key
GOOGLE_CLIENT_ID=your-google-client-id
DATABASE_URL=sqlite+aiosqlite:///./data/chatbot.db
ALLOWED_ORIGINS=http://localhost:3000
```

For local SQLite development, the backend creates tables on startup. If you use PostgreSQL locally, run migrations:

```bash
alembic -c alembic.ini upgrade head
```

Start the backend:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`.

### 3. Configure the frontend

In a second terminal:

```bash
cd frontend
npm install
cp .env.example .env.local
```

Update `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
NEXTAUTH_SECRET=generate-a-long-random-secret
NEXTAUTH_URL=http://localhost:3000
```

Start the frontend:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Google OAuth Setup

Create an OAuth client in Google Cloud Console and add these local URLs:

```text
Authorized JavaScript origin:
http://localhost:3000

Authorized redirect URI:
http://localhost:3000/api/auth/callback/google
```

Use the same `GOOGLE_CLIENT_ID` in both backend and frontend env files. The backend validates the Google ID token sent by the frontend on authenticated API requests.

## Environment Variables

### Backend

| Variable | Required | Description |
|---|---:|---|
| `GROQ_API_KEY` | Yes | API key for Groq model inference |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID used to verify ID tokens |
| `DATABASE_URL` | No | Defaults to local SQLite if omitted |
| `ALLOWED_ORIGINS` | No | Comma-separated frontend origins for CORS |
| `ALLOWED_ORIGIN_REGEX` | No | Optional regex for preview deployment origins |
| `FRONTEND_ORIGIN` | No | Convenience default for CORS |

### Frontend

| Variable | Required | Description |
|---|---:|---|
| `NEXT_PUBLIC_API_URL` | Yes | Public URL of the FastAPI backend |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `NEXTAUTH_SECRET` | Yes | Secret used by NextAuth |
| `NEXTAUTH_URL` | Yes | Canonical frontend URL |

## API Highlights

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Backend health check |
| `GET` | `/api/models` | List available LLM models |
| `GET` | `/api/modes` | List answer mode defaults |
| `POST` | `/api/chat` | Stream assistant response as SSE |
| `GET` | `/api/chats` | List the authenticated user's chats |
| `POST` | `/api/chats` | Create a chat session |
| `GET` | `/api/chats/{chat_id}` | Load a chat session |
| `PUT` | `/api/chats/{chat_id}` | Rename or persist chat messages |
| `DELETE` | `/api/chats/{chat_id}` | Delete a chat session |
| `GET` | `/api/settings` | Load user settings |
| `PUT` | `/api/settings` | Update user settings |
| `POST` | `/api/rag/upload` | Upload and index a file for a session |
| `DELETE` | `/api/rag/{session_id}` | Clear uploaded-file context |

Authenticated endpoints expect:

```http
Authorization: Bearer <google-id-token>
```

## RAG Workflow

1. The user uploads a `.pdf`, `.txt`, or `.md` file from a chat session.
2. The backend extracts text, chunks it, and stores embeddings in a Chroma collection scoped to that user and session.
3. On each chat request, the backend retrieves relevant chunks according to the active answer mode.
4. Retrieved context is injected into the system prompt.
5. The streamed response includes citations and a reasoning summary for the frontend.

## Deployment

This repository is prepared for:

- Frontend on Vercel from the `frontend` directory
- Backend on Render using `backend/Dockerfile`
- PostgreSQL on Neon

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full deployment checklist.

## Useful Commands

```bash
# Backend
cd backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
alembic -c alembic.ini upgrade head

# Frontend
cd frontend
npm run dev
npm run build
```

## Notes

- Do not commit real `.env` or `.env.local` files.
- Local SQLite is useful for development; use PostgreSQL for production.
- Uploaded RAG content is currently indexed in runtime Chroma collections, so production persistence depends on the vector-store deployment strategy.
- Render free services may sleep after inactivity, causing the first request to be slower.

## License

This project is for educational purposes as part of the AI Agents Course.
