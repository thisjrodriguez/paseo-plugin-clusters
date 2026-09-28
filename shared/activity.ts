/**
 * When a project was last used.
 *
 * Only marks the user leaves count. The daemon rewrites every agent record when it restarts, and
 * re-derives workspace status from scratch, so `updatedAt`, `lastActivityAt` and `statusEnteredAt`
 * all jump to "now" for every project at once. Reading those as use put every project back into
 * Recents after each restart, however short the window.
 */

export function toMs(value: string | null | undefined): number {
  const at = Date.parse(value ?? "");
  return Number.isNaN(at) ? 0 : at;
}

/** Only the fields that say something about use; the bookkeeping ones are deliberately absent. */
export interface AgentLike {
  workspaceId?: string;
  createdAt?: string | null;
  lastUserMessageAt?: string | null;
}

/** The user's last message to this session, or failing that when they created it. 0 if neither. */
export function usedAt(agent: AgentLike): number {
  return toMs(agent.lastUserMessageAt) || toMs(agent.createdAt);
}
