import { DarwinApp } from "@/components/DarwinApp";
import { createInitialState } from "@/engine/seed";
import { listMemory } from "@/lib/answer-memory";

export const dynamic = "force-dynamic";

export default function Home() {
  const initial = createInitialState();
  initial.memory = listMemory();
  return <DarwinApp initial={initial} />;
}
