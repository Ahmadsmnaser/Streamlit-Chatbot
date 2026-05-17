"""LLM module — LangChain ChatGroq wrapper for the FastAPI backend."""

import time
from typing import AsyncGenerator
from collections.abc import AsyncIterator

from langchain_groq import ChatGroq
from groq import RateLimitError, APIError

from config import DEFAULT_MODEL, DEFAULT_TEMPERATURE, logger


# ── LLM Instance Cache ───────────────────────────────────────────────────────
_llm_cache: dict[str, ChatGroq] = {}


def get_llm(model: str = DEFAULT_MODEL, temperature: float = DEFAULT_TEMPERATURE) -> ChatGroq:
    """Return a ChatGroq instance, cached by (model, temperature) key."""
    cache_key = f"{model}:{temperature}"
    if cache_key not in _llm_cache:
        logger.info("Creating LLM instance: model=%s, temperature=%s", model, temperature)
        _llm_cache[cache_key] = ChatGroq(model=model, temperature=temperature)
    return _llm_cache[cache_key]


def invoke_llm(
    messages: list[dict],
    model: str = DEFAULT_MODEL,
    temperature: float = DEFAULT_TEMPERATURE,
) -> dict:
    """Send messages to the LLM and return the response with metadata.

    Returns:
        dict with keys: content, model, time, tokens
    """
    llm = get_llm(model, temperature)
    start = time.time()

    response = llm.invoke(messages)
    elapsed = time.time() - start

    token_info = response.response_metadata.get("token_usage", {})
    logger.info(
        "LLM response: model=%s, time=%.2fs, tokens=%s",
        model, elapsed, token_info,
    )

    return {
        "content": response.content,
        "model": model,
        "time": round(elapsed, 2),
        "tokens": token_info,
    }


async def stream_llm(
    messages: list[dict],
    model: str = DEFAULT_MODEL,
    temperature: float = DEFAULT_TEMPERATURE,
) -> AsyncGenerator[str, None]:
    """Stream tokens from the LLM as Server-Sent Events.

    Yields SSE-formatted strings: 'data: {"token": "...", "done": false}\n\n'
    """
    import json

    llm = get_llm(model, temperature)
    start = time.time()

    try:
        async for chunk in llm.astream(messages):
            if chunk.content:
                event = json.dumps({"token": chunk.content, "done": False})
                yield f"data: {event}\n\n"

        elapsed = time.time() - start
        logger.info("LLM stream complete: model=%s, time=%.2fs", model, elapsed)

        # Final event with metadata
        done_event = json.dumps({
            "token": "",
            "done": True,
            "metadata": {
                "model": model,
                "time": round(elapsed, 2),
            },
        })
        yield f"data: {done_event}\n\n"

    except RateLimitError:
        logger.warning("Rate limit hit for model=%s", model)
        error_event = json.dumps({"error": "Rate limit reached. Please wait and try again."})
        yield f"data: {error_event}\n\n"

    except APIError as e:
        logger.error("Groq API error: %s", e)
        error_msg = e.message if hasattr(e, "message") else str(e)
        error_event = json.dumps({"error": f"API error: {error_msg}"})
        yield f"data: {error_event}\n\n"

    except Exception as e:
        logger.exception("Unexpected error during LLM streaming")
        error_event = json.dumps({"error": f"Something went wrong: {str(e)}"})
        yield f"data: {error_event}\n\n"
