"""Train nonnegative event-category weights from blind A/draw/B judgments.

Training may use CUDA. The Rust API only reads the published numeric coefficients.
Run: python train_weights.py --db path/to/api.sqlite --output weights.json [--publish]
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

import torch

CATEGORIES = ("talk", "workshop", "hackathon", "competitive", "mini_contest")
LABELS = {"a": 0, "draw": 1, "b": 2}
MIN_COMPARISONS = 30


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    torch.manual_seed(137)
    with sqlite3.connect(args.db) as db:
        examples = load_consensus(db)
        coefficients, validation = train_all(examples)
        if not coefficients:
            raise SystemExit("unavailable: insufficient validated comparisons")
        artifact = {"coefficients": coefficients, "validation": validation}
        args.output.write_text(json.dumps(artifact, sort_keys=True, indent=2), encoding="utf-8")
        if args.publish:
            publish(db, artifact, sum(item["votes"] for item in examples))
        print(json.dumps({"status": "ready", "skills": sorted(coefficients), "published": args.publish}))


def load_consensus(db: sqlite3.Connection) -> list[dict]:
    rows = db.execute(
        "SELECT c.id,c.skill_slug,c.member_a,c.member_b,c.evidence_a_json,c.evidence_b_json,v.outcome "
        "FROM skill_comparisons c JOIN skill_comparison_votes v ON v.comparison_id=c.id "
        "ORDER BY c.id"
    ).fetchall()
    grouped: dict[str, dict] = {}
    for comparison_id, skill, member_a, member_b, left, right, vote in rows:
        record = grouped.setdefault(comparison_id, {
            "id": comparison_id, "skill": skill, "pair": (member_a, member_b), "a": json.loads(left),
            "b": json.loads(right), "votes_by_outcome": Counter(),
        })
        record["votes_by_outcome"][vote] += 1
    accepted = []
    for record in grouped.values():
        counts = record["votes_by_outcome"]
        total = sum(counts.values())
        outcome, votes = counts.most_common(1)[0]
        if total < 3 or votes < math.ceil(2 * total / 3):
            continue
        accepted.append({**record, "label": LABELS[outcome], "votes": total})
    return accepted


def features(snapshot: dict) -> list[float]:
    if "featureTotals" in snapshot:
        return [float(snapshot["featureTotals"].get(category, 0)) / 100.0 for category in CATEGORIES]
    totals = defaultdict(float)
    for achievement in snapshot.get("achievements", []):
        totals[achievement["kind"]] += float(achievement["basePoints"])
    return [totals[category] / 100.0 for category in CATEGORIES]


def train_all(examples: list[dict]) -> tuple[dict, dict]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for example in examples:
        grouped[example["skill"]].append(example)
    coefficients, validation = {}, {}
    for skill, rows in sorted(grouped.items()):
        result = train_skill(rows)
        if result is not None:
            coefficients[skill], validation[skill] = result
    return coefficients, validation


def train_skill(rows: list[dict]) -> tuple[dict, dict] | None:
    if len(rows) < MIN_COMPARISONS:
        return None
    pairs = sorted({row["pair"] for row in rows})
    if len(pairs) < 10:
        return None
    split = int(len(pairs) * 0.8)
    train_pairs = set(pairs[:split])
    train = [row for row in rows if row["pair"] in train_pairs]
    holdout = [row for row in rows if row["pair"] not in train_pairs]
    if not holdout or len({row["label"] for row in train}) < 2:
        return None
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU required for model training")
    device = torch.device("cuda")
    x_train, y_train = tensors(train, device)
    x_test, y_test = tensors(holdout, device)
    raw = torch.nn.Parameter(torch.zeros(len(CATEGORIES), device=device))
    draw = torch.nn.Parameter(torch.zeros((), device=device))
    optimizer = torch.optim.Adam([raw, draw], lr=0.025)
    for _ in range(500):
        optimizer.zero_grad()
        weights = 0.1 + 9.9 * torch.sigmoid(raw)
        logits = comparison_logits(x_train, weights, draw)
        loss = torch.nn.functional.cross_entropy(logits, y_train)
        loss = loss + 0.03 * ((weights - 1.0) ** 2).mean()
        loss.backward()
        optimizer.step()
    with torch.no_grad():
        weights = 0.1 + 9.9 * torch.sigmoid(raw)
        logits = comparison_logits(x_test, weights, draw)
        log_loss = float(torch.nn.functional.cross_entropy(logits, y_test).item())
        accuracy = float((logits.argmax(dim=1) == y_test).float().mean().item())
        counts = torch.bincount(y_train, minlength=3).float() + 1.0
        baseline = -float(torch.log(counts[y_test] / counts.sum()).mean().item())
        if not math.isfinite(log_loss) or log_loss >= baseline:
            return None
        learned = {category: int(round(value * 1000)) for category, value in zip(CATEGORIES, weights.cpu().tolist())}
    return learned, {"heldOut": len(holdout), "logLoss": log_loss,
                     "baselineLogLoss": baseline, "accuracy": accuracy,
                     "device": str(device)}


def tensors(rows: list[dict], device: torch.device) -> tuple[torch.Tensor, torch.Tensor]:
    differences = [[a - b for a, b in zip(features(row["a"]), features(row["b"]))] for row in rows]
    return (torch.tensor(differences, dtype=torch.float32, device=device),
            torch.tensor([row["label"] for row in rows], dtype=torch.long, device=device))


def comparison_logits(differences: torch.Tensor, weights: torch.Tensor,
                      draw: torch.Tensor) -> torch.Tensor:
    margin = differences @ weights
    return torch.stack((margin / 2, draw.expand_as(margin), -margin / 2), dim=1)


def publish(db: sqlite3.Connection, artifact: dict, votes: int) -> None:
    version = db.execute("SELECT COALESCE(MAX(version),0)+1 FROM scoring_model_versions").fetchone()[0]
    db.execute(
        "INSERT INTO scoring_model_versions(version,coefficients_json,validation_json,training_votes,published_at) "
        "VALUES (?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        (version, json.dumps(artifact["coefficients"], sort_keys=True),
         json.dumps(artifact["validation"], sort_keys=True), votes),
    )
    db.commit()


if __name__ == "__main__":
    main()
