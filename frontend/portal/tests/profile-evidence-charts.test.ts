import assert from "node:assert/strict";
import test from "node:test";
import { meritBlocks, upskillRadar } from "../app/dashboard/profile/evidence-charts";

const summary = { verifiedEvidence: 3, readyResumes: 1, registeredEvents: 2, activeOpportunities: 0, points: 120, rank: 4, streak: 1 };
const item = (id: string, evidenceKind: "experience" | "project", verificationState: "draft" | "source_matched" | "user_verified") =>
  ({ id, sourceId: "s", evidenceKind, title: id, organization: "", role: "", dateLabel: "", description: "", quantitative: [], qualitative: [], skills: [], mediaUrl: "", mediaAlt: "", verificationState });

test("the radar needs three verified skills and scores them against the strongest", () => {
  assert.equal(upskillRadar([{ skill: "PyTorch", points: 40 }, { skill: "NLP", points: 10 }]), null);
  assert.deepEqual(upskillRadar([{ skill: "NLP", points: 10 }, { skill: "PyTorch", points: 40 }, { skill: "MLOps", points: 20 }, { skill: "Vision", points: 0 }]), [
    { skill: "PyTorch", score: 100 }, { skill: "MLOps", score: 50 }, { skill: "NLP", score: 25 },
  ]);
});

test("merit blocks count only verified evidence plus events and ready resumes", () => {
  const blocks = meritBlocks(summary, [item("a", "experience", "source_matched"), item("b", "project", "user_verified"), item("c", "project", "draft")]);
  assert.deepEqual(blocks, [{ name: "Experience", value: 1 }, { name: "Projects", value: 1 }, { name: "Events", value: 2 }, { name: "Resumes", value: 1 }]);
});
