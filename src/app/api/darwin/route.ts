import { NextRequest, NextResponse } from "next/server";
import { runGeneration } from "@/engine/loop";
import { getState, resetState, setState } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get("view");
  const state = getState();

  if (view === "policy") {
    const body =
      state.cited_policy_markdown ??
      `# Routing Policy v${state.policy.version}\n\nNo promoted policy yet. Run a generation until Guild promotes.\n`;
    return new NextResponse(body, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  if (view === "memory") {
    return NextResponse.json({
      stats: state.memory_stats,
      records: state.memory,
    });
  }

  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
  };
  const action = body.action ?? "run-generation";
  let state = getState();

  if (action === "reset") {
    state = resetState();
    return NextResponse.json(state);
  }

  if (action === "mark-replay") {
    state = setState({
      ...state,
      sponsor_status: { ...state.sponsor_status, replay: true },
      events: [
        ...state.events,
        {
          id: `evt-replay-${Date.now()}`,
          at: new Date().toISOString(),
          source: "engine",
          summary: "Replay QA marked complete on this deploy.",
        },
      ],
    });
    return NextResponse.json(state);
  }

  if (action === "toggle-autopilot") {
    state = setState({ ...state, autopilot: !state.autopilot });
    return NextResponse.json(state);
  }

  if (action === "run-generation") {
    if (state.running) {
      return NextResponse.json(
        { error: "Generation already running", state },
        { status: 409 },
      );
    }
    setState({ ...state, running: true });
    try {
      const result = await runGeneration(getState());
      setState(result.state);
      return NextResponse.json(result.state);
    } catch (err) {
      const cur = getState();
      setState({ ...cur, running: false });
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : String(err),
          state: getState(),
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
