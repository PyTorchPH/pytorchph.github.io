"use client";

import Link from "next/link";
import { InfoPopover } from "@pytorch-ph/design-system/info-popover";
import { rankingLevels, rankingSteps } from "@pytorch-ph/domain-protocol/leaderboards";

// Hidden until opened: how points work and how to climb the ladder.
export function RankingGuide() {
  return (
    <InfoPopover label="How ranking works" showLabel title="How to raise your rank">
      <ol className="list-decimal space-y-1.5 pl-5">
        {rankingSteps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <p className="mt-3 font-semibold">Points by result</p>
      <table className="mt-1 w-full text-left text-xs">
        <caption className="sr-only">Point multiplier for each verified result</caption>
        <tbody>
          {rankingLevels.map((item) => (
            <tr className="border-t border-border align-top" key={item.level}>
              <th className="py-1.5 pr-2 font-semibold" scope="row">{item.label}</th>
              <td className="py-1.5 pr-2 font-mono">×{item.multiplier}</td>
              <td className="py-1.5 text-muted">{item.example}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted">Ang tier at division ay batay sa verified points kumpara sa verified members ng napiling season. Pareho ang tier kapag tied ang points; Unranked kapag wala pang verified points. Tingnan ang <Link className="text-accent underline underline-offset-2" href="/leaderboards">leaderboards</Link> para sa standings.</p>
    </InfoPopover>
  );
}
