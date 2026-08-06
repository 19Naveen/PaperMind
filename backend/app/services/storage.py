"""Blob storage. Local filesystem now; MinIO/S3 is the named swap point (plan: build it
when deploying to more than one box or when local disk fills)."""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path
from typing import BinaryIO

from app.core.config import get_settings

_root = Path(get_settings().storage_dir)


def _blob_dir() -> Path:
    _root.mkdir(parents=True, exist_ok=True)
    return _root


def save_blob(data: bytes, name: str) -> str:
    """Store a blob, return its storage key. Names are content-addressed and unguessable."""
    digest = hashlib.sha256(name.encode()).hexdigest()[:16]
    key = f"{digest}/{uuid.uuid4().hex}"
    path = _blob_dir() / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return key


def read_blob(key: str) -> bytes:
    return (_blob_dir() / key).read_bytes()


def open_blob(key: str) -> BinaryIO:
    return (_blob_dir() / key).open("rb")
