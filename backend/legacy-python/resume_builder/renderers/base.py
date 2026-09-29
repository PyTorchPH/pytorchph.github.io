from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from ..core.models import Resume


class Renderer(ABC):
    extension: str = ""

    @abstractmethod
    def render(self, resume: Resume) -> str | bytes:
        ...

    def write(self, resume: Resume, out_dir: Path, stem: str = "resume") -> Path:
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{stem}.{self.extension}"
        content = self.render(resume)
        mode = "wb" if isinstance(content, (bytes, bytearray)) else "w"
        encoding = None if mode == "wb" else "utf-8"
        with open(out_path, mode, encoding=encoding) as f:
            f.write(content)
        return out_path
