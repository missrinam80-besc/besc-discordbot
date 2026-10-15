import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { FileV2State } from "../src/ticket-v2-state.ts";
import { FileSlotState } from "../src/slot-state.ts";

const guild = "100000000000000001", app = "200000000000000001", parent = "300000000000000001";
const id = "40000000-0000-4000-8000-000000000001", message = "500000000000000001";
const env = { DISCORD_BOT_TOKEN: "TESTFIXTURE", DISCORD_APPLICATION_ID: app, DISCORD_GUILD_ID: guild,
  COMMANDCENTER_API_URL: "https://fixture.invalid/api/v1/bot/", COMMANDCENTER_WEB_URL: "https://fixture.invalid",
  BESC_BOT_API_KEY: `bb_fixture.${"a".repeat(43)}`, DISCORD_TICKET_PARENT_CHANNEL_ID: parent };
const binding = { apiUrl: env.COMMANDCENTER_API_URL, applicationId: app, guildId: guild, clientId: "fixture" };
const sent = { id, lease_token: id, lease_until: "2099-10-14T10:02:00Z", phase: "sent" as const, messageId: message };

for (const ticketing of [false, true]) for (const slots of [false, true]) {
  test(`Combined opt-ins remain independent: ticketing=${ticketing}, slots=${slots}`, () => {
    const config = loadConfig({ ...env, BESC_TICKETING_V2: String(ticketing), BESC_SLOT_WORKER_ENABLED: String(slots), BESC_BOT_STATE_DIR: tmpdir() });
    assert.equal(config.ticketingV2, ticketing); assert.equal(config.slotWorkerEnabled === true, slots);
    assert.equal(config.stateDir, tmpdir()); assert.equal(config.ticketParentChannelId, parent);
    if (!ticketing) assert.doesNotThrow(() => loadConfig({ ...env, DISCORD_TICKET_PARENT_CHANNEL_ID: "",
      BESC_SLOT_WORKER_ENABLED: String(slots), BESC_BOT_STATE_DIR: tmpdir() }));
  });
}
test("Either enabled worker requires absolute durable storage; V2 alone requires legacy parent", () => {
  for (const flags of [{ BESC_TICKETING_V2: "true" }, { BESC_SLOT_WORKER_ENABLED: "true" },
    { BESC_TICKETING_V2: "true", BESC_SLOT_WORKER_ENABLED: "true" }]) {
    assert.throws(() => loadConfig({ ...env, ...flags }));
    assert.throws(() => loadConfig({ ...env, ...flags, BESC_BOT_STATE_DIR: "relative-state" }));
  }
  assert.throws(() => loadConfig({ ...env, DISCORD_TICKET_PARENT_CHANNEL_ID: "", BESC_TICKETING_V2: "true", BESC_BOT_STATE_DIR: tmpdir() }));
});
test("Panel effects and slot send proofs coexist and survive reopen in the same volume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "besc-combined-")); let slot: FileSlotState | undefined;
  try {
    const panels = new FileV2State(directory, guild, app); await panels.load();
    slot = new FileSlotState(directory, binding); const worker = slot.workerId;
    await Promise.all([panels.parent(parent), panels.remember(id, { guild, channel: parent, message,
      payloadHash: "a".repeat(64), marker: `besc-panel-${id}` }), Promise.resolve().then(() => slot!.write(sent))]);
    slot.close(); slot = new FileSlotState(directory, binding);
    const reopenedPanels = new FileV2State(directory, guild, app); await reopenedPanels.load();
    assert.equal(slot.workerId, worker); assert.deepEqual(slot.read(), sent);
    assert.deepEqual(reopenedPanels.parents(), [parent]); assert.equal(reopenedPanels.effect(id)?.message, message);
    await reopenedPanels.forget(id); assert.deepEqual(slot.read(), sent);
    slot.write(null); assert.deepEqual(reopenedPanels.parents(), [parent]);
  } finally { slot?.close(); await rm(directory, { recursive: true, force: true }); }
});
test("Corrupt V2 state does not overwrite a pending slot send proof", async () => {
  const directory = await mkdtemp(join(tmpdir(), "besc-combined-")); let slot: FileSlotState | undefined;
  try {
    slot = new FileSlotState(directory, binding); slot.write(sent);
    await writeFile(join(directory, `${guild}-${app}.json`), "{corrupt");
    await assert.rejects(new FileV2State(directory, guild, app).load());
    assert.deepEqual(slot.read(), sent);
    slot.close(); slot = new FileSlotState(directory, binding); assert.deepEqual(slot.read(), sent);
  } finally { slot?.close(); await rm(directory, { recursive: true, force: true }); }
});
