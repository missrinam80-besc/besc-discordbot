import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { MessageFlags } from "discord.js";
import { createApi, ApiError } from "../src/api.ts";
import { createCommandHandler, InteractionDeduplicator, type CommandInteraction } from "../src/handler.ts";
import { fixture, fixtureDiscord, fixtureGuild, fixtureKey } from "../scripts/fixture.ts";
import { bescCommand } from "../src/commands.ts";
import { loadConfig } from "../src/config.ts";

test("Verticale proef: echt lokaal HTTP, API-auth, gekoppeld account, eventpaginering en privéantwoord", async () => {
  const f = fixture();
  const server = createServer(async (req, res) => {
    const response = await f.handle(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers as Record<string, string> }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const a = server.address(); assert.ok(a && typeof a !== "string");
    const api = createApi({ apiUrl: `http://127.0.0.1:${a.port}/api/v1/bot/`, apiKey: fixtureKey, guildId: fixtureGuild });
    assert.equal((await api.identity()).readOnly, true);
    assert.equal((await api.account(fixtureDiscord)).canReadEvents, true);
    assert.equal((await api.events(fixtureDiscord)).nextOffset, 5);
    assert.equal((await api.events(fixtureDiscord, 5)).events.length, 1);
    await assert.rejects(api.account("333333333333333333"), (e: unknown) => e instanceof ApiError && e.code === "account_unavailable");
    const actions: string[] = [];
    const handler = createCommandHandler(api, fixtureGuild);
    const input: CommandInteraction = { id: "vertical-event", commandName: "besc", guildId: fixtureGuild,
      user: { id: fixtureDiscord }, options: { getSubcommand: () => "events", getInteger: () => null },
      deferReply: async ({ flags }) => { assert.equal(flags, MessageFlags.Ephemeral); actions.push("defer"); },
      editReply: async ({ content, allowedMentions }) => { assert.deepEqual(allowedMentions.parse, []); assert.match(content, /TESTFIXTURE/); assert.ok(content.length < 2000); actions.push("reply"); } };
    await handler(input); await handler(input);
    assert.deepEqual(actions, ["defer", "reply"]);
    assert.ok(f.calls.filter(c => c.type === "events").every(c => c.organizationId === f.client.organizationId));
  } finally { server.close(); server.closeAllConnections(); }
});

test("Verkeerde server en privébericht raken de API niet", async () => {
  for (const guildId of [null, "333333333333333333"]) {
    let called = false, replied = false;
    const denied = async () => { called = true; throw Error("must_not_call"); };
    const handler = createCommandHandler({ identity: denied, account: denied, events: denied }, fixtureGuild);
    await handler({ id: String(guildId), commandName: "besc", guildId, user: { id: fixtureDiscord },
      options: { getSubcommand: () => "events", getInteger: () => null }, deferReply: async () => {},
      editReply: async () => { replied = true; } });
    assert.equal(called, false); assert.equal(replied, true);
  }
});

test("Geen nieuwe commandnaamruimte, moderatie of rolcommando's", () => {
  const c = bescCommand.toJSON(); assert.equal(c.name, "besc");
  assert.deepEqual(c.options?.map(o => o.name), ["status", "account", "events"]);
  assert.deepEqual(c.contexts, [0]);
});

test("Configuratie weigert ontbrekende waarden, remote HTTP en credential-URL", () => {
  assert.throws(() => loadConfig({}), /zes vereiste/);
  const env = { DISCORD_BOT_TOKEN: "fixture", DISCORD_APPLICATION_ID: fixtureGuild, DISCORD_GUILD_ID: fixtureGuild,
    COMMANDCENTER_API_URL: "https://example.invalid/api/v1/bot/", COMMANDCENTER_WEB_URL: "https://example.invalid", BESC_BOT_API_KEY: fixtureKey };
  assert.equal(loadConfig(env).guildId, fixtureGuild);
  for (const url of ["http://example.invalid/api/v1/bot/", "https://key@example.invalid/api/v1/bot/", "https://example.invalid/api/v1/bot/?key=x"]) {
    assert.throws(() => loadConfig({ ...env, COMMANDCENTER_API_URL: url }));
  }
});

test("Redirects, foutpagina's, corrupte en te grote antwoorden leveren een veilige fout", async () => {
  for (const fetcher of [async () => { throw Error("https://secret.invalid/token"); },
    async () => new Response("not json"), async () => Response.json({ events: "bad" }),
    async () => new Response("x".repeat(65_537))]) {
    const api = createApi({ apiUrl: "https://example.invalid/api/v1/bot/", apiKey: fixtureKey, guildId: fixtureGuild }, fetcher as typeof fetch);
    await assert.rejects(api.events(fixtureDiscord), (e: unknown) => e instanceof ApiError && !e.message.includes("secret"));
  }
  let redirect: unknown;
  const api = createApi({ apiUrl: "https://example.invalid/api/v1/bot/", apiKey: fixtureKey, guildId: fixtureGuild },
    (async (_u, options) => { redirect = options?.redirect; return Response.json({ clientId: "fixture", scopes: [], readOnly: true }); }) as typeof fetch);
  await api.identity(); assert.equal(redirect, "error");
});

test("Netwerktimeout wordt afgebroken", async () => {
  const api = createApi({ apiUrl: "https://example.invalid/api/v1/bot/", apiKey: fixtureKey, guildId: fixtureGuild },
    ((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(Error("aborted"))))) as typeof fetch, 10);
  await assert.rejects(api.identity(), (e: unknown) => e instanceof ApiError && e.code === "api_timeout");
});

test("Ook een HTTP-response die zijn body niet afmaakt valt onder de deadline", async () => {
  const server = createServer((_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.write("{"); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const a = server.address(); assert.ok(a && typeof a !== "string");
    const api = createApi({ apiUrl: `http://127.0.0.1:${a.port}/api/v1/bot/`, apiKey: fixtureKey, guildId: fixtureGuild }, fetch, 50);
    await assert.rejects(api.identity(), (e: unknown) => e instanceof ApiError && e.code === "api_timeout");
  } finally { server.close(); server.closeAllConnections(); }
});

test("Dedupe verloopt; tekst van events activeert geen mentions en heeft een beperkte lengte", async () => {
  const d = new InteractionDeduplicator(); assert.equal(d.claim("id", 0), true); assert.equal(d.claim("id", 1), false); assert.equal(d.claim("id", 900001), true);
  let output = "";
  const handler = createCommandHandler({ identity: async () => { throw Error(); }, account: async () => { throw Error(); },
    events: async () => ({ events: [{ id: "fixture", title: "@everyone **secret**\n".repeat(50), status: "planning", event_type: "community",
      start_at: "invalid", start_date: null, location: "@here", is_online: false }], nextOffset: null }) }, fixtureGuild);
  await handler({ id: "mentions", commandName: "besc", guildId: fixtureGuild, user: { id: fixtureDiscord },
    options: { getSubcommand: () => "events", getInteger: () => null }, deferReply: async () => {},
    editReply: async ({ content, allowedMentions }) => { output = content; assert.deepEqual(allowedMentions.parse, []); } });
  assert.ok(output.length < 1900); assert.match(output, /Datum nog onbekend/); assert.match(output, /\\\*/);
});
