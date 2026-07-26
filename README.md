# Ledger — AI-Powered Digital Identity System

A working prototype that turns a scattered pile of certificates, resumes, project
reports, internship letters, and portfolio links into a single, structured,
searchable digital identity — automatically categorized, cross-linked by skill,
and laid out as a growth timeline. Original files are always preserved and
one click away.

> "I never have to search through folders again."

## Why this exists

Traditional storage (Drive, email, local folders) can hold a file, but it has
no idea that a 2023 Python certificate, a 2024 crop-disease-detection project,
and a 2025 ML internship offer are all the same growth story. This system
reads every upload, classifies it, extracts the skills inside it, and builds
the connective tissue between them — then lets you retrieve any of it with a
plain-English query instead of a folder tree.

## Live demo flow (2 minutes)

1. Open the **Ingest** tab, drop in a certificate, a project report, and an
   internship letter (sample files included in `sample_data/`).
2. Switch to **Archive** — everything is already sorted into Certification /
   Project / Internship / Achievement / Academic / Resume, with skills tagged
   on each card, no manual folder-picking.
3. Switch to **Connections** — see the actual knowledge graph: which
   certification taught which skill, which skill shows up in which project,
   and which project's skills line up with an internship.
4. Switch to **Timeline** — the same documents, replayed as a year-by-year
   growth story.
5. Switch to **Retrieve** and type `"show my AI projects"` or `"latest
   resume"` — instant semantic search, one click to the original file.

## Architecture

See `ARCHITECTURE.md` for the full diagram. In short:

```
Upload (file or link)
   │
   ▼
Module 1 · Ingestion        — extract raw text from PDF / DOCX / TXT, preserve original file as-is
   │
   ▼
Module 2 · Categorization    — NLP keyword/phrase scoring → category (Certification, Project, Internship,
   │                           Achievement, Academic, Resume, Portfolio) + skill-vocabulary extraction
   ▼
Module 3 · Relationship Engine — builds a graph: Document↔Skill, Skill→Project, Project→Internship,
   │                              Internship→Achievement (edges formed from shared skills + category)
   ▼
Module 4 · Timeline           — documents ordered by extracted/declared year into a growth story
   │
   ▼
Module 5 · Smart Retrieval    — TF-IDF vector embeddings + cosine similarity semantic search
   │                            over title + category + skills + full text, ranked by relevance
   ▼
Module 6 · Career Intelligence — LLM (Anthropic API) reads the full archive and produces career
                                  matches, skill gaps, resume review, future timeline, insights, copilot chat
```

## Tech stack

- **Backend:** FastAPI + SQLAlchemy + SQLite (swap-in ready for Postgres)
- **NLP / categorization:** rule-based weighted keyword/phrase scoring over
  extracted text (see `backend/categorize.py`) — deterministic, explainable,
  works fully offline with no API key. A drop-in hook for an LLM-based
  classifier (Claude/GPT) is noted inline for messier real-world documents.
- **Skill extraction:** normalized skill vocabulary matched against text
  (regex-based entity extraction) — the backbone of the relationship graph.
- **Embeddings / semantic search:** scikit-learn `TfidfVectorizer` + cosine
  similarity (`backend/vectorstore.py`). This is a genuine vector-embedding +
  similarity-search pipeline; the `VectorStore` interface (`fit_corpus` /
  `search`) is written so it can be swapped for real sentence embeddings
  (`sentence-transformers/all-MiniLM-L6-v2`) backed by a proper vector DB
  (Chroma / FAISS / pgvector) without touching any other module — see
  "Scaling this up" below.
- **Relationship / knowledge graph:** custom graph builder over shared skills
  across categories (`backend/relationships.py`), rendered client-side as a
  force-directed layout on `<canvas>` — no external graph library needed.
- **Frontend:** single-page vanilla HTML/CSS/JS (no build step) — Ingest,
  Archive, Timeline, Connections, Retrieve tabs.

## Module 6 · Career Intelligence Engine

On top of the identity archive, a **Career** tab uses the Anthropic API to
read the whole archive (documents, skills, dates, resume text) and generate:
career-path matches with match scores and roadmaps, a skill-gap analysis,
resume/ATS review, a future career timeline, proactive insights, a
paste-a-job-description match check, and a free-form career copilot chat.

