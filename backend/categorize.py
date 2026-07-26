"""
Module 2: Intelligent Categorization
Classifies an incoming document into one of the fixed categories using a
lightweight, explainable NLP layer: weighted keyword/phrase signals scored
against the extracted text + filename. This runs with zero external
dependencies / API keys so the demo works offline; see README for how to
swap in an LLM-based classifier (Claude/GPT) for messier real-world text.

Also extracts a normalized "skills" vocabulary mentioned in the document,
which is what powers the Relationship Engine (Module 3).
"""
import re
from collections import defaultdict

CATEGORY_SIGNALS = {
    "Certification": [
        "certificate", "certification", "certifies that", "completed the course",
        "has successfully completed", "course completion", "credential",
    ],
    "Internship": [
        "internship", "intern at", "offer letter", "letter of internship",
        "we are pleased to offer", "trainee", "stipend",
    ],
    "Project": [
        "project report", "project title", "abstract", "methodology",
        "github.com", "project synopsis", "objective of the project",
    ],
    "Achievement": [
        "award", "winner", "1st place", "2nd place", "3rd place", "achievement",
        "rank", "medal", "hackathon winner", "top performer",
    ],
    "Academic": [
        "transcript", "marksheet", "cgpa", "gpa", "semester", "grade card",
        "board of examination", "degree", "bonafide",
    ],
    "Resume": [
        "resume", "curriculum vitae", "career objective", "professional summary",
        "work experience", "education", "references available",
    ],
    "Portfolio": [
        "portfolio", "behance.net", "linkedin.com/in", "personal website",
    ],
}

# Normalized skill vocabulary -> list of surface forms/aliases to match.
SKILL_VOCAB = {
    "Python": ["python"],
    "Java": [r"\bjava\b"],
    "C++": [r"c\+\+"],
    "JavaScript": ["javascript", "js"],
    "React": ["react.js", "reactjs", r"\breact\b"],
    "Node.js": ["node.js", "nodejs"],
    "SQL": [r"\bsql\b", "mysql", "postgresql"],
    "Machine Learning": ["machine learning", r"\bml\b"],
    "Deep Learning": ["deep learning"],
    "Data Science": ["data science"],
    "NLP": ["nlp", "natural language processing"],
    "TensorFlow": ["tensorflow"],
    "PyTorch": ["pytorch"],
    "AWS": ["aws", "amazon web services"],
    "Docker": ["docker"],
    "Cloud Computing": ["cloud computing"],
    "Excel": ["excel", "ms excel"],
    "Data Analysis": ["data analysis", "data analytics"],
    "AI": [r"\bai\b", "artificial intelligence"],
    "Cybersecurity": ["cybersecurity", "cyber security", "penetration testing"],
    "Leadership": ["leadership", "team lead", "club lead"],
    "Communication": ["communication skills"],
    "Git": [r"\bgit\b", "github"],
    "Django": ["django"],
    "Flask": ["flask"],
    "HTML/CSS": ["html", "css"],
    "Figma": ["figma"],
}


def categorize(text: str, filename: str) -> tuple[str, dict]:
    """Returns (best_category, score_breakdown)."""
    haystack = f"{filename}\n{text}".lower()
    scores = defaultdict(int)
    for category, signals in CATEGORY_SIGNALS.items():
        for sig in signals:
            if re.search(sig, haystack):
                scores[category] += 1
    if not scores:
        return "Other", {}
    best = max(scores.items(), key=lambda kv: kv[1])[0]
    return best, dict(scores)


def extract_skills(text: str, filename: str) -> list[str]:
    haystack = f"{filename}\n{text}".lower()
    found = []
    for skill, patterns in SKILL_VOCAB.items():
        for pat in patterns:
            if re.search(pat, haystack):
                found.append(skill)
                break
    return found


def make_title(text: str, filename: str, category: str) -> str:
    """Cheap heuristic title: first non-trivial line of the doc, else filename."""
    for line in (text or "").splitlines():
        line = line.strip()
        if 8 <= len(line) <= 90 and not line.lower().startswith(("page ", "http")):
            return line
    base = re.sub(r"[_\-]+", " ", filename.rsplit(".", 1)[0])
    return base.strip().title() or category


def make_summary(text: str, category: str, skills: list[str]) -> str:
    snippet = " ".join((text or "").split())[:180]
    skill_part = f" Related skills: {', '.join(skills[:4])}." if skills else ""
    return f"[{category}] {snippet}{'...' if len(text or '') > 180 else ''}{skill_part}"
