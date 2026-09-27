"use client";

import { useState } from "react";
import { GraduationCap, HandHelping } from "lucide-react";
import { Badge } from "@pytorch-ph/design-system/badge";
import { Button } from "@pytorch-ph/design-system/button";
import { Card } from "@pytorch-ph/design-system/card";
import { FilipinoPhrase } from "@pytorch-ph/design-system/filipino-phrase";
import { communityPeerTutorials, tutorialFitsBand } from "./demo-model";

// Preview of member-to-member tutoring. Sample data only; nothing is booked.
export function PeerTutorials({ accessBand }: { accessBand: string }) {
  const [notice, setNotice] = useState("");
  return <Card className="bg-surface" data-tour="community-tutorials">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="bg-accentSoft p-2 text-accent"><GraduationCap aria-hidden="true" size={20} /></div>
        <div>
          <FilipinoPhrase meaning="Helping one another." phrase="Tulungan" />
          <h2 className="text-xl font-bold">Peer-to-peer tutorials</h2>
          <p className="mt-1 text-sm text-muted">Members teach members. Request a session on something you want to learn, or offer one on something you know.</p>
        </div>
      </div>
      <Button onClick={() => setNotice("Offering a tutorial opens when the community launches. This preview does not save anything.")} size="sm" type="button" variant="secondary"><HandHelping size={15} />Offer a tutorial</Button>
    </div>
    {notice && <p className="mt-4 border border-warning/25 bg-warning/10 px-4 py-3 text-sm" role="status">{notice}</p>}
    <ul className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {communityPeerTutorials.map((tutorial) => <li className="flex flex-col border border-border bg-elevated p-4" key={tutorial.id}>
        <div className="flex flex-wrap items-center gap-2"><Badge className="capitalize">{tutorial.level}</Badge>{tutorialFitsBand(tutorial, accessBand) && <Badge variant="success">Good fit for this profile</Badge>}</div>
        <h3 className="mt-3 font-semibold">{tutorial.topic}</h3>
        <p className="mt-1 text-sm text-muted">{tutorial.summary}</p>
        <p className="mt-3 text-xs text-muted">{tutorial.format} · offered by {tutorial.tutor}</p>
        <Button className="mt-4 self-start" onClick={() => setNotice(`Requesting “${tutorial.topic}” opens when the community launches. This preview does not send a request.`)} size="sm" type="button">Request a session</Button>
      </li>)}
    </ul>
  </Card>;
}