This module is intentionally LLM-backed rather than rule-based — career
advice needs real language understanding — see `backend/career.py`.

**Setup:** set `ANTHROPIC_API_KEY` before starting the server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # macOS/Linux
set ANTHROPIC_API_KEY=sk-ant-...        # Windows (cmd)
```

If it's not set, the Career tab's "Run career analysis" fails with a clear
message rather than crashing the server — everything else in the app works
fully offline regardless. Optionally set `CLAUDE_MODEL` to override the
default model (`claude-sonnet-5`).

## Running it

```bash
pip install -r requirements.txt
cd backend
uvicorn main:app --reload --port 8000
```

Then open **http://localhost:8000/** — the backend serves the frontend
directly, so there's nothing else to start. Uploaded files land in
`uploads/` (untouched, original format); metadata lives in `data/identity.db`.

Try it immediately with the bundled samples in `sample_data/` — five short
`.txt` files (certificate, resume, project report, internship offer letter,
achievement) that exercise every module end-to-end, including the
Project → Internship → Achievement relationship chain.

## Authentication (Clerk)

Sign-in is handled by [Clerk](https://clerk.com) — no passwords are stored by
this app.

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Create a free Clerk app at https://dashboard.clerk.com and copy your
   **Publishable key** and **Secret key** (API Keys page) into `.env`:
   ```
   CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   ```
3. Restart `uvicorn`. The app will now show a Clerk sign-in screen before
   anything else loads.

If `.env` has no Clerk keys yet, the app runs without auth (a warning is
printed in the server logs) so you can keep developing — nothing breaks.

Every login is recorded locally in the new `users` table (email, name,
avatar, first-seen date, last-login time, login count) via `POST
/api/auth/sync`, which runs automatically right after Clerk confirms a
session. The frontend also caches the last-known profile in
`localStorage` so the header shows your name instantly on reload, before
the network round-trip completes.

**Note on API keys:** Place your API keys in the `.env` file (e.g. `NVIDIA_API_KEY`, `GEMINI_API_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`).

## Removing documents

Each document card in the Archive tab now has a **Remove** button. It asks
for confirmation, then calls `DELETE /api/documents/{id}`, which deletes the
stored file from `uploads/` and its database row, and rebuilds the search
index, relationship graph, and timeline so the removal is reflected
everywhere immediately.

## Mapping to the brief's key questions

| Question | How it's answered |
|---|---|
| **Intelligent organization without manual sorting** | Every upload is auto-classified on arrival (Module 2) — no folders, no user tagging. |
| **Knowledge connections across skills/projects/certifications/internships** | Module 3 builds real graph edges (`teaches`, `mentions`, `used_in`, `led_to`) from shared skills, visualized in Connections. |
| **Instant retrieval without searching folders** | Module 5's semantic search returns ranked, relevant documents (with a direct link to the original file) for natural-language queries. |

## Known limitations & how to scale this up

This is a hackathon-scope prototype; the interfaces are intentionally built so
each limitation below is a swap, not a rewrite:

- **Categorization** is keyword-scored, not model-based. Swap in a Claude/GPT
  call in `categorize.categorize()` for noisy, unstructured real-world text —
  the function signature (`text, filename -> category`) doesn't need to change.
- **Embeddings** are TF-IDF, not learned semantic embeddings. Swap
  `VectorStore` internals for `sentence-transformers` + Chroma/FAISS for true
  semantic (not just lexical) similarity, and to scale past in-memory search.
- **No OCR** — scanned image certificates aren't text-extracted yet. Add
  `pytesseract` in `ingestion.py` for image-based uploads.
- **Single-user** — no auth layer; add per-user scoping for a real product.
- **Relationship inference** is rule-based on shared skills; a production
  version could use an LLM to infer relationships from free text directly
  (e.g. "this internship was a direct result of this project") instead of
  only skill overlap.

## Repo layout

```
backend/         FastAPI app: models, ingestion, categorization, vector search,
                 relationship engine, timeline, career intelligence engine, main API
frontend/        Single-page vanilla JS/HTML/CSS UI
sample_data/     5 sample documents to demo the full pipeline instantly
requirements.txt
ARCHITECTURE.md  Full architecture + data-flow diagram
THOUGHT_PROCESS.md  Design reasoning, trade-offs, what was deprioritized and why
```
