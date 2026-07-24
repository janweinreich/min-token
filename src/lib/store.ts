import type { DarwinState } from "@/engine/types";
import { createInitialState } from "@/engine/seed";
import { listMemory } from "@/lib/answer-memory";

declare global {
  var __budgetDarwinState: DarwinState | undefined;
}

export function getState(): DarwinState {
  if (!globalThis.__budgetDarwinState) {
    const s = createInitialState();
    s.memory = listMemory();
    globalThis.__budgetDarwinState = s;
  }
  return globalThis.__budgetDarwinState;
}

export function setState(next: DarwinState): DarwinState {
  globalThis.__budgetDarwinState = next;
  return next;
}

export function resetState(): DarwinState {
  const s = createInitialState();
  s.memory = listMemory();
  globalThis.__budgetDarwinState = s;
  return s;
}
