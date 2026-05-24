"""Chroma vector store — one collection per session."""

import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

from .chunker import Chunk

_EMBED_FN = SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")


class RAGStore:
    def __init__(self, session_id: str) -> None:
        self._session_id = session_id
        self._client = chromadb.Client()
        self._collection = self._client.get_or_create_collection(
            name=f"session_{session_id}",
            embedding_function=_EMBED_FN,
        )

    async def add_chunks(self, chunks: list[Chunk]) -> None:
        if not chunks:
            return
        self._collection.add(
            ids=[str(c["chunkIndex"]) for c in chunks],
            documents=[c["text"] for c in chunks],
            metadatas=[
                {
                    "fileName": c["fileName"],
                    "pageNumber": c["pageNumber"] if c["pageNumber"] is not None else -1,
                    "chunkIndex": c["chunkIndex"],
                }
                for c in chunks
            ],
        )

    async def search(self, query: str, top_k: int = 4) -> list[dict]:
        count = self._collection.count()
        if count == 0:
            return []

        k = min(top_k, count)
        results = self._collection.query(query_texts=[query], n_results=k)

        retrieved: list[dict] = []
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        for doc, meta, dist in zip(docs, metas, distances):
            retrieved.append({
                "text": doc,
                "fileName": meta["fileName"],
                "pageNumber": meta["pageNumber"] if meta["pageNumber"] != -1 else None,
                "chunkIndex": meta["chunkIndex"],
                "score": round(1 - dist, 4),
            })

        return retrieved

    def clear(self) -> None:
        self._client.delete_collection(f"session_{self._session_id}")
