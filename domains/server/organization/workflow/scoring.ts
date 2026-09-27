import type { Department } from "@pytorch-ph/domain-protocol/organization/workflow";

/**
 * Officer scoring / accountability. Two dimensions:
 * - speed: how fast the officer responded / closed the task (auto-measurable).
 * - quality: VOTE-BASED (peers/officers vote) — never auto-judged by AI; a human confirms.
 */

export interface TaskCompletion {
  taskId: string;
  officerUserId: string;
  department: Department;
  assignedAt: string; // ISO
  completedAt: string; // ISO
}

export interface QualityVote {
  taskId: string;
  voterUserId: string;
  score: number; // e.g. 1..5
  castAt: string; // ISO
}

export interface OfficerScore {
  officerUserId: string;
  responseHours: number; // derived from completion timestamps
  qualityAvg: number | null; // null until votes exist
  voteCount: number;
}

export interface OfficerScoring {
  /** Speed from the completion timestamps (pure, auto). */
  responseTimeHours(completion: TaskCompletion): number;
  /** Aggregate vote-based quality. HITL: a human confirms before it becomes official. */
  aggregate(officerUserId: string, completions: TaskCompletion[], votes: QualityVote[]): OfficerScore;
}

/** Speed is implemented (pure); quality aggregation is a stub pending the voting model. */
export class VoteBasedOfficerScoring implements OfficerScoring {
  responseTimeHours(completion: TaskCompletion): number {
    const ms = Date.parse(completion.completedAt) - Date.parse(completion.assignedAt);
    return Math.max(0, ms / 3_600_000);
  }

  aggregate(
    _officerUserId: string,
    _completions: TaskCompletion[],
    _votes: QualityVote[],
  ): OfficerScore {
    throw new Error(
      "not implemented: VoteBasedOfficerScoring.aggregate — needs the voting model + HITL confirmation step",
    );
  }
}
