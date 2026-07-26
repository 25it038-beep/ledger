# Architecture — AI Digital Identity System

## 1. System overview

```mermaid
flowchart TD
    U[User] -->|uploads file or link| ING[Module 1: Ingestion]
    ING -->|stores original, untouched| FS[(File Storage /uploads)]
    ING -->|extracted raw text| CAT[Module 2: Categorization + Skill Extraction]
    CAT -->|category, skills, title, summary| DB[(SQLite: documents, skills)]
    DB --> REL[Module 3: Relationship Engine]
    REL -->|graph edges| DB2[(SQLite: relationships)]
    DB --> TL[Module 4: Timeline Builder]
    TL -->|year-grouped events| DB3[(SQLite: timeline_events)]
    DB --> VEC[Module 5: Vector Store - TF-IDF + cosine similarity]
    VEC -->|ranked matches| API[FastAPI REST layer]
    DB2 --> API
    DB3 --> API
    API --> FE[Frontend: Ingest / Archive / Timeline / Connections / Retrieve]
    FE -->|natural-language query| VEC
    FE -->|view original| FS
```

## 2. Ingestion → categorization pipeline (per document)

```mermaid
sequenceDiagram
    participant U as User
    participant API as FastAPI /api/upload
    participant ING as ingestion.py
    participant CAT as categorize.py
    participant DB as SQLite

    U->>API: POST file (+ optional date)
    API->>API: save original file unchanged to /uploads
    API->>ING: extract_text(filepath, ext)
    ING-->>API: raw text
    API->>ING: guess_date(text, filename)
    ING-->>API: year (e.g. "2024")
    API->>CAT: categorize(text, filename)
    CAT-->>API: category (Certification / Project / Internship / ...)
    API->>CAT: extract_skills(text, filename)
    CAT-->>API: [Python, AWS, Machine Learning, ...]
    API->>DB: insert Document + link Skills
    API->>API: rebuild vector index, relationship graph, timeline
    API-->>U: classified document (category, skills, title)
```

## 3. Relationship Engine logic

The graph connects two node types — **Document** and **Skill** — with
directional edges:

| Edge | Meaning |
|---|---|
| `Document --teaches--> Skill` | A Certification document that mentions this skill |
| `Document --mentions--> Skill` | Any other document (Project, Resume, Academic...) referencing this skill |
| `Skill --used_in--> Document(Project)` | A skill acquired via a Certification/Academic doc reappears in a Project |
| `Document(Project) --led_to--> Document(Internship)` | Shared skills between a Project and a later Internship |
| `Document(Internship) --led_to--> Document(Achievement)` | Shared skills between an Internship and a later Achievement |

```mermaid
graph LR
    Cert["Certification: Python for Everybody (2023)"] -- teaches --> SkillPy["Skill: Python"]
    SkillPy -- used_in --> Proj["Project: Crop Disease Detector (2024)"]
    Proj -- led_to --> Intern["Internship: ML Intern @ XYZ (2025)"]
    Intern -- led_to --> Ach["Achievement: Hackathon Winner (2026)"]
```

This is what lets the system answer "how did I get here?" — not just "what
files do I have?"

## 4. Retrieval (semantic search)

```mermaid
flowchart LR
    Docs[All documents: title + category + skills + full text] --> TFIDF[TF-IDF vectorizer fit on corpus]
    TFIDF --> Matrix[(Document-term matrix)]
    Query["'show my AI projects'"] --> QVec[Same vectorizer transforms query]
    QVec --> Cos[Cosine similarity vs every document vector]
    Matrix --> Cos
    Cos --> Ranked[Top-K ranked documents + relevance score]
    Ranked --> Link[Direct link to original file, unchanged format]
```

## 5. Data model (simplified ER)

```mermaid
erDiagram
    DOCUMENT ||--o{ DOCUMENT_SKILLS : has
    SKILL ||--o{ DOCUMENT_SKILLS : tagged_in
    DOCUMENT ||--o{ TIMELINE_EVENT : produces
    DOCUMENT ||--o{ RELATIONSHIP : source_or_target
    SKILL ||--o{ RELATIONSHIP : source_or_target

    DOCUMENT {
        int id
        string category
        string title
        text extracted_text
        string doc_date
        string filepath
    }
    SKILL {
        int id
        string name
    }
    RELATIONSHIP {
        string source_type
        int source_id
        string target_type
        int target_id
        string relation
    }
    TIMELINE_EVENT {
        string year
        string label
        string category
    }
```

## Why this shape

- **Original files are never transformed** — only read once for text
  extraction. The file on disk is the file the user uploaded, byte for byte.
- **Every module has a narrow, swappable interface** (`categorize()`,
  `extract_skills()`, `VectorStore.search()`, `rebuild_relationships()`), so
  the rule-based NLP here can be replaced with an LLM or a real embedding
  model without touching the API layer, database schema, or frontend.
- **The relationship graph is derived, not stored redundantly** — it's
  rebuilt from documents + skills on every change, so it can never drift out
  of sync with the underlying data.
