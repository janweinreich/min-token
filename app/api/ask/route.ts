import { handle } from "../../agent.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { question, autoApprove = true } = (await req.json()) as {
      question?: string;
      autoApprove?: boolean;
    };
    if (!question?.trim()) {
      return Response.json({ error: "question is required" }, { status: 400 });
    }
    return Response.json(await handle(question.trim(), autoApprove));
  } catch (e) {
    return Response.json({ error: String(e).slice(0, 500) }, { status: 500 });
  }
}
