// Chart data for "UpSkill radar" and "Merit activity blocks", built only from the member's own
// verified records; nothing here is sample data.
// Module map (caller-first):
//   upskillRadar     verified skill points → top skills scored 0–100 against the strongest skill
//   meritBlocks      verified evidence by kind, plus events and ready resumes
//   isVerified       an evidence item a source or the member confirmed

import type { EvidenceItem } from "@pytorch-ph/domain-protocol/career-evidence";
import type { MemberOverview } from "@pytorch-ph/domain-protocol/leaderboards";

const RADAR_AXES = 6;
const MIN_RADAR_AXES = 3;

export type RadarPoint = { skill: string; score: number };
export type MeritBlock = { name: string; value: number };

/** Null when fewer than three skills have verified points: a radar needs at least three axes. */
export function upskillRadar(skillPoints: MemberOverview["skillPoints"]): RadarPoint[] | null {
  const top = [...skillPoints].filter((item) => item.points > 0).sort((a, b) => b.points - a.points).slice(0, RADAR_AXES);
  if (top.length < MIN_RADAR_AXES) return null;
  const strongest = top[0].points;
  return top.map((item) => ({ skill: item.skill, score: Math.round((item.points / strongest) * 100) }));
}

export function meritBlocks(summary: MemberOverview["summary"], items: EvidenceItem[]): MeritBlock[] {
  const verified = items.filter(isVerified);
  return [
    { name: "Experience", value: verified.filter((item) => item.evidenceKind === "experience").length },
    { name: "Projects", value: verified.filter((item) => item.evidenceKind === "project").length },
    { name: "Events", value: summary.registeredEvents },
    { name: "Resumes", value: summary.readyResumes },
  ];
}

export const isVerified = (item: EvidenceItem) => item.verificationState === "source_matched" || item.verificationState === "user_verified";
