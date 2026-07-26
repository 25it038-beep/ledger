"""
Lightweight vector store for semantic search.

For this prototype we use TF-IDF + cosine similarity (scikit-learn) as the
embedding/vector layer, so the demo runs instantly with zero downloads and
no API key. Every document's (title + category + extracted_text + skills)
is embedded into a vector; a query is embedded with the same vectorizer and
ranked by cosine similarity against every stored document vector.

This is intentionally swappable: in production, replace `_vectorize_corpus`
and `search` with real sentence embeddings (e.g. `sentence-transformers/
all-MiniLM-L6-v2`) stored in a proper vector DB (Chroma, FAISS, Pinecone,
pgvector). The interface (fit_corpus / search) stays identical, so nothing
else in the app needs to change.
"""
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


class VectorStore:
    def __init__(self):
        self.vectorizer = None
        self.matrix = None
        self.doc_ids = []

    def fit_corpus(self, documents: list[tuple[int, str]]):
        """documents: list of (document_id, text_for_embedding)"""
        if not documents:
            self.vectorizer = None
            self.matrix = None
            self.doc_ids = []
            return
        self.doc_ids = [d[0] for d in documents]
        texts = [d[1] or " " for d in documents]
        self.vectorizer = TfidfVectorizer(stop_words="english", max_features=4096)
        self.matrix = self.vectorizer.fit_transform(texts)

    def search(self, query: str, top_k: int = 10) -> list[tuple[int, float]]:
        if not self.vectorizer or self.matrix is None or not query.strip():
            return []
        q_vec = self.vectorizer.transform([query])
        sims = cosine_similarity(q_vec, self.matrix)[0]
        ranked = sorted(zip(self.doc_ids, sims), key=lambda x: x[1], reverse=True)
        return [(doc_id, float(score)) for doc_id, score in ranked[:top_k] if score > 0]


# Single in-memory instance shared by the app; rebuilt whenever documents change.
store = VectorStore()


def embedding_text_for(title: str, category: str, text: str, skills: list[str]) -> str:
    return f"{title} {category} {' '.join(skills)} {text or ''}"
