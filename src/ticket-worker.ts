import { randomUUID } from "node:crypto";
import type { Delivery, TicketApi } from "./ticket-api.ts";
export class DeliveryError extends Error {
  code: string; uncertain: boolean;
  constructor(code: "discord_unavailable" | "permission_denied" | "thread_missing" | "unexpected_participants" | "duplicate_marker" | "outcome_unknown", uncertain = true) {
    super(code); this.code = code; this.uncertain = uncertain;
  }
}
export interface TicketDiscord { execute(d: Delivery): Promise<Record<string, unknown>>; }
export function createTicketWorker(api: TicketApi, discord: TicketDiscord, log: (code: string) => void = () => {}, worker = `worker_${randomUUID()}`) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      const deliveries = await api.claim(worker);
      // CC claims at most one delivery per ticket. Independent tickets start together,
      // so a slow earlier ticket cannot expire another ticket's untouched lease.
      await Promise.all(deliveries.map(async d => {
        if (Date.parse(d.leasedUntil) - Date.now() < 10_000) return;
        let result: Record<string, unknown>;
        try { result = await discord.execute(d); }
        catch (e) {
          const failure = e instanceof DeliveryError ? e : new DeliveryError("outcome_unknown");
          try { await api.fail(d, worker, failure.code, failure.uncertain); } catch { log("delivery_failure_ack_unavailable"); }
          return;
        }
        // Never repeat a Discord effect because the acknowledgement failed.
        try { await api.complete(d, worker, result); } catch { log("delivery_complete_ack_unavailable"); }
      }));
    } catch { log("delivery_claim_unavailable"); }
    finally { running = false; }
  };
}
