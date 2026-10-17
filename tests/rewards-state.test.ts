import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { FileRewardState } from "../src/rewards-state.ts";
import { binding, job, accepted, testDirectory } from "./support/rewards-fixture.ts";
const now = 1_800_000_000_000;

test("Bucks journal preserves a pending action and exact identity across restart", async t => {
  const dir = await testDirectory(t); let s = new FileRewardState(dir, binding);
  s.enqueue(job, now); const first = s.read(job.operation, job.id); s.close();
  s = new FileRewardState(dir, binding); try { assert.deepEqual(s.read(job.operation, job.id), first); assert.equal(s.outstanding(job.actor), true); } finally { s.close(); }
});
test("Bucks journal deduplicates identical bodies and rejects changed actors or amounts", async t => {
  const s = new FileRewardState(await testDirectory(t), binding); try {
    assert.deepEqual(s.enqueue(job, now), s.enqueue(structuredClone(job), now + 1));
    assert.throws(() => s.enqueue({ ...job, actor: "222222222222222222" }, now), /idempotency_conflict/);
    assert.throws(() => s.enqueue({ ...job, data: { ...job.data, version: 2 } }, now), /idempotency_conflict/);
    assert.throws(() => s.enqueue({ ...job, id: "1558853872766689383" }, now), /previous_action_unresolved/);
  } finally { s.close(); }
});
test("Bucks journal cannot silently abandon pending work on client rotation", async t => {
  const dir = await testDirectory(t), s = new FileRewardState(dir, binding); s.enqueue(job, now); s.close();
  assert.throws(() => new FileRewardState(dir, { ...binding, clientId: "rotated-fixture" }), /previous_binding_unresolved/);
  const reopened = new FileRewardState(dir, binding); reopened.update({ ...reopened.read(job.operation, job.id)!, phase: "done", attempts: 1, result: accepted }); reopened.close();
  const rotated = new FileRewardState(dir, { ...binding, clientId: "rotated-fixture" }); rotated.close();
});
test("Bucks process lock refuses a second process and keeps stale locks intact", async t => {
  const dir = await testDirectory(t), s = new FileRewardState(dir, binding), path = s.path;
  assert.throws(() => new FileRewardState(dir, binding)); s.close();
  await writeFile(path + ".lock", "TESTFIXTURE stale lock"); assert.throws(() => new FileRewardState(dir, binding));
  assert.equal(await readFile(path + ".lock", "utf8"), "TESTFIXTURE stale lock");
});
test("Bucks corrupt state fails closed without replacement", async t => {
  const dir = await testDirectory(t), s = new FileRewardState(dir, binding), path = s.path; s.close();
  await writeFile(path, "{TESTFIXTURE corrupt"); assert.throws(() => new FileRewardState(dir, binding));
  assert.equal(await readFile(path, "utf8"), "{TESTFIXTURE corrupt");
});
test("Bucks invalid saved success result cannot become a valid receipt", async t => {
  const dir = await testDirectory(t), s = new FileRewardState(dir, binding); s.enqueue(job, now); const path = s.path; s.close();
  const saved = JSON.parse(await readFile(path, "utf8")); saved.records[0].phase = "done"; saved.records[0].result = { ...accepted, reservedDelta: -60 };
  await writeFile(path, JSON.stringify(saved)); assert.throws(() => new FileRewardState(dir, binding), /state_invalid/);
});
test("Bucks disk failure poisons the journal before any further writes", async t => {
  const s = new FileRewardState(await testDirectory(t), binding); try {
    await unlink(s.path); await mkdir(s.path); assert.throws(() => s.enqueue(job, now), /state_unavailable/);
    assert.throws(() => s.read(job.operation, job.id), /state_unavailable/);
  } finally { s.close(); }
});
test("Bucks pending command takes priority, and disabled activity remains untouched", async t => {
  const s = new FileRewardState(await testDirectory(t), binding); try {
    const time = now, stamp = new Date(time).toISOString(), key = (BigInt(time - 1420070400000) << 22n).toString();
    const activity = { id: key, actor: job.actor, operation: "activity" as const, data: { kind: "text", channel_id: binding.guildId, occurred_at: stamp } };
    s.enqueue(activity, now); assert.equal(s.pending(now, false), undefined); s.enqueue(job, now);
    assert.equal(s.pending(now, true)?.operation, "request");
    const disk = await readFile(s.path, "utf8"); assert.equal(disk.includes("apiKey"), false); assert.equal(disk.includes("token"), false); assert.equal(disk.includes("messageContent"), false);
  } finally { s.close(); }
});
