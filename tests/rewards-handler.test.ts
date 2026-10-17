import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { MessageFlags } from "discord.js";
import { ApiError } from "../src/api.ts";
import { createRewardsHandler, type RewardsInteraction } from "../src/rewards-handler.ts";
import { FileRewardState } from "../src/rewards-state.ts";
import { createRewardsWorker } from "../src/rewards-worker.ts";
import { accepted, baseApi, binding, examples, testDirectory } from "./support/rewards-fixture.ts";

let sequence = 1558853872766689400n;
function interaction(sub = "beloningen", customId?: string, values?: string[], actor = examples.discordUserId) {
  const messages: any[] = [], deferrals: any[] = [];
  const value = {
    id: String(sequence++), user: { id: actor }, guildId: binding.guildId, commandName: "besc", customId, values,
    message: { author: { id: binding.applicationId } },
    options: { getSubcommandGroup: () => "bucks", getSubcommand: () => sub, getInteger: () => null as number | null },
    isChatInputCommand: () => !customId, isButton: () => Boolean(customId && !values), isStringSelectMenu: () => Boolean(customId && values),
    async reply(v: any) { messages.push(v); }, async deferReply(v: any) { deferrals.push(v); },
    async deferUpdate() { deferrals.push("update"); }, async editReply(v: any) { messages.push(v); },
  };
  return { value, messages, deferrals, typed: value as unknown as RewardsInteraction };
}
const component = (m: any, row = 0, column = 0): string => m.components[row].components[column].custom_id;
async function setup(t: TestContext) {
  t.after(async () => { await worker.stop(); state.close(); });
  const state = new FileRewardState(await testDirectory(t), binding), api = baseApi(); let now = 1_800_000_000_000;
  const worker = createRewardsWorker(api, state, false, undefined, () => now);
  const handler = createRewardsHandler(api, worker, binding.guildId, binding.applicationId, undefined, () => now);
  return { state, api, worker, handler, advance: (ms: number) => { now += ms; } };
}

test("Bucks private balance reads the actual actor and suppresses mentions", async t => {
  const s = await setup(t); let actor = ""; s.api.account = async a => { actor = a; return examples.account; };
  const i = interaction("saldo"); await s.handler(i.typed);
  assert.equal(actor, examples.discordUserId); assert.equal(i.deferrals[0].flags, MessageFlags.Ephemeral);
  assert.match(i.messages[0].content, /40 Bucks/); assert.match(i.messages[0].content, /150/);
  assert.deepEqual(i.messages[0].allowedMentions, { parse: [] });
});

test("Bucks request requires an explicit actor-bound confirmation before durable write", async t => {
  const s = await setup(t); const written: any[] = []; s.api.write = async j => { written.push(j); assert.ok(s.state.read(j.operation, j.id)); return accepted; };
  const list = interaction(); await s.handler(list.typed); const chooseId = component(list.messages[0]);
  const forged = interaction("", chooseId, [examples.catalog.items[0].id], "222222222222222222"); await s.handler(forged.typed);
  assert.match(forged.messages[0].content, /hoort niet bij jou/); assert.equal(written.length, 0);
  const select = interaction("", chooseId, [examples.catalog.items[0].id]); await s.handler(select.typed);
  assert.equal(written.length, 0); assert.match(select.messages[0].content, /gereserveerd/);
  const confirm = interaction("", component(select.messages[0])); await s.handler(confirm.typed);
  assert.equal(written.length, 1); assert.equal(written[0].actor, examples.discordUserId); assert.equal(written[0].id, confirm.value.id);
  assert.deepEqual(written[0].data, examples.requestEnvelope.data); assert.match(confirm.messages[0].content, /is aangevraagd/);
  await s.handler(confirm.typed); assert.equal(written.length, 1); assert.equal(confirm.messages.length, 1);
  const reused = interaction("", confirm.value.customId); await s.handler(reused.typed); assert.match(reused.messages[0].content, /verlopen/); assert.equal(written.length, 1);
});

