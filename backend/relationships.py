"""
Module 3: Relationship Engine

Builds a knowledge graph connecting Documents <-> Skills <-> Documents so the
system can answer "how does everything connect" rather than just "here is a
pile of files".

Relations produced:
  Document(Certification) --teaches--> Skill
  Document(Project/Internship/Achievement/Academic) --mentions--> Skill
  Skill --used_in--> Document(Project)          (skill learned elsewhere, applied in a project)
  Document(Project) --led_to--> Document(Internship)   (shared skills + project precedes internship in time)
  Document(Internship) --led_to--> Document(Achievement/Career milestone)

The graph is rebuilt whenever documents change (cheap at prototype scale).
"""
from sqlalchemy.orm import Session
from models import Document, Skill, KnowledgeRelationship


def rebuild_relationships(db: Session):
    db.query(KnowledgeRelationship).delete()
    documents = db.query(Document).all()

    # 1. Document <-> Skill edges
    for doc in documents:
        relation = "teaches" if doc.category == "Certification" else "mentions"
        for skill in doc.skills:
            db.add(KnowledgeRelationship(
                source_type="document", source_id=doc.id,
                target_type="skill", target_id=skill.id,
                relation=relation,
            ))

    # 2. Skill -> Project edges (skill acquired via cert/academic, applied in a project)
    projects = [d for d in documents if d.category == "Project"]
    certs_academics = [d for d in documents if d.category in ("Certification", "Academic")]
    for proj in projects:
        proj_skill_ids = {s.id for s in proj.skills}
        for source_doc in certs_academics:
            shared = proj_skill_ids & {s.id for s in source_doc.skills}
            for skill_id in shared:
                db.add(KnowledgeRelationship(
                    source_type="skill", source_id=skill_id,
                    target_type="document", target_id=proj.id,
                    relation="used_in",
                ))

    # 3. Project -> Internship edges (shared skills = the project's skills led to the internship)
    internships = [d for d in documents if d.category == "Internship"]
    for proj in projects:
        proj_skill_ids = {s.id for s in proj.skills}
        for intern in internships:
            shared = proj_skill_ids & {s.id for s in intern.skills}
            if shared:
                db.add(KnowledgeRelationship(
                    source_type="document", source_id=proj.id,
                    target_type="document", target_id=intern.id,
                    relation="led_to",
                    weight=float(len(shared)),
                ))

    # 4. Internship -> Achievement edges (career path culminating in recognition)
    achievements = [d for d in documents if d.category == "Achievement"]
    for intern in internships:
        intern_skill_ids = {s.id for s in intern.skills}
        for ach in achievements:
            shared = intern_skill_ids & {s.id for s in ach.skills}
            if shared:
                db.add(KnowledgeRelationship(
                    source_type="document", source_id=intern.id,
                    target_type="document", target_id=ach.id,
                    relation="led_to",
                    weight=float(len(shared)),
                ))

    db.commit()


def get_graph(db: Session) -> dict:
    """Serialize the graph into {nodes, edges} for the frontend visualization."""
    documents = {d.id: d for d in db.query(Document).all()}
    skills = {s.id: s for s in db.query(Skill).all()}
    edges = db.query(KnowledgeRelationship).all()

    nodes = []
    for d in documents.values():
        nodes.append({
            "id": f"doc-{d.id}", "label": d.title or d.original_filename,
            "type": "document", "category": d.category,
        })
    for s in skills.values():
        nodes.append({"id": f"skill-{s.id}", "label": s.name, "type": "skill"})

    edge_list = []
    for e in edges:
        src = f"{e.source_type[:4]}-{e.source_id}" if e.source_type == "skill" else f"doc-{e.source_id}"
        tgt = f"{e.target_type[:4]}-{e.target_id}" if e.target_type == "skill" else f"doc-{e.target_id}"
        src = src.replace("skil-", "skill-")
        tgt = tgt.replace("skil-", "skill-")
        edge_list.append({"from": src, "to": tgt, "label": e.relation})

    return {"nodes": nodes, "edges": edge_list}
