import { NextResponse } from "next/server";
import { currentViewer, viewerMayUseOfficerPortal } from "@pytorch-ph/domain-server/identity";

export async function officerApiError() {
  const viewer = await currentViewer();
  if (!viewer.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!viewerMayUseOfficerPortal(viewer)) {
    return NextResponse.json({ error: "Officer portal access is required." }, { status: 403 });
  }
  return null;
}

// For data every signed-in member may read, such as aggregate job-market snapshots.
export async function memberApiError() {
  const viewer = await currentViewer();
  if (!viewer.userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return null;
}
