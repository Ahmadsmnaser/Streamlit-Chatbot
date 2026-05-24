"""Format retrieved chunks into an LLM context block."""


def build_context_prompt(chunks: list[dict]) -> str:
    """Return a formatted context string to inject before the user query."""
    lines = ["[Context from uploaded files]"]

    for chunk in chunks:
        source = chunk["fileName"]
        if chunk.get("pageNumber"):
            source += f", page {chunk['pageNumber']}"
        lines.append("---")
        lines.append(f"Source: {source}")
        lines.append(f'"{chunk["text"]}"')

    lines.append("---")
    lines.append(
        "Use the above context to answer the question. "
        "If the context does not contain enough information, say so."
    )
    return "\n".join(lines)
