import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ApiError } from "../src/api.ts";
import { createRewardsApi, parseRewardConfig, validRewardJob } from "../src/rewards-api.ts";
import { examples, apiConfig, response, job } from "./support/rewards-fixture.ts";

test("Bucks API consumes the shared CC fixtures and strips unrelated fields", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://fixture.invalid");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${apiConfig.apiKey}`); assert.equal(init?.redirect, "error");
    assert.equal(url.searchParams.get("guild_id"), examples.guildId);
    const resource = url.pathname.split("/").at(-1)!;
    return response({ ...examples[resource === "config" ? "configDisabled" : resource], privateField: "TESTFIXTURE" });
  };
  const api = createRewardsApi(apiConfig, fetcher);
  const account = await api.account(examples.discordUserId); assert.equal(account.available, 40); assert.equal("privateField" in account, false);
  assert.equal((await api.catalog(examples.discordUserId)).items[0].price, 60);
  assert.equal((await api.requests(examples.discordUserId)).requests[0].status, "pending");
  assert.deepEqual(await api.config(), { enabled: false, rules: [] });
});
test("Bucks fixtures retain the reviewed CC contract content independent of checkout line endings", () => {
  const text = readFileSync(new URL("./fixtures/rewards-v1.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(text).digest("hex"), "2d858c6275089e806a2e246f3ba18ed502c5426dd873c583f45832fac08b758e");
});
for (const patch of [{ schemaVersion: 2 }, { available: 99 }, { reserved: 101 }, { xp: -1 }, { nextOffset: 100000 }, { ledger: new Array(26).fill({}) }]) {
  test(`Bucks account rejects invalid contract: ${Object.keys(patch)[0]}`, async () => {
    const api = createRewardsApi(apiConfig, async () => response({ ...examples.account, ...patch }));
    await assert.rejects(api.account(examples.discordUserId), (e: unknown) => e instanceof ApiError && e.code === "invalid_response");
  });
}
test("Bucks pagination rejects caller overflow before networking", async () => {
  let calls = 0; const api = createRewardsApi(apiConfig, async () => { calls++; return response(examples.account); });
  await assert.rejects(api.account(examples.discordUserId, 99976)); await assert.rejects(api.account("someone")); assert.equal(calls, 0);
});
test("Bucks config accepts disabled and configured voice rules with strict guild/schema validation", () => {
  assert.equal(parseRewardConfig(examples.configEnabled, examples.guildId).rules[0].voice_min_participants, 2);
  for (const change of [{ guild_id: "222222222222222222" }, { xp: -1 }, { enabled: false }, { cooldown_seconds: 0 }, { exclude_muted: "yes" }]) {
    assert.throws(() => parseRewardConfig({ ...examples.configEnabled, rules: [{ ...examples.configEnabled.rules[0], ...change }] }, examples.guildId));
  }
  assert.throws(() => parseRewardConfig({ ...examples.configDisabled, rules: examples.configEnabled.rules }, examples.guildId));
});
test("Bucks write preserves actual actor, interaction ID, exact body and response", async () => {
  let calls = 0; const api = createRewardsApi(apiConfig, async (input, init) => {
    calls++; assert.equal(new URL(String(input)).pathname, "/api/v1/bot/rewards/requests");
    assert.deepEqual(JSON.parse(String(init?.body)), examples.requestEnvelope); return response(examples.requestAccepted);
  });
  assert.equal((await api.write(job)).requestId, examples.requestAccepted.requestId); assert.equal(calls, 1);
});
test("Bucks cancellation binds ID to route and sends only the version in data", async () => {
  const id = examples.requestAccepted.requestId;
  const api = createRewardsApi(apiConfig, async (input, init) => {
    assert.equal(new URL(String(input)).pathname, `/api/v1/bot/rewards/requests/${id}/cancel`);
    assert.deepEqual(JSON.parse(String(init?.body)).data, { version: 1 });
    return response({ ...examples.requestAccepted, reservedDelta: -60 });
  });
  assert.equal((await api.write({ ...job, operation: "cancel", data: { id, version: 1 } })).reservedDelta, -60);
});
test("Bucks validates activity facts without inventing amounts or changing timestamps", async () => {
  const voice = { id: examples.voiceEnvelope.idempotency_key, actor: examples.discordUserId, operation: "activity" as const, data: examples.voiceEnvelope.data };
  assert.equal(validRewardJob(voice), true); assert.equal(validRewardJob({ ...voice, data: { ...voice.data, bucks: 500 } }), false);
  const api = createRewardsApi(apiConfig, async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)).data, voice.data);
    return response({ schemaVersion: 1, ok: true, requestId: null, xpDelta: 10, bucksDelta: 5, reservedDelta: 0 });
  });
  assert.equal((await api.write(voice)).xpDelta, 10);
});
for (const code of ["invalid_client", "insufficient_scope", "account_unavailable", "linked_membership_required", "insufficient_bucks", "out_of_stock", "stale_version", "cooldown", "daily_limit", "activity_disabled", "idempotency_conflict"]) {
  test(`Bucks preserves safe error ${code}`, async () => {
    const api = createRewardsApi(apiConfig, async () => response({ error: { code } }, 422));
    await assert.rejects(api.write(job), (e: unknown) => e instanceof ApiError && e.code === code);
  });
}
test("Bucks unknown database errors are redacted", async () => {
  const api = createRewardsApi(apiConfig, async () => response({ error: { code: "TESTFIXTURE private detail" } }, 503));
  await assert.rejects(api.write(job), (e: unknown) => e instanceof ApiError && e.code === "upstream_unavailable" && !e.message.includes("private"));
});
test("Bucks real stalled HTTP response body is cancelled under its client deadline", async () => {
  let closed = false, stall = false, bodyStarted = false;
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (!stall) { res.end(JSON.stringify(examples.account)); return; }
    bodyStarted = true; res.once("close", () => { closed = true; }); res.write("{");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const localConfig = { ...apiConfig, apiUrl: `http://127.0.0.1:${address.port}/api/v1/bot/` };
    await createRewardsApi(localConfig, fetch, 2000).account(examples.discordUserId); stall = true;
    const api = createRewardsApi(localConfig, fetch, 500);
    await assert.rejects(api.account(examples.discordUserId), (e: unknown) => e instanceof ApiError && e.code === "api_timeout");
    assert.equal(bodyStarted, true);
    for (let n = 0; n < 100 && !closed; n++) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(closed, true);
  } finally { server.close(); server.closeAllConnections(); }
});
