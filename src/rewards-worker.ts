import { ApiError } from "./api.ts";
import type { RewardsApi, RewardJob } from "./rewards-api.ts";
import type { RewardState, RewardRecord } from "./rewards-state.ts";

const fatal = new Set(["invalid_client", "insufficient_scope", "guild_not_allowed"]);
const beforeReceipt = new Set(["account_unavailable", "membership_required", "linked_membership_required", "not_found"]);
const invalidRequest = new Set(["idempotency_conflict", "invalid_fields", "invalid_query", "invalid_offset", "invalid_discord_id", "invalid_event_id", "invalid_body", "body_too_large", "json_required", "method_not_allowed"]);
const declined = new Set(["insufficient_bucks", "out_of_stock", "reward_unavailable", "invalid_state", "linked_membership_required", "account_unavailable", "membership_required", "stale_version", "cooldown", "daily_limit", "activity_expired", "voice_ineligible", "activity_disabled", "not_found"]);
export function createRewardsWorker(api: RewardsApi, state: RewardState, activityEnabled: boolean,
  log: (code: string) => void = () => {}, now = Date.now) {
  let active: Promise<void> | undefined, stopped = false, paused = false, lastDispatch = -Infinity;
  async function run() {
    if (paused || stopped || now() - lastDispatch < 500) return;
    try {
      const r = state.pending(now(), activityEnabled); if (!r) return;
      if (r.attempts >= 8) { state.update({ ...r, phase: "attention" }); log("rewards_reconciliation_required"); return; }
      const expired = r.operation === "activity" && Date.parse(String(r.data.occurred_at)) < now() - 120_000;
      if (expired && r.attempts === 0) { state.update({ ...r, phase: "rejected", error: "activity_expired" }); return; }
      const sending: RewardRecord = { ...r, attempts: r.attempts + 1 };
      // Persist the same immutable body and original interaction/event ID before I/O.
      state.update(sending); lastDispatch = now();
      try {
        const { id, actor, operation, data } = sending;
        const result = await api.write({ id, actor, operation, data });
        state.update({ ...sending, phase: "done", result, error: undefined });
      } catch (e) {
        const code = e instanceof ApiError ? e.code : "api_unavailable";
        if (fatal.has(code)) {
          state.update({ ...sending, error: code }); paused = true; log("rewards_client_unavailable"); return;
        }
        // Account authorization runs before CC receipt lookup. Losing it after an
        // uncertain dispatch cannot establish that the earlier mutation failed.
        if (r.attempts > 0 && beforeReceipt.has(code)) {
          state.update({ ...sending, phase: "attention", error: code }); log("rewards_reconciliation_required"); return;
        }
        if (declined.has(code)) { state.update({ ...sending, phase: "rejected", error: code }); return; }
        if (invalidRequest.has(code) || sending.attempts >= 8) {
          state.update({ ...sending, phase: "attention", error: code }); log("rewards_reconciliation_required"); return;
        }
        const delay = code === "rate_limited" ? 60_000 : Math.min(60_000, 1000 * 2 ** sending.attempts);
        state.update({ ...sending, error: code, nextAttemptAt: now() + delay });
        log("rewards_retry_pending");
      }
    } catch { paused = true; log("rewards_state_unavailable"); }
  }
  return {
    available: () => !paused && !stopped,
    enqueue(job: RewardJob) { if (paused || stopped) throw Error("rewards_unavailable"); return state.enqueue(job, now()); },
    read: (op: RewardJob["operation"], id: string) => state.read(op, id),
    outstanding: (actor: string) => state.outstanding(actor),
    tick() { if (stopped) return Promise.resolve(); if (!active) active = run().finally(() => { active = undefined; }); return active; },
    async stop() { stopped = true; await active; },
  };
}
export type RewardsWorker = ReturnType<typeof createRewardsWorker>;
