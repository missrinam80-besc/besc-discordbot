import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ApiError } from "../src/api.ts";
import { createV2Api } from "../src/ticket-v2-api.ts";
import { ticketConfig, typeRevision, configDelivery, answersFor, type ConfigDelivery } from "../src/ticket-v2-schema.ts";
import { modalFor } from "../src/ticket-v2-handler.ts";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ticketing-v2.fixtures.json", import.meta.url), "utf8"));
const config = { apiUrl: "https://fixture.invalid/api/v1/bot/", apiKey: `bb_fixture.${"a".repeat(43)}`, guildId: fixture.configResponse.guildId, applicationId: fixture.requests[0].body.application_id };
const actor = "111111111111111111", key = "111111111111111111", revision = fixture.typeRevisionResponse.typeRevision.revisionId;
const d = (): ConfigDelivery => ({ ...structuredClone(fixture.publicationDelivery), leasedUntil: new Date(Date.now() + 60000).toISOString() });
const inspect = (delivery: ConfigDelivery) => ({ id: delivery.id, kind: delivery.kind, leaseToken: delivery.leaseToken, leasedUntil: delivery.leasedUntil, withdrawn: delivery.withdrawn });
test("Canonieke CC-schema-2-fixtures valideren en renderen zonder afbeeldingen of teammodule", () => {
  assert.deepEqual(fixture, JSON.parse(readFileSync(new URL("../docs/contracts/ticketing-v2.fixtures.json", import.meta.url), "utf8")));
  const c = ticketConfig(fixture.configResponse, config.guildId); const t = typeRevision(fixture.typeRevisionResponse.typeRevision);
  configDelivery(d(), config.guildId, config.applicationId);
  const modal = modalFor(t, fixture.intentResponse.intentId).toJSON();
  assert.equal(modal.components.length, 3); assert.equal(modal.components[0].type, 18); assert.equal(modal.components[2].type, 18);
  assert.equal(c.typeRevisions[0].questions[2].kind, "single"); assert.ok(modal.custom_id.length <= 100);
});
test("Alle configuratieverzoeken voldoen byte-inhoudelijk aan CC-fixtures en gebruiken alleen dezelfde origin", async () => {
  const delivery = d(); const calls: { path: string; body?: unknown; key: string | null }[] = [];
  let response: unknown = fixture.configResponse;
  const api = createV2Api(config, (async (url, init) => {
    const u = new URL(String(url)); assert.equal(u.origin, "https://fixture.invalid");assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${config.apiKey}`);
    calls.push({ path: u.pathname.replace("/api/v1/bot/", "") + u.search, body: init?.body ? JSON.parse(String(init.body)) : undefined, key: (init?.headers as Record<string,string>)["Idempotency-Key"] ?? null });
    return Response.json(response);
  }) as typeof fetch);
  await api.config(); response = fixture.typeRevisionResponse; await api.revision(revision);
  response = fixture.intentResponse; await api.intent(actor, revision, { source: "slash" }, key);
  const panelSource = fixture.requests.find((r: { name: string }) => r.name === "panel-intent").body;
  await api.intent(actor, revision, { source: "panel", panel_id: panelSource.panel_id, panel_revision_id: panelSource.panel_revision_id, channel_id: panelSource.channel_id, message_id: panelSource.message_id }, key);
  response = fixture.intakeResponse; await api.intake(actor, revision, fixture.intentResponse.intentId, fixture.requests.find((r: { name: string }) => r.name === "intake").body.answers, key);
  response = { recorded: true }; const report = { ...fixture.requests[0].body }; delete report.guild_id; await api.report(report);
  response = { deliveries: [delivery] }; await api.claim("worker_123");
  response = inspect(delivery); await api.inspect(delivery, "worker_123");
  response = { recorded: true };
  for (const kind of ["verify_server_admin", "check_channel", "publish_panel", "disable_panel"] as const) {
    const f = fixture.requests.find((r: { name: string }) => r.name === `complete-${kind}`); const body = { ...f.body };
    for (const k of ["guild_id", "worker_id", "lease_token", "application_id", "payload_hash", "kind"]) delete body[k];
    await api.complete({ ...delivery, kind }, "worker_123", body);
  }
  await api.fail(delivery, "worker_123", "outcome_unknown", true);
  for (const call of calls) {
    const expected = fixture.requests.find((r: { path: string; body?: unknown; name: string }) => r.path === call.path && (!r.body || (r.body as { kind?: string }).kind === (call.body as {kind?:string})?.kind && (r.body as { source?: string }).source === (call.body as {source?:string})?.source));
    assert.ok(expected, call.path); assert.deepEqual(call.body, expected.body); assert.equal(call.key, expected.idempotencyKey ?? null);
  }
});
test("Intents en intake herhalen na verloren response exact dezelfde actor, antwoorden en idempotencykey", async () => {
  const calls: string[] = []; let count = 0;
  const api = createV2Api(config, (async (_url, init) => { calls.push(String(init?.body)); assert.equal((init?.headers as Record<string,string>)["Idempotency-Key"], key); if (!count++) throw Error("TEST lost response"); return Response.json(fixture.intentResponse); }) as typeof fetch);
  await api.intent(actor, revision, { source: "slash" }, key); assert.equal(calls.length, 2); assert.equal(calls[0], calls[1]);
  const intakeCalls: string[] = []; count = 0;
  const write = createV2Api(config, (async (_url, init) => { intakeCalls.push(String(init?.body)); if (!count++) throw Error("TEST lost response"); return Response.json(fixture.intakeResponse); }) as typeof fetch);
  await write.intake(actor, revision, fixture.intentResponse.intentId, { onderwerp: "TEST", omschrijving: "Private", omgeving: ["discord"] }, key);
  assert.equal(intakeCalls.length, 2); assert.equal(intakeCalls[0], intakeCalls[1]);
});
for (const code of ["intent_expired", "intent_consumed", "idempotency_conflict", "source_not_allowed", "linked_account_required", "revision_unavailable"]) test(`CC-intakefout ${code} wordt niet blind herhaald`, async () => {
  let calls = 0; const api = createV2Api(config, (async () => { calls++; return Response.json({ error: { code } }, { status: 409 }); }) as typeof fetch);
  await assert.rejects(api.intent(actor, revision, { source: "slash" }, key), e => e instanceof ApiError && e.code === code); assert.equal(calls, 1);
});
const unsafe: [string, (v: any) => void][] = [
  ["guild", v => v.guildId = "222222222222222222"], ["images", v => v.payload.embed.imageUrl = "https://fixture.invalid/x"],
  ["team", v => v.payload.typeRevisions[0].team = "TEST"], ["mentions", v => v.allowedMentions.parse = ["everyone"]],
  ["hash", v => v.payloadHash = "secret"], ["author", v => v.payload.expectedBotAuthorId = "222222222222222222"],
  ["marker", v => v.marker = "besc-panel-wrong"], ["choicekind", v => v.payload.typeRevisions[0].questions[2].kind = "multiple"],
  ["revisionbinding", v => v.payload.typeRevisionIds[0] = "20000000-0000-4000-8000-000000000099"],
  ["duplicatequestions", v => v.payload.typeRevisions[0].questions[1].id = "onderwerp"],
  ["sixfields", v => v.payload.typeRevisions[0].questions.push(...structuredClone(v.payload.typeRevisions[0].questions))],
];
for (const [name, mutate] of unsafe) test(`Onveilige configuratiedelivery wordt geweigerd: ${name}`, () => {
  const value = d(); mutate(value); assert.throws(() => configDelivery(value, config.guildId, config.applicationId), e => e instanceof ApiError && e.code === "invalid_response");
});
test("Inspect accepteert alleen dezelfde delivery/kind/lease en autorisatie kan intussen worden ingetrokken", async () => {
  const delivery = d(); let r = inspect(delivery);
  const api = createV2Api(config, (async () => Response.json(r)) as typeof fetch);
  r.withdrawn = true; assert.equal((await api.inspect(delivery, "worker_123")).withdrawn, true);
  r.leaseToken = "20000000-0000-4000-8000-000000000099"; await assert.rejects(api.inspect(delivery, "worker_123"));
});
test("Request blijft op 128 KiB begrensd zonder upstreameffect", async () => {
  let called = false; const api = createV2Api(config, (async () => { called = true; return Response.json(fixture.intakeResponse); }) as typeof fetch);
  await assert.rejects(api.intake(actor, revision, fixture.intentResponse.intentId, { long: "😀".repeat(40000) }, key), e => e instanceof ApiError && e.code === "body_too_large"); assert.equal(called, false);
});
test("Grote configuratie boven één MiB blijft leesbaar, boven twee MiB wordt geweigerd", async () => {
  const type = structuredClone(fixture.typeRevisionResponse.typeRevision); type.embed.description = "x".repeat(4000); type.embed.footer = "x".repeat(1900);
  const make = (count: number) => ({ ...fixture.configResponse, panels: [], typeRevisions: Array.from({ length: count }, (_, n) => ({ ...type, revisionId: `20000000-0000-4000-8000-${String(n).padStart(12, "0")}` })) });
  const big = make(220); assert.ok(Buffer.byteLength(JSON.stringify(big)) > 1048576);
  const readable = createV2Api(config, (async () => Response.json(big)) as typeof fetch); assert.equal((await readable.config()).typeRevisions.length, 220);
  const tooBig = createV2Api(config, (async () => Response.json(make(400))) as typeof fetch); await assert.rejects(tooBig.config(), e => e instanceof ApiError && e.code === "invalid_response");
});
test("Antwoorden valideren onbekende velden, verplichte tekst en single/multi-keuzearrays", () => {
  const t = typeRevision(fixture.typeRevisionResponse.typeRevision);
  const answers = { onderwerp: " TEST ", omschrijving: "Private", omgeving: ["cc"] };
  assert.equal(answersFor(t, answers).onderwerp, "TEST");
  assert.throws(() => answersFor(t, { ...answers, actor: "OTHER" })); assert.throws(() => answersFor(t, { ...answers, omgeving: ["unknown"] }));
  assert.throws(() => answersFor(t, { ...answers, onderwerp: " " }));assert.throws(() => answersFor(t, { ...answers, omgeving: ["cc", "cc"] }));
  const choices = t.questions[2]; if ("options" in choices) { choices.kind = "multi"; choices.maxValues = 2; assert.deepEqual(answersFor(t, { ...answers, omgeving: ["cc", "discord"] }).omgeving, ["cc", "discord"]); }
});
