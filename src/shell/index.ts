/**
 * Partner wiring entrypoint (optional).
 *
 * Example:
 *
 *   import { MintokenApp } from "@/components/MintokenApp";
 *   import type { ShellHandlers } from "@/shell/types";
 *
 *   const handlers: ShellHandlers = {
 *     onAsk: async (question) => { ... call your API, then setState ... },
 *     onNewChat: async () => { ... },
 *     onSelectChat: async (id) => { ... },
 *     onReset: async () => { ... },
 *     onMarkReplay: async () => { ... },
 *   };
 *
 *   <MintokenApp handlers={handlers} />
 *
 * Or lift state: keep ShellState in your store and pass `initial` + handlers
 * that update that store. The default MintokenApp keeps local shell state only.
 */

export type { ShellHandlers, ShellState, ShellChat, ShellChatMessage } from "./types";
export { createShellState, newShellChat } from "./types";
