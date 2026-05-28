"""LLM module — LangChain ChatGroq wrapper for the FastAPI backend."""

import time
from typing import AsyncGenerator

from langchain_groq import ChatGroq
from groq import RateLimitError, APIError

from config import DEFAULT_MODEL, DEFAULT_TEMPERATURE, logger


# ── LLM Instance Cache ───────────────────────────────────────────────────────
_llm_cache: dict[str, ChatGroq] = {}


def get_llm(
    model: str = DEFAULT_MODEL,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int | None = None,
) -> ChatGroq:
    """Return a ChatGroq instance, cached by (model, temperature, max_tokens) key."""
    cache_key = f"{model}:{temperature}:{max_tokens}"
    if cache_key not in _llm_cache:
        logger.info("Creating LLM instance: model=%s, temperature=%s, max_tokens=%s", model, temperature, max_tokens)
        kwargs: dict = {"model": model, "temperature": temperature}
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        _llm_cache[cache_key] = ChatGroq(**kwargs)
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


_THINK_OPEN = "<think>"
_THINK_CLOSE = "</think>"


async def stream_llm(
    messages: list[dict],
    model: str = DEFAULT_MODEL,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int | None = None,
    citations: list[dict] | None = None,
    reasoning_summary: dict | None = None,
) -> AsyncGenerator[str, None]:
    """Stream tokens from the LLM as Server-Sent Events.

    Yields SSE-formatted strings:
      'data: {"token": "...", "done": false}\n\n'           — answer chunk
      'data: {"thinking_chunk": "...", "done": false}\n\n'  — thinking chunk (hidden from bubble)
      'data: {"token": "", "done": true, "metadata": {...}}\n\n' — stream complete
    """
    import json

    llm = get_llm(model, temperature, max_tokens)
    start = time.time()

    # State machine for <think>...</think> detection.
    # We buffer the start of the stream until we know whether this is a
    # thinking model (starts with <think>) or a normal model.
    buf = ""
    in_think = False
    think_done = False
    thinking_content = ""

    try:
        async for chunk in llm.astream(messages):
            content = chunk.content
            if not content:
                continue

            if think_done:
                # Past the thinking block — stream answer tokens directly.
                event = json.dumps({"token": content, "done": False})
                yield f"data: {event}\n\n"
                continue

            if in_think:
                # Accumulate thinking content and watch for the closing tag.
                buf += content
                close_idx = buf.find(_THINK_CLOSE)
                if close_idx != -1:
                    thinking_content += buf[:close_idx]
                    answer_tail = buf[close_idx + len(_THINK_CLOSE):]
                    buf = ""
                    in_think = False
                    think_done = True
                    # Emit whatever answer text follows </think> on the same chunk.
                    if answer_tail:
                        event = json.dumps({"token": answer_tail, "done": False})
                        yield f"data: {event}\n\n"
                else:
                    # Still inside <think>; emit a thinking_chunk so the
                    # frontend can show a "Thinking…" indicator.
                    thinking_content += content
                    event = json.dumps({"thinking_chunk": content, "done": False})
                    yield f"data: {event}\n\n"
                continue

            # Not yet decided: buffer until we can tell if it starts with <think>.
            buf += content
            if buf.startswith(_THINK_OPEN):
                # Strip the opening tag and enter thinking mode.
                buf = buf[len(_THINK_OPEN):]
                in_think = True
                # Emit any content already past the tag as thinking.
                if buf:
                    close_idx = buf.find(_THINK_CLOSE)
                    if close_idx != -1:
                        thinking_content = buf[:close_idx]
                        answer_tail = buf[close_idx + len(_THINK_CLOSE):]
                        buf = ""
                        in_think = False
                        think_done = True
                        if answer_tail:
                            event = json.dumps({"token": answer_tail, "done": False})
                            yield f"data: {event}\n\n"
                    else:
                        thinking_content = buf
                        event = json.dumps({"thinking_chunk": buf, "done": False})
                        yield f"data: {event}\n\n"
                        buf = ""
            elif len(buf) >= len(_THINK_OPEN) and not _THINK_OPEN.startswith(buf):
                # Buffer is long enough and clearly not going to become <think>.
                think_done = True
                event = json.dumps({"token": buf, "done": False})
                yield f"data: {event}\n\n"
                buf = ""

        # Flush any remaining buffer (e.g. a partial non-think tag at end).
        if buf:
            event = json.dumps({"token": buf, "done": False})
            yield f"data: {event}\n\n"

        elapsed = time.time() - start
        logger.info("LLM stream complete: model=%s, time=%.2fs, thinking=%d chars", model, elapsed, len(thinking_content))

        done_event = json.dumps({
            "token": "",
            "done": True,
            "metadata": {
                "model": model,
                "time": round(elapsed, 2),
                "citations": citations or [],
                "reasoning_summary": reasoning_summary or {},
                "thinking": thinking_content or None,
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
