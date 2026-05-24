"""Split page text into overlapping chunks."""

from typing import TypedDict
from .extractor import PageChunk


class Chunk(TypedDict):
    text: str
    fileName: str
    pageNumber: int | None
    chunkIndex: int


def chunk_pages(
    pages: list[PageChunk],
    chunk_size: int = 600,
    overlap: int = 80,
) -> list[Chunk]:
    """Split pages into overlapping text chunks."""
    chunks: list[Chunk] = []
    idx = 0

    for page in pages:
        for segment in _split_text(page["text"], chunk_size, overlap):
            chunks.append({
                "text": segment,
                "fileName": page["source_file"],
                "pageNumber": page["page_number"],
                "chunkIndex": idx,
            })
            idx += 1

    return chunks


def _split_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Sliding-window splitter: break on newlines first, then characters."""
    if len(text) <= chunk_size:
        return [text]

    segments: list[str] = []
    start = 0

    while start < len(text):
        end = start + chunk_size

        if end >= len(text):
            segments.append(text[start:])
            break

        # Try to break on a newline within the last 20% of the window
        boundary = text.rfind("\n", start + int(chunk_size * 0.8), end)
        if boundary == -1:
            # Fall back to last space
            boundary = text.rfind(" ", start + int(chunk_size * 0.5), end)
        if boundary == -1:
            boundary = end

        segments.append(text[start:boundary].strip())
        start = max(boundary - overlap, start + 1)

    return [s for s in segments if s]