test("Bucks cancellation preserves the selected request/version and releases only after receipt", async t => {
  const s = await setup(t); let written: any;
  s.api.write = async j => { written = j; return { ...accepted, reservedDelta: -60 }; };
  const list = interaction("aanvragen"); await s.handler(list.typed);
  const select = interaction("", component(list.messages[0]), [examples.requests.requests[0].id]); await s.handler(select.typed);
  assert.equal(written, undefined); const confirm = interaction("", component(select.messages[0])); await s.handler(confirm.typed);
  assert.equal((written as any).operation, "cancel"); assert.deepEqual((written as any).data, { id: examples.requests.requests[0].id, version: 1 });
  assert.match(confirm.messages[0].content, /vrijgegeven/);
});

test("Bucks stale, foreign-app, foreign-guild and restarted contexts perform no writes", async t => {
  const s = await setup(t); let calls = 0; s.api.write = async () => { calls++; return accepted; };
  const list = interaction(); await s.handler(list.typed); const id = component(list.messages[0]);
  const foreign = interaction("", id, [examples.catalog.items[0].id]); foreign.value.message.author.id = "333333333333333333";
  await s.handler(foreign.typed); assert.match(foreign.messages[0].content, /verlopen/);
  const guild = interaction("", id); guild.value.guildId = "333333333333333333"; await s.handler(guild.typed); assert.match(guild.messages[0].content, /ingestelde BESC/);
  const freshHandler = createRewardsHandler(s.api, s.worker, binding.guildId, binding.applicationId);
  const restart = interaction("", id); await freshHandler(restart.typed); assert.match(restart.messages[0].content, /verlopen/);
  s.advance(30 * 60_000 + 1); const expired = interaction("", id); await s.handler(expired.typed); assert.match(expired.messages[0].content, /verlopen/); assert.equal(calls, 0);
});

test("Bucks account unlink between selection and confirmation is a refusal without success claim", async t => {
  const s = await setup(t); s.api.write = async () => { throw new ApiError("linked_membership_required", 403); };
  const list = interaction(); await s.handler(list.typed); const select = interaction("", component(list.messages[0]), [examples.catalog.items[0].id]); await s.handler(select.typed);
  const confirm = interaction("", component(select.messages[0])); await s.handler(confirm.typed);
  assert.match(confirm.messages[0].content, /actief BESC-lidmaatschap/); assert.equal(s.state.read("request", confirm.value.id)?.phase, "rejected");
});

test("Bucks uncertain outcome never claims failure or issues a second financial action", async t => {
  const s = await setup(t); let calls = 0; s.api.write = async () => { calls++; throw new ApiError("invalid_response", 200); };
  async function select() { const list = interaction(); await s.handler(list.typed); const i = interaction("", component(list.messages[0]), [examples.catalog.items[0].id]); await s.handler(i.typed); return interaction("", component(i.messages[0])); }
  const first = await select(); await s.handler(first.typed); assert.match(first.messages[0].content, /nog niet bevestigd/);
  const second = await select(); await s.handler(second.typed); assert.match(second.messages[0].content, /eerdere aanvraag/); assert.equal(calls, 1);
});

test("Bucks completed decisions display their reason without a cancel action", async t => {
  const s = await setup(t); s.api.requests = async () => ({ ...examples.requests, requests: [{ ...examples.requests.requests[0], status: "rejected", reason: "TESTFIXTURE reden @everyone" }] });
  const list = interaction("aanvragen"); await s.handler(list.typed); const select = interaction("", component(list.messages[0]), [examples.requests.requests[0].id]); await s.handler(select.typed);
  assert.match(select.messages[0].content, /Afgewezen/); assert.match(select.messages[0].content, /TESTFIXTURE reden/);
  assert.equal(select.messages[0].components[0].components[0].label, "Terug naar aanvragen"); assert.deepEqual(select.messages[0].allowedMentions.parse, []);
});

test("Bucks pagination uses server offsets; invalid pages and sold-out options cannot mutate", async t => {
  const s = await setup(t); const offsets: number[] = [];
  s.api.catalog = async (_actor, offset = 0) => { offsets.push(offset); return { items: [{ ...examples.catalog.items[0], available_stock: 0 }], nextOffset: offset ? null : 25 }; };
  const list = interaction(); await s.handler(list.typed); assert.equal(list.messages[0].components[0].components.length, 1);
  const next = interaction("", component(list.messages[0])); await s.handler(next.typed); assert.deepEqual(offsets, [0, 25]);
  const invalid = interaction(); invalid.value.options.getInteger = () => 4001; await s.handler(invalid.typed); assert.deepEqual(offsets, [0, 25]);
});
