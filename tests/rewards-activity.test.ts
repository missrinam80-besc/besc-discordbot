import assert from "node:assert/strict";
import test from "node:test";
import { RewardsActivity, type VoiceFact } from "../src/rewards-activity.ts";
import { parseRewardConfig, type RewardJob } from "../src/rewards-api.ts";
import { examples } from "./support/rewards-fixture.ts";
const start = 1_800_000_000_000, actor = examples.discordUserId as string, channel = examples.configEnabled.rules[0].channel_ids[0] as string;
const other = "222222222222222222", bot = "333333333333333333";
const human = (id: string, patch: Partial<VoiceFact> = {}): VoiceFact => ({ actor: id, channel, known: true, bot: false, muted: false, deafened: false, afk: false, ...patch });
function fixture(patch: Record<string, unknown> = {}) {
  const jobs: RewardJob[] = [], cfg = parseRewardConfig({ ...examples.configEnabled, rules: [{ ...examples.configEnabled.rules[0], ...patch }] }, examples.guildId);
  const c = new RewardsActivity(examples.guildId, job => jobs.push(structuredClone(job))); c.setConfig(cfg, start); c.connection(true);
  const step = (seconds: number, facts = [human(actor), human(other)]) => { const at = start + seconds * 1000; if (seconds >= 60 && seconds % 60 === 0) c.setConfig(cfg, at); c.observe(facts, at); c.tick(at); c.observe(facts, at); };
  return { c, jobs, cfg, step };
}
test("Bucks observer defaults to no config and zero activity", () => {
  const jobs: RewardJob[] = [], c = new RewardsActivity(examples.guildId, x => jobs.push(x)); c.connection(true); c.observe([human(actor), human(other)], start); c.tick(start + 60000); assert.deepEqual(jobs, []);
});
test("Bucks text filters foreign guilds, bot/webhook/system/old messages and cooldown", () => {
  const { c, jobs } = fixture({ kind: "text" }); const id = (BigInt(start - 1420070400000) << 22n).toString();
  const msg = { id, actor, guild: examples.guildId as string | null, channel, bot: false, webhook: false, system: false, timestamp: start };
  for (const patch of [{ guild: null }, { guild: other }, { bot: true }, { webhook: true }, { system: true }, { channel: other }, { timestamp: start - 180000 }]) c.text({ ...msg, ...patch }, start);
  assert.equal(jobs.length, 0); c.text(msg, start); c.text(msg, start + 1000); assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, id); assert.equal(jobs[0].actor, actor); assert.equal("content" in jobs[0].data, false); assert.equal("xp" in jobs[0].data, false);
});
test("Bucks voice requires a complete observed minute and never retroactive startup time", () => {
  const { jobs, step } = fixture(); for (let t = 0; t <= 55; t += 5) step(t); assert.equal(jobs.length, 0); step(60);
  assert.equal(jobs.length, 2); const mine = jobs.find(x => x.actor === actor)!;
  assert.equal(mine.data.started_at, new Date(start).toISOString()); assert.equal(mine.data.occurred_at, new Date(start + 60000).toISOString()); assert.equal(mine.data.eligible_participants, 2);
});
test("Bucks voice excludes bots and unknown members from minimum participants", () => {
  for (const companion of [human(bot, { bot: true }), human(other, { known: false })]) {
    const { jobs, step } = fixture(); for (let t = 0; t <= 60; t += 5) step(t, [human(actor), companion]); assert.equal(jobs.length, 0);
  }
});
for (const flag of ["muted", "deafened", "afk"] as const) {
  test(`Bucks voice resets a partially eligible minute on ${flag}`, () => {
    const { jobs, step } = fixture(); for (let t = 0; t <= 60; t += 5) step(t, [human(actor, t >= 30 && t < 40 ? { [flag]: true } : {}), human(other)]);
    assert.equal(jobs.filter(x => x.actor === actor).length, 0);
  });
}
test("Bucks voice measures conservative participant minimum and any allowed mute/deafen/AFK in interval", () => {
  const { jobs, step } = fixture({ exclude_muted: false, exclude_deafened: false, exclude_afk: false });
  for (let t = 0; t <= 60; t += 5) step(t, [human(actor, { muted: t === 25, deafened: t === 30, afk: t === 35 }), human(other), ...(t < 40 ? [human(bot)] : [])]);
  const mine = jobs.find(x => x.actor === actor)!; assert.equal(mine.data.eligible_participants, 2); assert.equal(mine.data.muted, true); assert.equal(mine.data.deafened, true); assert.equal(mine.data.afk, true);
});
test("Bucks voice permits one participant only when configured and does not infer audible speaking", () => {
  const { jobs, step } = fixture({ voice_min_participants: 1 }); for (let t = 0; t <= 60; t += 5) step(t, [human(actor)]);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].data.eligible_participants, 1); assert.equal("speaking" in jobs[0].data, false);
});
test("Bucks voice resets after disconnect/resume without backfilling the missed period", () => {
  const { c, jobs, step } = fixture(); for (let t = 0; t <= 55; t += 5) step(t); c.connection(false); c.connection(true);
  step(60); assert.equal(jobs.length, 0); for (let t = 65; t <= 120; t += 5) step(t); assert.equal(jobs.length, 2);
  assert.equal(jobs[0].data.started_at, new Date(start + 60000).toISOString());
});
test("Bucks voice resets after a suspended timer and expired config", () => {
  const f = fixture(); f.step(0); f.step(5); f.step(70); assert.equal(f.jobs.length, 0);
  f.c.tick(start + 90001); assert.equal(f.jobs.length, 0);
});
test("Bucks voice channel moves discard the previous partial minute", () => {
  const { jobs, step } = fixture({ channel_ids: [channel, other] });
  for (let t = 0; t <= 100; t += 5) step(t, [human(actor, { channel: t < 40 ? channel : other }), human(bot, { channel: t < 40 ? channel : other })]);
  assert.equal(jobs.length, 2); assert.equal(jobs[0].data.started_at, new Date(start + 40000).toISOString()); assert.equal(jobs[0].data.channel_id, other);
});
test("Bucks disabled/revoked config stops generating jobs immediately", () => {
  const { c, jobs, step } = fixture(); for (let t = 0; t <= 55; t += 5) step(t); c.invalidate(); step(60); assert.equal(jobs.length, 0);
});
