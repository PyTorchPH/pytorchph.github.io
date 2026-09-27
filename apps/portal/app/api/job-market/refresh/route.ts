import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Browser analytics is read-only. Use controlled backend ingestion for refresh or import." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
