"""
Module 4: Digital Journey Timeline
Turns the flat document set into a chronological growth story, grouped by
year, e.g. 2023 -> Python Certification, 2024 -> Data Science Club Lead ...
"""
from sqlalchemy.orm import Session
from models import Document, TimelineEvent


def rebuild_timeline(db: Session):
    db.query(TimelineEvent).delete()
    documents = db.query(Document).filter(Document.doc_date != "").all()
    for doc in documents:
        db.add(TimelineEvent(
            document_id=doc.id,
            year=doc.doc_date,
            label=doc.title or doc.original_filename,
            category=doc.category,
        ))
    db.commit()


def get_timeline(db: Session) -> list[dict]:
    events = db.query(TimelineEvent).order_by(TimelineEvent.year.asc()).all()
    grouped: dict[str, list[dict]] = {}
    for e in events:
        grouped.setdefault(e.year, []).append({
            "document_id": e.document_id,
            "label": e.label,
            "category": e.category,
        })
    return [{"year": y, "events": grouped[y]} for y in sorted(grouped.keys())]
