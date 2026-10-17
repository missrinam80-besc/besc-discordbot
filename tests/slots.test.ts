import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { ApiError } from "../src/api.ts";
import { createSlotApi, type SlotApi, type SlotDelivery } from "../src/slot-api.ts";
import { createSlotDiscord, slotPayload, SlotSendError } from "../src/slot-discord.ts";
import { FileSlotState, type SlotRecord, type SlotState } from "../src/slot-state.ts";
import { createSlotWorker } from "../src/slot-worker.ts";
import { loadConfig } from "../src/config.ts";
import { fixtureKey } from "../scripts/fixture.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/event-slot-bookings.json", import.meta.url), "utf8"));
const delivery = (): SlotDelivery => ({ ...fixture.delivery });
const config = { apiUrl: "https://cc.invalid/api/v1/bot/", apiKey: fixtureKey, guildId: fixture.guild_id };
const binding = { apiUrl: config.apiUrl, guildId: config.guildId, applicationId: "500000000000000001", clientId: "fixture-slots" };
const messageId = fixture.sent.message_id;
const dmId = "600000000000000001";
const lease = { id: fixture.delivery.id, lease_token: fixture.delivery.lease_token, lease_until: fixture.delivery.lease_until };
function context() {
  const directory = mkdtempSync(join(tmpdir(), "besc-slots-"));
  let state = new FileSlotState(directory, binding);
  const calls: string[] = [];
  const api: SlotApi = { claim: async () => { calls.push("claim"); return delivery(); },
    dispatch: async () => { calls.push("dispatch"); }, sent: async () => { calls.push("sent"); },
    fail: async (_worker, _d, code) => { calls.push(`fail:${code}`); } };
  const discord = { send: async () => { calls.push("send"); return messageId; } };
  return { directory, get state() { return state; }, calls, api, discord,
    reopen() { state.close(); state = new FileSlotState(directory, binding); return state; },
    close() { state.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("Shared CC fixture: exact POST paths, body, auth and guild; no command actor or extra fields", async () => {
  const calls: { op: string; body: unknown }[] = [];
  const api = createSlotApi(config, (async (url, options) => {
    const u = new URL(String(url)); assert.equal(u.origin, "https://cc.invalid"); assert.equal(u.search, "");
    assert.equal(options?.method, "POST"); assert.equal(options?.redirect, "error");
    const headers = options?.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${fixtureKey}`); assert.equal(headers["Content-Type"], "application/json");
    const body = JSON.parse(String(options?.body)); assert.ok(Buffer.byteLength(String(options?.body)) <= 8192);
    const op = u.pathname.split("/").at(-1)!; calls.push({ op, body });
    return Response.json(op === "claim" ? { delivery: fixture.delivery } : { ok: true });
  }) as typeof fetch);
  const d = await api.claim(fixture.worker_id); assert.deepEqual(d, fixture.delivery);
  await api.dispatch(fixture.worker_id, d!); await api.sent(fixture.worker_id, d!, messageId); await api.fail(fixture.worker_id, d!, "dm_closed");
  assert.deepEqual(calls, ["claim", "dispatch", "sent", "fail"].map(op => ({ op, body: fixture[op] })));
});

for (const value of [{}, { delivery: {} }, { delivery: { ...fixture.delivery, discord_user_id: "x" } },
  { delivery: { ...fixture.delivery, reference: "arbitrary-ref" } }, { delivery: { ...fixture.delivery, lease_until: "never" } },
  { delivery: { ...fixture.delivery, subject: "" } }, { delivery: { ...fixture.delivery, body: null } }]) {
  test(`Malformed claim rejected: ${JSON.stringify(value).slice(0, 95)}`, async () => {
    const api = createSlotApi(config, (async () => Response.json(value)) as typeof fetch);
    await assert.rejects(api.claim(fixture.worker_id), (e: unknown) => e instanceof ApiError && e.code === "invalid_response");
  });
}
test("Empty queue and strict dispatch/ack confirmation", async () => {
  assert.equal(await createSlotApi(config, (async () => Response.json({ delivery: null })) as typeof fetch).claim(fixture.worker_id), null);
  for (const value of [{}, { ok: false }, { ok: "true" }]) {
    const api = createSlotApi(config, (async () => Response.json(value)) as typeof fetch);
    await assert.rejects(api.dispatch(fixture.worker_id, lease)); await assert.rejects(api.sent(fixture.worker_id, lease, messageId));
    await assert.rejects(api.fail(fixture.worker_id, lease, "outcome_unknown"));
  }
});
test("Worker/lease/message validation before HTTP", async () => {
  const api = createSlotApi(config, (async () => { assert.fail("No request permitted"); }) as typeof fetch);
  for (const worker of ["short", "x".repeat(41), "bad worker!"]) await assert.rejects(api.claim(worker));
  await assert.rejects(api.sent(fixture.worker_id, lease, "not-a-snowflake"));
  await assert.rejects(api.dispatch(fixture.worker_id, { ...lease, id: "bad" }));
});
for (const [status, code] of [[401, "invalid_client"], [403, "insufficient_scope"], [403, "guild_not_allowed"],
  [409, "recipient_no_longer_linked"], [429, "rate_limited"], [503, "slot_delivery_unavailable"]] as const) {
  test(`CC rejection ${status} ${code} preserved without secret detail`, async () => {
    const api = createSlotApi(config, (async () => Response.json({ error: { code, secret: "never log" } }, { status })) as typeof fetch);
    await assert.rejects(api.dispatch(fixture.worker_id, lease), (e: unknown) => e instanceof ApiError && e.code === code && e.status === status && !e.message.includes("never log"));
  });
}
test("Real HTTP request and stalled CC response body are cancelled", async () => {
  let stalled = false;
  const server = createServer(async (req, res) => {
    assert.equal(req.method, "POST"); const chunks: Buffer[] = []; for await (const c of req) chunks.push(c);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), fixture.claim);
    res.writeHead(200, { "Content-Type": "application/json" });
    if (stalled) res.write('{"delivery":'); else res.end(JSON.stringify({ delivery: fixture.delivery }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const localConfig = { ...config, apiUrl: `http://127.0.0.1:${address.port}/api/v1/bot/` };
    // Allow cold local HTTP startup under parallel test load, then exercise the
    // short body deadline on the already-established connection.
    assert.deepEqual(await createSlotApi(localConfig, fetch, 2000).claim(fixture.worker_id), delivery()); stalled = true;
    const api = createSlotApi(localConfig, fetch, 500);
    await assert.rejects(api.claim(fixture.worker_id), (e: unknown) => e instanceof ApiError && e.code === "api_timeout");
  } finally { server.close(); server.closeAllConnections(); }
});

test("Only confirmed dispatch leads to one send; proof is durable before ack", async () => {
  const c = context();
  try {
    c.api.dispatch = async () => { assert.equal(c.state.read()?.phase, "dispatching"); c.calls.push("dispatch"); };
    c.api.sent = async (worker, d, id) => {
      c.calls.push("sent"); assert.equal(worker, c.state.workerId); assert.equal(d.lease_token, lease.lease_token); assert.equal(id, messageId);
      const persisted = JSON.parse(readFileSync(c.state.path, "utf8")); assert.equal(persisted.active.messageId, messageId); assert.equal(persisted.active.phase, "sent");
    };
    await createSlotWorker(c.api, c.discord, c.state).tick();
    assert.deepEqual(c.calls, ["claim", "dispatch", "send", "sent"]); assert.equal(c.state.read(), null);
  } finally { c.close(); }
});
test("Lost sent acknowledgement: restart retains worker, lease and message ID, retries only sent", async () => {
  const c = context();
  try {
    const workerId = c.state.workerId; c.api.sent = async () => { c.calls.push("lost-sent"); throw Error("network lost"); };
    await createSlotWorker(c.api, c.discord, c.state).tick(); assert.equal(c.state.read()?.phase, "sent");
    c.reopen(); assert.equal(c.state.workerId, workerId);
    c.api.sent = async (worker, d, id) => { c.calls.push("resume-sent"); assert.equal(worker, workerId); assert.equal(d.lease_token, lease.lease_token); assert.equal(id, messageId); };
    await createSlotWorker(c.api, c.discord, c.state).tick();
    assert.deepEqual(c.calls, ["claim", "dispatch", "send", "lost-sent", "resume-sent"]); assert.equal(c.state.read(), null);
  } finally { c.close(); }
});
test("Expired sent acknowledgement is retained for reconciliation and never triggers a send/claim", async () => {
  const c = context();
  try {
    c.state.write({ ...lease, lease_until: "2000-01-01T00:00:00Z", phase: "sent", messageId });
    c.api.sent = async () => { c.calls.push("sent-rejected"); throw new ApiError("slot_delivery_unavailable", 503); };
    const worker = createSlotWorker(c.api, c.discord, c.reopen()); await worker.tick(); await worker.tick();
    assert.deepEqual(c.calls, ["sent-rejected", "sent-rejected"]); assert.equal(c.state.read()?.messageId, messageId);
  } finally { c.close(); }
});
test("Lost failure acknowledgement resumes only fail, including after restart", async () => {
  const c = context(); try {
    c.discord.send = async () => { c.calls.push("send"); throw new SlotSendError("dm_closed"); };
    c.api.fail = async () => { c.calls.push("lost-fail"); throw Error("response lost"); };
    await createSlotWorker(c.api, c.discord, c.state).tick(); assert.equal(c.state.read()?.phase, "fail");
    c.api.fail = async (_worker, _d, code) => { c.calls.push(`resume:${code}`); };
    await createSlotWorker(c.api, c.discord, c.reopen()).tick();
    assert.deepEqual(c.calls, ["claim", "dispatch", "send", "lost-fail", "resume:dm_closed"]); assert.equal(c.state.read(), null);
  } finally { c.close(); }
});
for (const error of [Error("lost dispatch"), new ApiError("api_timeout", 503), new ApiError("invalid_response", 502),
  new ApiError("insufficient_scope", 403), new ApiError("slot_delivery_unavailable", 503)]) {
  test(`Dispatch ${error.message}: no Discord, no blind new claim after restart`, async () => {
    const c = context();
    try {
      c.api.dispatch = async () => { c.calls.push("dispatch-error"); throw error; };
      await createSlotWorker(c.api, c.discord, c.state).tick();
      const restarted = createSlotWorker(c.api, c.discord, c.reopen()); await restarted.tick(); await restarted.tick();
      assert.deepEqual(c.calls, ["claim", "dispatch-error"]); assert.equal(c.state.read()?.phase, "dispatching");
    } finally { c.close(); }
  });
}
test("Unlinked recipient at dispatch uses CC fallback without DM", async () => {
  const c = context(); try {
    c.api.dispatch = async () => { c.calls.push("unlink"); throw new ApiError("recipient_no_longer_linked", 409); };
    await createSlotWorker(c.api, c.discord, c.state).tick(); assert.deepEqual(c.calls, ["claim", "unlink"]); assert.equal(c.state.read(), null);
  } finally { c.close(); }
});
for (const phase of ["claimed", "dispatching", "uncertain", "sent", "fail"] as const) {
  test(`Recovery from durable ${phase} never sends Discord again`, async () => {
    const c = context(); try {
      c.state.write({ ...lease, phase, ...(phase === "sent" ? { messageId } : {}), ...(phase === "fail" ? { errorCode: "dm_closed" as const } : {}) });
      await createSlotWorker(c.api, c.discord, c.reopen()).tick();
      assert.ok(!c.calls.includes("send") && !c.calls.includes("claim") && !c.calls.includes("dispatch"));
      assert.deepEqual(c.calls, phase === "claimed" ? ["fail:discord_unavailable"] : phase === "sent" ? ["sent"] : phase === "fail" ? ["fail:dm_closed"] : []);
    } finally { c.close(); }
  });
}
for (const code of ["dm_closed", "discord_unavailable", "outcome_unknown"] as const) {
  test(`Send failure ${code}: exact fail code; only closed DMs release to email`, async () => {
    const c = context(); try {
      c.discord.send = async () => { c.calls.push("send"); throw new SlotSendError(code); };
      await createSlotWorker(c.api, c.discord, c.state).tick();
      assert.deepEqual(c.calls, ["claim", "dispatch", "send", `fail:${code}`]);
      assert.equal(c.state.read()?.phase ?? null, code === "dm_closed" ? null : "uncertain");
      if (code !== "dm_closed") { await createSlotWorker(c.api, c.discord, c.reopen()).tick(); assert.equal(c.calls.length, 4); }
    } finally { c.close(); }
  });
}
test("Unknown send exception reports outcome_unknown, never dm_closed", async () => {
  const c = context(); try {
    c.discord.send = async () => { throw Error("timeout with secret payload"); };
    const logs: string[] = []; await createSlotWorker(c.api, c.discord, c.state, code => logs.push(code)).tick();
    assert.deepEqual(c.calls, ["claim", "dispatch", "fail:outcome_unknown"]); assert.equal(c.state.read()?.phase, "uncertain");
    assert.ok(!JSON.stringify(logs).includes("secret"));
  } finally { c.close(); }
});
test("Expired / short lease and oversized CC content are rejected before dispatch", async () => {
  for (const d of [{ ...delivery(), lease_until: "2000-01-01T00:00:00Z" }, { ...delivery(), lease_until: new Date(Date.now() + 15_000).toISOString() },
    { ...delivery(), body: "x".repeat(4097) }]) {
    const c = context(); try {
      c.api.claim = async () => { c.calls.push("claim"); return d; };
      await createSlotWorker(c.api, c.discord, c.state).tick(); assert.deepEqual(c.calls, ["claim", "fail:discord_unavailable"]);
    } finally { c.close(); }
  }
});
test("Lease expires during dispatch: no Discord effect", async () => {
  const c = context(); let now = Date.now(); const d = { ...delivery(), lease_until: new Date(now + 120_000).toISOString() };
  try {
    c.api.claim = async () => d; c.api.dispatch = async () => { c.calls.push("dispatch"); now += 120_000; };
    await createSlotWorker(c.api, c.discord, c.state, undefined, () => now).tick();
    assert.deepEqual(c.calls, ["dispatch", "fail:discord_unavailable"]); assert.equal(c.state.read()?.phase, "uncertain");
  } finally { c.close(); }
});
test("Overlapping polls share one attempt; stop drains and prevents new attempts", async () => {
  const c = context(); try {
    const worker = createSlotWorker(c.api, c.discord, c.state);
    await Promise.all([worker.tick(), worker.tick(), worker.tick()]); await worker.stop(); await worker.tick();
    assert.deepEqual(c.calls, ["claim", "dispatch", "send", "sent"]);
  } finally { c.close(); }
});
test("A failed durable write before dispatch prevents every external effect", async () => {
  const c = context(); try {
    const broken: SlotState = { workerId: c.state.workerId, read: () => null, write: () => { throw Error("disk full"); } };
    await createSlotWorker(c.api, c.discord, broken).tick(); assert.deepEqual(c.calls, ["claim"]);
  } finally { c.close(); }
});
test("Real journal write failure poisons the writer and preserves prior durable evidence", async () => {
  const c = context(); const temp = `${c.state.path}.tmp`;
  try {
    c.state.write({ ...lease, phase: "claimed" }); mkdirSync(temp);
    assert.throws(() => c.state.write({ ...lease, phase: "dispatching" }));
    assert.throws(() => c.state.read()); assert.throws(() => c.state.write(null));
    const persisted = JSON.parse(readFileSync(c.state.path, "utf8")); assert.equal(persisted.active.phase, "claimed");
    rmSync(temp, { recursive: true }); c.reopen(); assert.equal(c.state.read()?.phase, "claimed");
  } finally { c.close(); }
});
test("Lost disk after send never fabricates refusal or acknowledgement", async () => {
  const c = context(); try {
    const broken: SlotState = { workerId: c.state.workerId, read: () => c.state.read(), write: r => {
      if (r?.phase === "sent") throw Error("disk full after Discord"); c.state.write(r);
    } };
    await createSlotWorker(c.api, c.discord, broken).tick();
    await createSlotWorker(c.api, c.discord, c.reopen()).tick();
    assert.deepEqual(c.calls, ["claim", "dispatch", "send"]); assert.equal(c.state.read()?.phase, "dispatching");
  } finally { c.close(); }
});

test("Durable journal binds app/server/client/origin and excludes recipients, content and secrets", () => {
  const c = context(); try {
    c.state.write({ ...delivery(), phase: "sent", messageId } as SlotRecord);
    const raw = readFileSync(c.state.path, "utf8");
    for (const value of [fixture.delivery.body, fixture.delivery.subject, fixture.delivery.discord_user_id, fixtureKey]) assert.ok(!raw.includes(value));
    assert.throws(() => new FileSlotState(c.directory, binding));
    for (const change of [{ guildId: "700000000000000001" }, { applicationId: "700000000000000001" }, { clientId: "other" }, { apiUrl: "https://other.invalid/api/v1/bot/" }]) {
      const other = new FileSlotState(c.directory, { ...binding, ...change });
      assert.notEqual(other.path, c.state.path); assert.equal(other.read(), null); other.close();
    }
  } finally { c.close(); }
});
test("Corrupt journal fails closed without resetting existing evidence", () => {
  const c = context(); const path = c.state.path; c.state.close();
  try {
    writeFileSync(path, "{corrupt"); assert.throws(() => new FileSlotState(c.directory, binding));
    assert.equal(readFileSync(path, "utf8"), "{corrupt");
  } finally { rmSync(c.directory, { recursive: true, force: true }); }
});
test("Stale process lock blocks startup; explicit operator removal retains uncertain evidence", () => {
  const c = context(); const path = c.state.path;
  try {
    c.state.write({ ...lease, phase: "dispatching" }); c.state.close(); writeFileSync(`${path}.lock`, "stale process");
    assert.throws(() => new FileSlotState(c.directory, binding));
    // Test-only simulation of an operator confirming no process and clearing just the lock.
    unlinkSync(`${path}.lock`); const recovered = new FileSlotState(c.directory, binding);
    assert.equal(recovered.read()?.phase, "dispatching"); recovered.close();
  } finally { rmSync(c.directory, { recursive: true, force: true }); }
});

test("Discord sender uses only CC recipient/content/reference, mentions disabled and no redirect", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const d = { ...delivery(), body: "@everyone <@123456789012345678> TESTFIXTURE" };
  const discord = createSlotDiscord("fixture-token", (async (url, options) => {
    assert.equal(options?.redirect, "error"); assert.equal(options?.method, "POST");
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bot fixture-token");
    calls.push({ url: String(url), body: JSON.parse(String(options?.body)) });
    return Response.json(calls.length === 1 ? { id: dmId, type: 1, recipients: [{ id: d.discord_user_id }] } : { id: messageId, channel_id: dmId });
  }) as typeof fetch);
  assert.equal(await discord.send(d), messageId);
  assert.deepEqual(calls, [{ url: "https://discord.com/api/v10/users/@me/channels", body: { recipient_id: d.discord_user_id } },
    { url: `https://discord.com/api/v10/channels/${dmId}/messages`, body: slotPayload(d) }]);
  const payload = slotPayload(d); assert.deepEqual(payload.allowed_mentions.parse, []);
  assert.equal(payload.embeds[0].description, d.body); assert.equal(payload.embeds[0].footer.text, d.reference);
});
for (const [status, code, expected] of [[403, 50007, "dm_closed"], [403, 50013, "discord_unavailable"],
  [429, 50007, "discord_unavailable"], [503, 50007, "discord_unavailable"]] as const) {
  test(`Discord ${status}/${code} -> ${expected}; no automatic HTTP retry`, async () => {
    let calls = 0;
    const discord = createSlotDiscord("fixture-token", (async () => { calls++; return Response.json({ code }, { status }); }) as typeof fetch);
    await assert.rejects(discord.send(delivery()), (e: unknown) => e instanceof SlotSendError && e.code === expected); assert.equal(calls, 1);
  });
}
test("Wrong DM recipient/channel response never posts message", async () => {
  for (const value of [{ id: dmId, type: 3, recipients: [{ id: fixture.delivery.discord_user_id }] },
    { id: dmId, type: 1, recipients: [{ id: "700000000000000001" }] }]) {
    let calls = 0;
    const discord = createSlotDiscord("fixture", (async () => { calls++; return Response.json(value); }) as typeof fetch);
    await assert.rejects(discord.send(delivery())); assert.equal(calls, 1);
  }
});
test("Lost Discord message response never retries send or fabricates message ID", async () => {
  let calls = 0;
  const discord = createSlotDiscord("fixture", (async () => {
    calls++; if (calls === 1) return Response.json({ id: dmId, type: 1, recipients: [{ id: fixture.delivery.discord_user_id }] });
    throw Error("Discord may have created the message");
  }) as typeof fetch);
  await assert.rejects(discord.send(delivery()), (e: unknown) => e instanceof SlotSendError && e.code === "outcome_unknown"); assert.equal(calls, 2);
});
test("Proven closed DM at message POST, after successful DM opening, requests email fallback", async () => {
  let calls = 0;
  const discord = createSlotDiscord("fixture", (async () => ++calls === 1
    ? Response.json({ id: dmId, type: 1, recipients: [{ id: fixture.delivery.discord_user_id }] })
    : Response.json({ code: 50007 }, { status: 403 })) as typeof fetch);
  await assert.rejects(discord.send(delivery()), (e: unknown) => e instanceof SlotSendError && e.code === "dm_closed"); assert.equal(calls, 2);
});
test("Discord total deadline covers body consumption with actual AbortSignal", async () => {
  let aborted = false;
  const discord = createSlotDiscord("fixture", (async (_url, options) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"id":'));
    options?.signal?.addEventListener("abort", () => { aborted = true; controller.error(Error("aborted")); });
  } }))) as typeof fetch, 20);
  await assert.rejects(discord.send(delivery()), (e: unknown) => e instanceof SlotSendError && e.code === "outcome_unknown"); assert.equal(aborted, true);
});
test("Invalid, oversized and wrong-channel Discord results are uncertain", async () => {
  for (const response of [() => new Response("not JSON"), () => new Response("x".repeat(65_537)),
    () => Response.json({ id: messageId, channel_id: "700000000000000001" })]) {
    let calls = 0;
    const discord = createSlotDiscord("fixture", (async () => ++calls === 1
      ? Response.json({ id: dmId, type: 1, recipients: [{ id: fixture.delivery.discord_user_id }] }) : response()) as typeof fetch);
    await assert.rejects(discord.send(delivery()), (e: unknown) => e instanceof SlotSendError && e.code === "outcome_unknown"); assert.equal(calls, 2);
  }
});
test("Slot opt-in defaults off, validates absolute persistent path, and does not change existing command config", () => {
  const env = { DISCORD_BOT_TOKEN: "fixture", DISCORD_APPLICATION_ID: binding.applicationId, DISCORD_GUILD_ID: binding.guildId,
    COMMANDCENTER_API_URL: config.apiUrl, COMMANDCENTER_WEB_URL: "https://cc.invalid", BESC_BOT_API_KEY: fixtureKey };
  const before = loadConfig(env); assert.equal(before.slotWorkerEnabled, undefined); assert.equal(before.stateDir, undefined);
  for (const value of ["yes", "1"]) assert.throws(() => loadConfig({ ...env, BESC_SLOT_WORKER_ENABLED: value }));
  assert.throws(() => loadConfig({ ...env, BESC_SLOT_WORKER_ENABLED: "true" }));
  assert.throws(() => loadConfig({ ...env, BESC_SLOT_WORKER_ENABLED: "true", BESC_BOT_STATE_DIR: "relative" }));
  const enabled = loadConfig({ ...env, BESC_SLOT_WORKER_ENABLED: "true", BESC_BOT_STATE_DIR: tmpdir() });
  assert.deepEqual(enabled, { ...before, slotWorkerEnabled: true, stateDir: tmpdir() });
  assert.deepEqual(loadConfig({ ...env, BESC_SLOT_DISCORD_NOTIFICATIONS_ENABLED: "true" }), before);
});
