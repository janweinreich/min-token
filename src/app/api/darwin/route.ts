import { NextResponse } from "next/server";

/**
 * Stub API. Partner: replace with real Darwin / mintoken loop wiring.
 * UI shell does not call this by default.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    shell: true,
    message: "UI shell only. Wire /api/darwin (or replace handlers on MintokenApp).",
  });
}

export async function POST() {
  return NextResponse.json(
    {
      shell: true,
      error: "Not wired. Implement POST actions (ask, new-chat, reset, mark-replay).",
    },
    { status: 501 },
  );
}
