import assert from "node:assert/strict";
import test from "node:test";
import { rankingLevels, summarizePeers, type LeaderboardEntry } from "@pytorch-ph/domain-protocol/leaderboards";

const entry = (rank: number, points: number, isCurrentUser = false): LeaderboardEntry => ({
  rank, points, isCurrentUser, displayLabel: `Member ${rank}`, tier: "Gold", division: "I",
  verifiedPoints: points - 100, pendingPoints: 100, streak: rank, verifiedSkills: Array.from({ length: rank }, (_, index) => `skill-${index}`),
});

test("peer summary compares the current member with the median and the leader", () => {
  // Arrange
  const entries = [entry(1, 4000), entry(2, 3000, true), entry(3, 2000), entry(4, 1000)];

  // Act
  const summary = summarizePeers(entries, 40);

  // Assert
  assert.ok(summary);
  assert.equal(summary.rank, 2);
  assert.equal(summary.topPercent, 5);
  assert.deepEqual(summary.metrics[0], { key: "points", label: "Season points", you: 3000, median: 2500, leader: 4000 });
});

test("peer summary is unavailable without the current member or without peers", () => {
  assert.equal(summarizePeers([entry(1, 4000), entry(2, 3000)], 2), null);
  assert.equal(summarizePeers([entry(1, 4000, true)], 1), null);
});

test("ranking levels reward winning the most", () => {
  const multipliers = rankingLevels.map((level) => level.multiplier);
  assert.deepEqual(multipliers, [...multipliers].sort((a, b) => a - b));
  assert.equal(rankingLevels.at(-1)?.level, "winner_top_award");
});
