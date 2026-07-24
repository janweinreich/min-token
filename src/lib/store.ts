import type { DarwinState } from "@/engine/types";
import { createInitialState, newChatSession } from "@/engine/seed";
import { listMemory } from "@/lib/answer-memory";

declare global {
  var __budgetDarwinState: DarwinState | undefined;
}

function withChats(s: DarwinState): DarwinState {
  if (s.chats?.length && s.active_chat_id) return s;
  const chat = newChatSession();
  return {
    ...s,
    chats: s.chats?.length ? s.chats : [chat],
    active_chat_id: s.active_chat_id ?? chat.id,
  };
}

export function getState(): DarwinState {
  if (!globalThis.__budgetDarwinState) {
    const s = createInitialState();
    s.memory = listMemory();
    globalThis.__budgetDarwinState = s;
  }
  const next = withChats(globalThis.__budgetDarwinState);
  globalThis.__budgetDarwinState = next;
  return next;
}

export function setState(next: DarwinState): DarwinState {
  globalThis.__budgetDarwinState = withChats(next);
  return globalThis.__budgetDarwinState;
}

export function resetState(): DarwinState {
  const s = createInitialState();
  s.memory = listMemory();
  globalThis.__budgetDarwinState = s;
  return s;
}
