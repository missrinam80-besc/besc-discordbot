import { ApiError } from "./api.ts";
import type { SlotApi, SlotLease } from "./slot-api.ts";
import { SlotSendError, slotPayload, type SlotDiscord } from "./slot-discord.ts";
import type { SlotRecord, SlotState } from "./slot-state.ts";

export function createSlotWorker(api: SlotApi, discord: SlotDiscord, state: SlotState,
  log: (code: string) => void = () => {}, now = Date.now) {
  let active: Promise<void> | undefined;
  let stopped = false;
  async function acknowledge(r: SlotRecord) {
    if (r.phase === "sent") {
      await api.sent(state.workerId, r, r.messageId!);
      state.write(null);
    } else if (r.phase === "fail") {
      await api.fail(state.workerId, r, r.errorCode!);
      // Only a proven refusal authorizes email fallback; all post-dispatch failures stay uncertain.
      state.write(r.errorCode === "dm_closed" ? null : { ...r, phase: "uncertain" });
    }
  }
  async function run() {
    try {
      const pending = state.read();
      if (pending) {
        if (pending.phase === "claimed") {
          // No durable dispatch intent exists, therefore no Discord action was started.
          if (Date.parse(pending.lease_until) > now()) await api.fail(state.workerId, pending, "discord_unavailable");
          state.write(null);
        } else if (pending.phase === "dispatching" || pending.phase === "uncertain") {
          log("slot_reconciliation_required");
        } else { await acknowledge(pending); }
        return;
      }
      const d = await api.claim(state.workerId);
      if (!d) return;
      const lease: SlotLease = { id: d.id, lease_token: d.lease_token, lease_until: d.lease_until };
      state.write({ ...lease, phase: "claimed" });
      // Validate renderability and lease BEFORE dispatch. No external action on invalid input.
      try {
        slotPayload(d);
        if (Date.parse(d.lease_until) - now() < 40_000) throw new SlotSendError("discord_unavailable");
      } catch {
        await api.fail(state.workerId, d, "discord_unavailable");
        state.write(null); return;
      }
      state.write({ ...lease, phase: "dispatching" });
      try { await api.dispatch(state.workerId, d); }
      catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.code === "recipient_no_longer_linked") {
          // The CC handler has already queued email fallback; never substitute another recipient.
          state.write(null);
        } else { log("slot_dispatch_unconfirmed"); }
        return;
      }
      // This is the only send path. Neither restart nor an acknowledgement error enters it again.
      let result: SlotRecord;
      try {
        if (Date.parse(d.lease_until) - now() <= 10_000) throw new SlotSendError("discord_unavailable");
        result = { ...lease, phase: "sent", messageId: await discord.send(d) };
      }
      catch (e) { result = { ...lease, phase: "fail", errorCode: e instanceof SlotSendError ? e.code : "outcome_unknown" }; }
      // Keep this outside the send catch: a failed write must never be mistaken for a Discord refusal.
      state.write(result);
      await acknowledge(state.read()!);
    } catch { log("slot_delivery_unconfirmed"); }
  }
  return {
    tick(): Promise<void> {
      if (stopped) return Promise.resolve();
      if (!active) active = run().finally(() => { active = undefined; });
      return active;
    },
    async stop() { stopped = true; await active; },
  };
}
