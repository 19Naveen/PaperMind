"""LLM + embedding provider abstraction.

Two real providers are relevant to a run: the LLM that classifies a document and
extracts a field (temperature=0, structured output only), and the embedder that turns
chunks into vectors. Everything in the runtime talks to these two interfaces — swap a
provider and the six stages don't change.

"fake" providers are deterministic and exist so the pipeline can be exercised and tested
with no network calls.
"""

from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from collections.abc import Iterable
from typing import cast

from app.core.config import Settings, get_settings

# JSON Schema subset both a structured call and the extractor produce against.
JSON_SCHEMA = dict[str, object]


class LLMProvider(ABC):
    model_id: str

    @abstractmethod
    def text(self, system: str, user: str, temperature: float = 0.0) -> str: ...

    @abstractmethod
    def structured(
        self, schema: JSON_SCHEMA, system: str, user: str, temperature: float = 0.0
    ) -> dict[str, object]: ...

    def stream_text(self, system: str, user: str, temperature: float = 0.0) -> Iterable[str]:
        """Yield text tokens as they arrive. Default: a single event with the full text."""
        yield self.text(system, user, temperature)


class Embedder(ABC):
    dim: int

    @abstractmethod
    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    @abstractmethod
    def embed_query(self, text: str) -> list[float]: ...


class GeminiLLM(LLMProvider):
    def __init__(self, settings: Settings) -> None:
        import google.generativeai as genai

        if not settings.gemini_api_key:
            raise RuntimeError("llm_provider=gemini requires GEMINI_API_KEY")
        genai.configure(api_key=settings.gemini_api_key)  # type: ignore[attr-defined]
        self._client = genai.GenerativeModel(settings.llm_model)  # type: ignore[attr-defined]
        self.model_id = f"gemini:{settings.llm_model}"

    def text(self, system: str, user: str, temperature: float = 0.0) -> str:
        resp = self._client.generate_content(
            [system, user], generation_config={"temperature": temperature}
        )
        # google-generativeai is untyped at these boundaries; the SDK docs guarantee
        # .text on a non-streamed response.
        return cast(str, resp.text)

    def stream_text(self, system: str, user: str, temperature: float = 0.0) -> Iterable[str]:
        for chunk in self._client.generate_content(
            [system, user], generation_config={"temperature": temperature}, stream=True
        ):
            if chunk.text:
                yield chunk.text

    def structured(
        self, schema: JSON_SCHEMA, system: str, user: str, temperature: float = 0.0
    ) -> dict[str, object]:
        resp = self._client.generate_content(
            [system, user],
            generation_config={
                "temperature": temperature,
                "response_mime_type": "application/json",
                "response_schema": schema,
            },
        )
        # JSON loads of the SDK's text blob; shape is validated by the caller's schema.
        return cast(dict[str, object], json.loads(resp.text))


class FakeLLM(LLMProvider):
    """A scripted provider for offline runs and tests.

    `script` maps a user-prompt prefix to a canned structured response, so tests can
    force a value to verify like a real model might, or fabricate a quote and check the
    runtime marks it unsupported.
    """

    def __init__(
        self, script: dict[str, dict[str, object]] | None = None, model_id: str = "fake:local"
    ) -> None:
        self.model_id = model_id
        self.script = {} if script is None else script

    def _respond(self, key: str, fallback: dict[str, object]) -> dict[str, object]:
        for prefix, value in self.script.items():
            if key.startswith(prefix):
                return value
        return fallback

    def text(self, system: str, user: str, temperature: float = 0.0) -> str:
        return str(self._respond(user, {"text": "ok"}))

    def structured(
        self, schema: JSON_SCHEMA, system: str, user: str, temperature: float = 0.0
    ) -> dict[str, object]:
        return self._respond(user, {"found": False, "value": None, "quote": None})


class SentenceTransformerEmbedder(Embedder):
    def __init__(self, settings: Settings) -> None:
        from sentence_transformers import SentenceTransformer  # heavy; lazy

        self._model = SentenceTransformer(settings.embedding_model)
        self.dim = self._model.get_sentence_embedding_dimension()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        encoded = self._model.encode(texts, normalize_embeddings=True)
        # sentence-transformers returns a numpy ndarray; float conversion is typed by hand.
        return cast(list[list[float]], encoded.astype(float).tolist())

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]


class GeminiEmbedder(Embedder):
    def __init__(self, settings: Settings) -> None:
        import google.generativeai as genai

        if not settings.gemini_api_key:
            raise RuntimeError("embedding_provider=gemini requires GEMINI_API_KEY")
        genai.configure(api_key=settings.gemini_api_key)  # type: ignore[attr-defined]
        self._model = "models/embedding-001"
        self.dim = 768

    def _embed(self, texts: list[str]) -> list[list[float]]:
        import google.generativeai as genai

        # genai.get_model returns a Union[Model, TunedModel] that both expose
        # embed_content at runtime despite the weak stub typing.
        model = genai.get_model(self._model)  # type: ignore[attr-defined]
        out: list[list[float]] = []
        for t in texts:
            embedding = model.embed_content(content=t)["embedding"]  # type: ignore[union-attr]
            out.append(embedding)
        return out

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts)

    def embed_query(self, text: str) -> list[float]:
        return self._embed([text])[0]


class FakeEmbedder(Embedder):
    """Deterministic, dimension-configurable, zero-network. Tests and offline demo only."""

    def __init__(self, dim: int = 8) -> None:
        self.dim = dim

    def _vec(self, text: str) -> list[float]:
        seed = hashlib.sha256(text.encode()).digest()
        out = []
        for i in range(self.dim):
            out.append(float(seed[i % len(seed)]) / 255.0 - 0.5)
        return out

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text)


# ---------------------------------------------------------------------------
# Provider registry — tests swap these; production reads settings once.
# ---------------------------------------------------------------------------
class Providers:
    def __init__(self, llm: LLMProvider, embedder: Embedder) -> None:
        self.llm = llm
        self.embedder = embedder


_providers: Providers | None = None


def set_providers(llm: LLMProvider | None = None, embedder: Embedder | None = None) -> None:
    global _providers
    if llm is None and embedder is None:
        _providers = None
        return
    current = _providers or _make(get_settings())
    _providers = Providers(llm or current.llm, embedder or current.embedder)


def _make_llm(s: Settings) -> LLMProvider:
    if s.llm_provider == "gemini":
        return GeminiLLM(s)
    if s.llm_provider == "fake":
        return FakeLLM()
    raise RuntimeError(f"unknown llm_provider: {s.llm_provider}")


def _make_embedder(s: Settings) -> Embedder:
    if s.embedding_provider == "sentence-transformers":
        return SentenceTransformerEmbedder(s)
    if s.embedding_provider == "gemini":
        return GeminiEmbedder(s)
    if s.embedding_provider == "fake":
        return FakeEmbedder(s.embedding_dim)
    raise RuntimeError(f"unknown embedding_provider: {s.embedding_provider}")


def _make(s: Settings) -> Providers:
    return Providers(_make_llm(s), _make_embedder(s))


def get_providers() -> Providers:
    global _providers
    if _providers is None:
        _providers = _make(get_settings())
    return _providers
