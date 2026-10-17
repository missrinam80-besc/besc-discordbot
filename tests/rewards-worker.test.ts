import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/api.ts";
import { FileRewardState } from "../src/rewards-state.ts";
import { createRewardsWorker } from "../src/rewards-worker.ts";
import { binding, job, accepted, baseApi, testDirectory } from "./support/rewards-fixture.ts";
const start = 1_800_000_000_000;

test("Bucks persists dispatch attempt before I/O and records successful result", async t => {
  const s = new FileRewardState(await testDirectory(t), binding); try {
    const api = baseApi(); let calls = 0; api.write = async input => { calls++; assert.deepEqual(input, job); assert.equal(s.read(job.operation, job.id)?.attempts, 1); return accepted; };
    const w = createRewardsWorker(api, s, false, undefined, () => start); w.enqueue(job);
    await Promise.all([w.tick(), w.tick()]); assert.equal(calls, 1); assert.equal(w.read(job.operation, job.id)?.phase, "done");
    await w.tick(); assert.equal(calls, 1); await w.stop();
  } finally { s.close(); }
});
test("Bucks lost answer survives reopen and retries the exact original ID and body", async t => {
  const dir = await testDirectory(t); let s = new FileRewardState(dir, binding), clock = start, calls = 0;
  const api = baseApi(); api.write = async input => { calls++; assert.deepEqual(input, job); if (calls === 1) throw new ApiError("api_timeout", 503); return accepted; };
  let w = createRewardsWorker(api, s, false, undefined, () => clock); w.enqueue(job); await w.tick(); assert.equal(w.read(job.operation, job.id)?.phase, "pending"); await w.stop(); s.close();
  clock += 10_000; s = new FileRewardState(dir, binding); try {
    w = createRewardsWorker(api, s, false, undefined, () => clock); await w.tick(); assert.equal(calls, 2); assert.equal(w.read(job.operation, job.id)?.phase, "done"); await w.stop();
  } finally { s.close(); }
});
test("Bucks lost answer followed by account unlink remains unresolved rather than claiming the first write failed", async t => {
  const s = new FileRewardState(await testDirectory(t), binding); try {
    let clock = start, calls = 0; const api = baseApi(); api.write = async () => { calls++; throw new ApiError(calls === 1 ? "api_timeout" : "linked_membership_required", calls === 1 ? 503 : 403); };
    const w = createRewardsWorker(api, s, false, undefined, () => clock); w.enqueue(job); await w.tick(); clock += 5000; await w.tick();
    assert.equal(w.read(job.operation, job.id)?.phase, "attention"); assert.equal(w.outstanding(job.actor), true);
    assert.throws(() => w.enqueue({ ...job, id: "1558853872766689383" }), /previous_action_unresolved/);
  } finally { s.close(); }
});
for (const code of ["account_unavailable", "membership_required", "linked_membership_required", "insufficient_bucks", "stale_version", "out_of_stock", "daily_limit", "cooldown"]) {
  test(`Bucks terminal business outcome ${code} is not retried under another key`, async t => {
    const s = new FileRewardState(await testDirectory(t), binding); try {
      const api = baseApi(); let calls = 0; api.write = async () => { calls++; throw new ApiError(code, 422); };
      const w = createRewardsWorker(api, s, false, undefined, () => start); w.enqueue(job); await w.tick(); await w.tick();
      assert.equal(calls, 1); assert.equal(w.read(job.operation, job.id)?.phase, "rejected"); assert.equal(w.outstanding(job.actor), false);
    } finally { s.close(); }
  });
}
for (const code of ["invalid_client", "insufficient_scope", "guild_not_allowed"]) {
  test(`Bucks halts only its worker on ${code}, preserving unresolved request`, async t => {
    const s = new FileRewardState(await testDirectory(t), binding); try {
      const api = baseApi(); api.write = async () => { throw new ApiError(code, 403); }; const logs: string[] = [];
      const w = createRewardsWorker(api, s, false, x => logs.push(x), () => start); w.enqueue(job); await w.tick();
      assert.equal(w.available(), false); assert.equal(w.read(job.operation, job.id)?.phase, "pending"); assert.deepEqual(logs, ["rewards_client_unavailable"]);
    } finally { s.close(); }
  });
}
test("Bucks conflict remains attention-worthy and blocks a second request from that actor", async t => {
  const s = new FileRewardState(await testDirectory(t), binding); try {
    const api = baseApi(); api.write = async () => { throw new ApiError("idempotency_conflict", 409); };
    const w = createRewardsWorker(api, s, false, undefined, () => start); w.enqueue(job); await w.tick();
    assert.equal(w.read(job.operation, job.id)?.phase, "attention"); assert.equal(w.outstanding(job.actor), true);
    assert.throws(() => w.enqueue({ ...job, id: "1558853872766689383" }), /previous_action_unresolved/);
  } finally { s.close(); }
});
test("Bucks 429 retries no earlier than a minute and stop prevents new writes", async t => {
  const s = new FileRewardState(await testDirectory(t), binding); try {
    let clock = start, calls = 0; const api = baseApi(); api.write = async () => { calls++; throw new ApiError("rate_limited", 429); };
    const w = createRewardsWorker(api, s, false, undefined, () => clock); w.enqueue(job); await w.tick(); clock += 59_000; await w.tick(); assert.equal(calls, 1);
    await w.stop(); clock += 20_000; await w.tick(); assert.equal(calls, 1); assert.throws(() => w.enqueue(job), /unavailable/);
  } finally { s.close(); }
});
test("Bucks expires only never-dispatched old activity, keeping an uncertain activity retryable", async t => {
  const s = new FileRewardState(await testDirectory(t), binding); try {
    const time = start - 180_000, id = (BigInt(time - 1420070400000) << 22n).toString();
    const activity = { id, actor: job.actor, operation: "activity" as const, data: { kind: "text", channel_id: binding.guildId, occurred_at: new Date(time).toISOString() } };
    const api = baseApi(); let calls = 0; api.write = async () => { calls++; return { ok: true, requestId: null, xpDelta: 1, bucksDelta: 1, reservedDelta: 0 }; };
    const w = createRewardsWorker(api, s, true, undefined, () => start); w.enqueue(activity); await w.tick(); assert.equal(calls, 0); assert.equal(w.read("activity", id)?.error, "activity_expired");
    const next = { ...activity, id: (BigInt(time - 1420070400000) << 22n | 1n).toString() }; s.enqueue(next, start); s.update({ ...s.read("activity", next.id)!, attempts: 1 });
    await w.tick(); assert.equal(calls, 1); assert.equal(w.read("activity", next.id)?.phase, "done");
  } finally { s.close(); }
});
test("Bucks invalid success or repeated network loss stays unresolved after the bounded retry budget", async t => {
  const s = new FileRewardState(await testDirectory(t), binding); try {
    let clock = start; const api = baseApi(); let calls = 0; api.write = async () => { calls++; throw new ApiError("invalid_response", 502); };
    const w = createRewardsWorker(api, s, false, undefined, () => clock); w.enqueue(job);
    for (let n = 0; n < 10; n++) { await w.tick(); clock += 100_000; }
    assert.equal(calls, 8); assert.equal(w.read(job.operation, job.id)?.phase, "attention");
  } finally { s.close(); }
});
