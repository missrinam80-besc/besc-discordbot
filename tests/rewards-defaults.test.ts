import assert from "node:assert/strict";
import test from "node:test";
import { GatewayIntentBits } from "discord.js";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.ts";
import { createBescCommand } from "../src/commands.ts";
import { createRewardsRuntime, gatewayIntents } from "../src/rewards-runtime.ts";
import { FileRewardState } from "../src/rewards-state.ts";
import { FileSlotState } from "../src/slot-state.ts";
import { apiConfig, binding, examples, response, testDirectory } from "./support/rewards-fixture.ts";

const env = { DISCORD_BOT_TOKEN: "TESTFIXTURE", DISCORD_APPLICATION_ID: binding.applicationId, DISCORD_GUILD_ID: binding.guildId,
  COMMANDCENTER_API_URL: binding.apiUrl, COMMANDCENTER_WEB_URL: "https://fixture.invalid/", BESC_BOT_API_KEY: apiConfig.apiKey };

test("Bucks and automatic activity are independent explicit opt-ins, preserving old defaults", () => {
  const config = loadConfig(env); assert.equal(config.rewardsEnabled, undefined); assert.equal(config.rewardsActivityEnabled, undefined);
  assert.deepEqual(config, loadConfig({ ...env, BESC_REWARDS_ENABLED: "false", BESC_REWARDS_ACTIVITY_ENABLED: "false" }));
  assert.throws(() => loadConfig({ ...env, BESC_REWARDS_ACTIVITY_ENABLED: "true", BESC_BOT_STATE_DIR: tmpdir() }));
  assert.throws(() => loadConfig({ ...env, BESC_REWARDS_ENABLED: "true" }));
  for (const name of ["BESC_REWARDS_ENABLED", "BESC_REWARDS_ACTIVITY_ENABLED"]) assert.throws(() => loadConfig({ ...env, [name]: "yes" }));
  const enabled = loadConfig({ ...env, BESC_REWARDS_ENABLED: "true", BESC_BOT_STATE_DIR: tmpdir() });
  assert.equal(enabled.rewardsEnabled, true); assert.equal(enabled.rewardsActivityEnabled, undefined);
  assert.equal(loadConfig({ ...env, BESC_REWARDS_ENABLED: "true", BESC_REWARDS_ACTIVITY_ENABLED: "true", BESC_BOT_STATE_DIR: tmpdir() }).rewardsActivityEnabled, true);
});

test("Bucks commands are optional and preserve existing ticket and read command definitions", () => {
  const names = (rewards: boolean, tickets: boolean) => createBescCommand(tickets, rewards).toJSON();
  assert.deepEqual(names(false, false).options?.map(x => x.name), ["status", "account", "events"]);
  assert.deepEqual(names(false, true).options?.map(x => x.name), ["status", "account", "events", "ticket"]);
  const combined = names(true, true), existing = names(false, true);
  assert.deepEqual(combined.options?.slice(0, 4), existing.options); assert.equal(combined.options?.at(-1)?.name, "bucks");
  assert.equal(JSON.stringify(combined).includes("discord_user_id"), false);
});

test("Activity requests voice and message metadata intents without adding privileged content or member intents", () => {
  assert.deepEqual(gatewayIntents(false, false), [GatewayIntentBits.Guilds]);
  assert.deepEqual(gatewayIntents(false, true), [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates]);
  assert.deepEqual(gatewayIntents(true, false), [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]);
  assert.equal(new Set(gatewayIntents(true, true)).size, 5);
});

test("Rewards runtime with activity off performs zero config reads and shares state directory with the existing slot journal", async t => {
  const directory = await testDirectory(t), state = new FileRewardState(directory, binding), slots = new FileSlotState(directory, binding);
  let calls = 0; const original = globalThis.fetch; globalThis.fetch = async () => { calls++; throw Error("Unexpected HTTP"); };
  const client = { isReady: () => true } as any;
  const runtime = createRewardsRuntime(client, { ...loadConfig(env), rewardsEnabled: true, stateDir: directory }, state, false);
  try {
    await runtime.start(); runtime.message({} as any); runtime.voice(binding.guildId); runtime.resumed();
    await runtime.stop(); assert.equal(calls, 0); assert.equal(slots.read(), null);
    const reopened = new FileRewardState(directory, binding); reopened.close();
  } finally { globalThis.fetch = original; await runtime.stop(); slots.close(); }
});

test("Rewards shutdown awaits an in-flight config read without starting delayed timers or activity", async t => {
  const directory = await testDirectory(t), state = new FileRewardState(directory, binding);
  let release!: (response: Response) => void, stopped = false, calls = 0;
  const original = globalThis.fetch; globalThis.fetch = async () => { calls++; return new Promise<Response>(resolve => { release = resolve; }); };
  const runtime = createRewardsRuntime({ isReady: () => true } as any, { ...loadConfig(env), rewardsEnabled: true, rewardsActivityEnabled: true }, state, true);
  try {
    const start = runtime.start(), stop = runtime.stop().then(() => { stopped = true; });
    await Promise.resolve(); assert.equal(stopped, false); assert.equal(calls, 1);
    release(response(examples.configDisabled)); await Promise.all([start, stop]); assert.equal(stopped, true);
    await runtime.start(); runtime.resumed(); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; await runtime.stop(); }
});
