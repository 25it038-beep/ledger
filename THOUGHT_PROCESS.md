# Thought Process

## Reframing the problem

The brief's own framing is the important part: *"traditional storage
platforms can save files, but they cannot understand a person's journey."*
That's the actual gap — not upload/download, which every cloud drive already
solves perfectly well. So the design question wasn't "how do I store files
well" but **"what does a system need to know about a document to place it in
a person's story, not just a folder?"**

That reframing drove three decisions before any code was written:

1. **Text is the substrate, files are the artifact.** Every uploaded file,
   regardless of format, gets reduced to plain text for the AI layer to
   reason over — while the original file itself is never touched, so "view
   original" always shows exactly what was uploaded.
2. **Skills are the connective tissue.** Projects, certifications,
   internships, and achievements don't naturally reference each other
   directly — but they *do* share a vocabulary of skills. Treating "Skill"
   as a first-class node (not just a tag) is what turns a flat list of
   documents into an actual graph.
3. **Category and skill extraction have to be instant and explainable for a
   demo**, so the categorization layer is deterministic keyword/phrase
   scoring rather than an opaque model call — a judge can open
   `categorize.py` and see exactly why a document landed in "Internship".
   The trade-off (missing paraphrased/unusual phrasing) is explicit in the
   README as the first thing to upgrade with an LLM call.

## What I prioritized vs. deprioritized

**Prioritized:**
- A relationship engine that produces genuinely different edges depending on
  content (not a hardcoded demo graph) — tested end-to-end with 5 sample
  documents that actually chain Certification → Skill → Project → Internship
  → Achievement.
- Real vector search (TF-IDF + cosine similarity) over a stubbed "search"
  that just does substring matching — it's a legitimate embeddings pipeline,
  just a lexical one instead of a learned semantic one, and the interface is
  built to swap in `sentence-transformers` + a real vector DB later without
  touching the API.
- Keeping every module's interface narrow and swappable, since a system that
  "understands" identity will keep needing better NLP/LLM components over
  time — the architecture shouldn't need to change when the model does.

**Deprioritized (and why):**
- OCR for scanned/image certificates — meaningfully increases setup
  complexity (tesseract binary, image preprocessing) for a prototype where
  text-based certificates already demonstrate the pipeline.
- Multi-user auth — orthogonal to the AI problem the brief is actually
  scoring; would be table-stakes for a real product, noise for a prototype.
- A hosted vector DB (Chroma/Pinecone) — adds a moving part and a
  network/API-key dependency for a demo that needs to run in one command,
  with no accuracy loss worth the complexity at this document volume.

## Why keyword-scoring categorization instead of an LLM call

An LLM classifier would handle messier, more varied real-world phrasing
better. I chose rule-based scoring for the prototype specifically because:
- it runs with zero API key / zero cost / zero latency, so the demo never
  stalls on a network call or rate limit during a live walkthrough,
- it's fully inspectable — a reviewer can see the exact signal that drove
  every classification decision, which matters for a system whose whole
  pitch is "understanding," not just "guessing well",
- the function boundary (`text, filename -> category`) is identical to what
  an LLM-backed version would expose, so upgrading it is a one-function
  change, not an architecture change.

## Why the relationship engine uses shared skills as its signal

The brief's own examples (Certification → Skill → Project → Internship →
Career Path) are all mediated by skill overlap, not explicit references
between documents — a resume rarely says "see internship offer letter #4."
Skill overlap is the only signal that's actually present in ordinary
documents, so it's what the graph is built on. The one deliberate addition:
Project → Internship and Internship → Achievement edges are directional and
time-aware, so the graph reads as a career progression rather than an
undirected "these two things share a word" cluster.

## What I'd build next with more time

- LLM-based relationship *inference* from free text (e.g. explicitly
  detecting "this project was completed during this internship" rather than
  only inferring it from skill overlap).
- Confidence scores surfaced in the UI for categorization, so a user can
  correct a low-confidence classification (turns the system from
  fully-automatic-and-silent into automatic-with-a-safety-net).
- A "career path" narrative generator that turns the timeline + graph into a
  short auto-written bio paragraph, since the timeline already has
  everything needed to answer "tell me about your journey" in prose.
