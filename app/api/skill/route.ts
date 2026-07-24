import { readFile } from "node:fs/promises";
import { agent, writeSkill } from "../../agent.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The skill the agent has written for itself, as it stands right now. */
export async function GET() {
  const a = agent();
  await a.ready;
  try {
    const md = await readFile("skills/routing/SKILL.md", "utf8");
    return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  } catch {
    return new Response(await writeSkill(a), {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }
}
