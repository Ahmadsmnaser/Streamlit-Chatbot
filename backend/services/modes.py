"""Answer mode system prompt prefixes."""

MODE_PROMPTS: dict[str, str] = {
    "simple": (
        "Answer clearly and briefly. Use simple language suitable for a beginner. "
        "Avoid jargon. Keep it concise."
    ),
    "deep": (
        "Provide a comprehensive, technically detailed answer. "
        "Include nuances, edge cases, underlying mechanisms, and depth. "
        "Do not simplify — assume the reader is technical."
    ),
    "exam": (
        "Structure your answer for studying: start with a one-sentence definition, "
        "then list key points as a numbered list, then close with a short example or analogy."
    ),
    "code": (
        "Focus on implementation. Lead with working code examples. "
        "Explain the code inline with comments. Minimize prose — let the code speak. "
        "Use the most idiomatic approach for the language in question."
    ),
    "interview": (
        "Answer as if in a technical job interview: confident, structured, and professional. "
        "Use the STAR method where applicable (Situation, Task, Action, Result). "
        "Be precise, avoid rambling, and demonstrate depth of knowledge."
    ),
}
