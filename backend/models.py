"""
Database models for the AI Digital Identity System.

Core entities:
- Document      : any uploaded file (certificate, resume, project report, etc.)
- Skill         : a normalized skill/technology extracted from documents
- DocumentSkill : many-to-many link between Document and Skill
- Relationship  : an edge in the knowledge graph (Document/Skill -> Document/Skill)
- TimelineEvent : a dated milestone derived from a document, used for the journey timeline
"""
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Table, Float
)
from sqlalchemy.orm import relationship, declarative_base
from datetime import datetime

Base = declarative_base()

# Many-to-many association: which skills appear in which documents
document_skills = Table(
    "document_skills",
    Base.metadata,
    Column("document_id", Integer, ForeignKey("documents.id")),
    Column("skill_id", Integer, ForeignKey("skills.id")),
)


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)          # stored filename on disk
    original_filename = Column(String, nullable=False)  # user-facing filename
    filepath = Column(String, nullable=False)          # path on disk, original file preserved as-is
    file_ext = Column(String)                           # .pdf, .docx, .txt, .png ...
    category = Column(String, index=True)               # Certification / Project / Internship / Skill / Achievement / Academic / Resume / Other
    title = Column(String)                               # derived or user-given title
    extracted_text = Column(Text)                        # raw text pulled from the file (for search + NLP)
    doc_date = Column(String)                            # best-guess date (YYYY or YYYY-MM) this doc represents
    upload_date = Column(DateTime, default=datetime.utcnow)
    source_type = Column(String, default="file")         # file | link (portfolio / github url)
    source_url = Column(String, nullable=True)            # if source_type == link
    summary = Column(Text, nullable=True)                 # short auto-generated summary

    skills = relationship("Skill", secondary=document_skills, back_populates="documents")


class Skill(Base):
    __tablename__ = "skills"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    documents = relationship("Document", secondary=document_skills, back_populates="skills")


class KnowledgeRelationship(Base):
    """
    An edge in the relationship graph, e.g.
    Certification(3) --teaches--> Skill(7)
    Skill(7) --used_in--> Project(5)
    Project(5) --led_to--> Internship(9)
    """
    __tablename__ = "relationships"

    id = Column(Integer, primary_key=True, index=True)
    source_type = Column(String)   # "document" | "skill"
    source_id = Column(Integer)
    target_type = Column(String)
    target_id = Column(Integer)
    relation = Column(String)      # teaches | used_in | led_to | mentions | preceded_by
    weight = Column(Float, default=1.0)


class TimelineEvent(Base):
    __tablename__ = "timeline_events"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    year = Column(String)          # e.g. "2023"
    label = Column(String)          # short label, e.g. "Python Certification"
    category = Column(String)


class User(Base):
    """
    A person who has signed in via Clerk. We don't store passwords or manage
    credentials ourselves — Clerk handles auth end-to-end. This table just
    mirrors the minimal profile info so the app has a local record of who has
    logged in and when ("login info save").
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    clerk_user_id = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, nullable=True)
    name = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime, default=datetime.utcnow)
    login_count = Column(Integer, default=1)


class CareerAnalysis(Base):
    """
    Stores the most recent LLM-generated Career Intelligence report so it
    doesn't need to be regenerated on every page load. Regenerated on demand
    via POST /api/career/analyze whenever the user wants a fresh read.
    """
    __tablename__ = "career_analysis"

    id = Column(Integer, primary_key=True, index=True)
    generated_at = Column(DateTime, default=datetime.utcnow)
    document_count = Column(Integer, default=0)   # snapshot of corpus size used, to detect staleness
    report_json = Column(Text)                     # full structured report, stored as JSON text
