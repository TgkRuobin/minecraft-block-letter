# Repository Guidelines

## Project Structure & Module Organization

This repository is a local glyph-to-Litematica exporter. The browser UI lives at the repository root: `index.html` defines the page, `styles.css` contains presentation, `app.js` handles canvas rendering and export requests, and `core.js` contains reusable character parsing and filename logic. `all.txt` is the default UTF-8 character set. The FastAPI service is in `server/app.py`; it serves the UI and converts uploaded 128×128 PNG files into a TAR of `.litematic` files. JavaScript tests are under `test/`, currently `test/core.test.js`. Python dependencies and interpreter requirements are defined in `pyproject.toml`, `.python-version`, and `uv.lock`.

## Build, Test, and Development Commands

- `uv sync` — install the locked Python 3.12 environment and service dependencies.
- `npm run dev` — start Uvicorn at `http://127.0.0.1:8000`.
- `npm test` — run the Node built-in test runner against `test/*.test.js`.
- `curl http://127.0.0.1:8000/api/health` — verify the service and fixed projection settings.

There is no separate frontend build step; FastAPI serves the source files directly.

## Coding Style & Naming Conventions

Follow the existing formatting: two-space indentation in JavaScript, HTML, and CSS; four spaces in Python. Use `camelCase` for JavaScript functions and variables, `snake_case` for Python, `UPPER_SNAKE_CASE` for constants, and kebab-case for HTML IDs and CSS classes. Keep shared parsing and naming behavior in `core.js`, not duplicated in DOM code. Preserve the export contract: 128×128 canvases, grayscale threshold `123`, one `y=0` layer, and `minecraft:blackstone` for dark pixels. No formatter or linter is configured, so keep edits consistent with adjacent code.

## Testing Guidelines

Use Node's `node:test` and `node:assert/strict`. Name files `*.test.js` and write behavior-focused test names. Add cases for Unicode graphemes, duplicate removal, punctuation, and Windows-safe filenames when changing `core.js`. No numeric coverage target or automated Python suite currently exists; backend changes should include manual health, invalid-upload, TAR-content, and Litematica orientation checks, documented in the PR.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style subjects such as `feat: 文字转投影`. Continue with `<type>: <concise summary>`; use types such as `feat`, `fix`, `test`, or `docs`. Pull requests should explain user-visible behavior, list verification commands, link relevant issues, and include screenshots for UI changes. For export changes, describe any API, filename, dimension, threshold, or block-mapping impact.

## Security & Configuration Tips

Keep processing local and do not add external uploads without explicit justification. Preserve upload count and size limits, sanitize archive filenames, and never commit generated `.litematic` or TAR output, fonts, or virtual environments.
