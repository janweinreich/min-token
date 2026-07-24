import { NextRequest, NextResponse } from "next/server";
import { runUserPrompt } from "@/engine/loop";
import { newChatSession } from "@/engine/seed";
import { getState, resetState, setState } from "@/lib/store";
import { toShellState } from "@/shell/map";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const state = getState();
  const view = request.nextUrl.searchParams.get("view");

  if (view === "policy") {
    return new NextResponse(
      state.cited_policy_markdown ?? "# mintoken routing policy\n\nNo policy has been promoted yet.",
      { headers: { "content-type": "text/markdown; charset=utf-8" } },
    );
  }
  if (view === "memory") return NextResponse.json(state.memory);
  return NextResponse.json(toShellState(state));
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: string;
      question?: string;
      chat_id?: string;
    };
    let state = getState();

    switch (body.action) {
      case "ask": {
        if (!body.question?.trim()) {
          return NextResponse.json({ error: "Question is required." }, { status: 400 });
        }
        state = setState((await runUserPrompt(state, body.question)).state);
        break;
      }
      case "new-chat": {
        const chat = newChatSession();
        state = setState({
          ...state,
          chats: [chat, ...state.chats],
          active_chat_id: chat.id,
        });
        break;
      }
      case "select-chat": {
        if (!body.chat_id || !state.chats.some((chat) => chat.id === body.chat_id)) {
          return NextResponse.json({ error: "Chat not found." }, { status: 404 });
        }
        state = setState({ ...state, active_chat_id: body.chat_id });
        break;
      }
      case "reset":
        state = resetState();
        break;
      case "mark-replay": {
        if (!state.sponsor_status.replay) {
          state = setState({
            ...state,
            sponsor_status: { ...state.sponsor_status, replay: true },
            events: [
              ...state.events,
              {
                id: `evt-replay-${Date.now()}`,
                at: new Date().toISOString(),
                source: "engine",
                summary: "Replay LoopQA completed on the public experience.",
              },
            ],
          });
        }
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    return NextResponse.json(toShellState(state));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected Darwin loop error.",
      },
      { status: 500 },
    );
  }
}
