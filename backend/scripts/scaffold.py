"""Create missing package placeholders without overwriting existing source."""
import logging
from pathlib import Path

PACKAGES = (
    "src", "src/api", "src/api/auth", "src/api/chat", "src/api/models",
    "src/api/services", "src/ai", "scripts",
)
DIRECTORIES = ("data", "research", "migrations/versions", "tests/api", "tests/ai")
MODULES = (
    "src/api/config.py", "src/api/extensions.py", "src/api/auth/routes.py",
    "src/api/auth/service.py", "src/api/auth/errors.py", "src/api/auth/validation.py",
    "src/api/chat/routes.py", "src/api/models/auth.py", "src/api/services/mail.py",
    "src/ai/embeddings.py", "src/ai/ingestion.py", "src/ai/prompts.py", "src/ai/rag.py",
    ".env", "setup.py", "app.py",
)


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    root = Path(__file__).resolve().parents[1]
    for relative in (*PACKAGES, *DIRECTORIES):
        (root / relative).mkdir(parents=True, exist_ok=True)
    files = (*MODULES, *(f"{package}/__init__.py" for package in PACKAGES))
    for relative in files:
        path = root / relative
        if not path.exists():
            path.touch()
            logging.info("Created %s", relative)


if __name__ == "__main__":
    main()
