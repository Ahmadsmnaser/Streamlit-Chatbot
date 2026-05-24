"""Convert retrieved chunks into Citation response dicts."""


def format_citations(chunks: list[dict]) -> list[dict]:
    return [
        {
            "fileName": c["fileName"],
            "pageNumber": c.get("pageNumber"),
            "chunkIndex": c["chunkIndex"],
            "snippet": c["text"][:200],
        }
        for c in chunks
    ]
