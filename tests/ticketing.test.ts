import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Collection, ChannelType, MessageFlags, type Client, type Message, type ChatInputCommandInteraction, type ModalSubmitInteraction } from "discord.js";
import { ApiError, createApi } from "../src/api.ts";
import { createTicketApi, type Delivery, type TicketApi } from "../src/ticket-api.ts";
import { createTicketWorker, DeliveryError } from "../src/ticket-worker.ts";
import { DiscordTickets } from "../src/ticket-discord.ts";
import { createTicketHandler } from "../src/ticket-handler.ts";
import { createTicketIngest } from "../src/ticket-ingest.ts";
import { createBescCommand } from "../src/commands.ts";
import { loadConfig } from "../src/config.ts";
const guild = "1067893182387474432", parent = "222222222222222222", user = "111111111111111111", threadId = "333333333333333333", source = "444444444444444444";
const ticketId = "20000000-0000-4000-8000-000000000001", deliveryId = "20000000-0000-4000-8000-000000000002", token = "20000000-0000-4000-8000-000000000003";
const botId = "555555555555555555", marker = `besc-ticket-${ticketId}`;
const config = { apiUrl: "https://fixture.invalid/api/v1/bot/", apiKey: `bb_fixture.${"a".repeat(43)}`, guildId: guild, ticketParentChannelId: parent };
const own = { ticketId, status: "open", linkStatus: "linked", threadId };
function delivery(extra: Partial<Delivery> = {}): Delivery {
  return { id: deliveryId, ticketId, kind: "create_thread", payload: { marker, requester_discord_id: user }, guildId: guild, parentChannelId: parent,
    threadId: null, ticketStatus: "open", ticketMarker: marker, leaseToken: token, leasedUntil: new Date(Date.now() + 60_000).toISOString(), reconcile: false, nonce: "1234", ...extra };
}
function api(extra: Partial<TicketApi> = {}): TicketApi {
  return { create: async () => own, own: async () => own, ingest: async () => {}, claim: async () => [], complete: async () => {}, fail: async () => {}, ...extra };
}
test("Ticketintake gebruikt echte actor, vaste kanaalbinding en dezelfde idempotencykey", async () => {
  const requests: { url: URL; init: RequestInit }[] = [];
  const fetcher = async (url: URL | RequestInfo, init?: RequestInit) => { requests.push({ url: new URL(String(url)), init: init! }); return Response.json({ ...own, threadId: null }); };
  const client = createTicketApi(config, fetcher as typeof fetch);
  await client.create(user, "TESTFIXTURE", "Voorbeeld", source); await client.create(user, "TESTFIXTURE", "Voorbeeld", source);
  assert.equal(requests[0].url.search, ""); assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), { guild_id: guild, parent_channel_id: parent, discord_user_id: user, subject: "TESTFIXTURE", content: "Voorbeeld" });
  assert.equal(new Headers(requests[0].init.headers).get("Idempotency-Key"), source);
  assert.equal(requests[0].init.body, requests[1].init.body);
  assert.equal(requests[0].init.redirect, "error");
});
test("Message-import key is bronmessage-ID en body gebruikt vaste parent en echte thread", async () => {
  const client = createTicketApi(config, (async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), source);
    assert.deepEqual(JSON.parse(String(init?.body)), { guild_id: guild, discord_user_id: user, parent_channel_id: parent, thread_id: threadId, source_message_id: source, content: "Vervolgvraag" });
    return Response.json({ ticketId, messageId: deliveryId });
  }) as typeof fetch);
  await client.ingest(ticketId, user, threadId, source, "Vervolgvraag");
});
for (const mutation of [
  { guildId: "666666666666666666" }, { parentChannelId: "666666666666666666" }, { ticketMarker: "besc-ticket-20000000-0000-4000-8000-000000000099" },
  { allowedMentions: { parse: ["everyone"] } }, { payload: { marker, requester_discord_id: "bad" } }, { kind: "administrator" }, { leasedUntil: "bad" },
]) test(`Onveilige delivery wordt geweigerd: ${Object.keys(mutation)[0]}`, async () => {
  const client = createTicketApi(config, (async () => Response.json({ deliveries: [{ ...delivery(), allowedMentions: { parse: [] }, ...mutation }] })) as typeof fetch);
  await assert.rejects(client.claim("worker_fixture"), (e: unknown) => e instanceof ApiError && e.code === "invalid_response");
});
test("Write-capable identity blijft leesbaar; ticketconfig is optioneel en streng", async () => {
  assert.equal((await createApi(config, (async () => Response.json({ clientId: "fixture", scopes: [], readOnly: false })) as typeof fetch).identity()).readOnly, false);
  const env = { DISCORD_BOT_TOKEN: "fixture", DISCORD_APPLICATION_ID: botId, DISCORD_GUILD_ID: guild, COMMANDCENTER_API_URL: config.apiUrl,
    COMMANDCENTER_WEB_URL: "https://fixture.invalid", BESC_BOT_API_KEY: config.apiKey };
  assert.equal(loadConfig(env).ticketParentChannelId, undefined);
  assert.equal(loadConfig({ ...env, DISCORD_TICKET_PARENT_CHANNEL_ID: parent }).ticketParentChannelId, parent);
  assert.throws(() => loadConfig({ ...env, DISCORD_TICKET_PARENT_CHANNEL_ID: "bad" }));
  assert.deepEqual(createBescCommand().toJSON().options?.map(o => o.name), ["status", "account", "events"]);
  assert.deepEqual(createBescCommand(true).toJSON().options?.map(o => o.name), ["status", "account", "events", "ticket"]);
});
test("Worker herhaalt geen Discordeffect bij verloren complete-antwoord", async () => {
  let effects = 0, fails = 0; const logs: string[] = [];
  const worker = createTicketWorker(api({ claim: async () => [delivery()], complete: async () => { throw Error("lost"); }, fail: async () => { fails++; } }),
    { execute: async () => { effects++; return { thread_id: threadId }; } }, c => logs.push(c));
  await worker(); assert.equal(effects, 1); assert.equal(fails, 0); assert.deepEqual(logs, ["delivery_complete_ack_unavailable"]);
});
test("Worker slaat verlopen lease over en serialiseert overlappende ticks", async () => {
  let claims = 0, effects = 0;
  const worker = createTicketWorker(api({ claim: async () => { claims++; await new Promise(r => setTimeout(r, 10)); return [delivery({ leasedUntil: new Date(0).toISOString() })]; } }),
    { execute: async () => { effects++; return {}; } });
  await Promise.all([worker(), worker()]); assert.equal(claims, 1); assert.equal(effects, 0);
});
test("Onzekere effecten worden veilig gemeld, zonder foutstack of payload", async () => {
  const failures: unknown[] = [];
  const worker = createTicketWorker(api({ claim: async () => [delivery()], fail: async (_d, _w, code, uncertain) => { failures.push({ code, uncertain }); } }),
    { execute: async () => { throw Error("SECRET FIXTURE CONTENT"); } });
  await worker(); assert.deepEqual(failures, [{ code: "outcome_unknown", uncertain: true }]);
});
test("Afzonderlijke ticketleases starten samen, zonder op een traag ticket te wachten", async () => {
  const started: string[] = []; let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const worker = createTicketWorker(api({ claim: async () => [delivery(), delivery({ id: token, ticketId: token, ticketMarker: `besc-ticket-${token}` })] }),
    { execute: async d => { started.push(d.id); if (d.id === deliveryId) await blocked; return {}; } });
  const run = worker(); await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(started, [deliveryId, token]); release(); await run;
});
function discordFixture() {
  let creates = 0, sends = 0, removes = 0, history: Collection<string, any> = new Collection();
  const thread: any = { id: threadId, guildId: guild, parentId: parent, name: marker, ownerId: botId, type: ChannelType.PrivateThread, invitable: false, archived: false,
    members: { add: async () => {} }, setArchived: async () => {}, edit: async () => {}, delete: async () => { removes++; },
    messages: { fetch: async () => history }, send: async (input: any) => { sends++; assert.deepEqual(input.allowedMentions, { parse: [] }); assert.equal(input.enforceNonce, true); return { id: source }; } };
  const channel: any = { id: parent, guildId: guild, type: ChannelType.GuildText, permissionsFor: () => ({ has: () => true }), guild: { members: { fetch: async () => ({ user: { bot: false } }) } },
    threads: { create: async (input: any) => { creates++; assert.equal(input.type, ChannelType.PrivateThread); assert.equal(input.invitable, false); return thread; } } };
  const client = { user: { id: botId }, channels: { fetch: async () => channel } } as unknown as Client;
  const port = new DiscordTickets(client, guild, parent, api());
  port.threads = async () => [];
  port.participants = async () => [user];
  return { port, thread, channel, counters: () => ({ creates, sends, removes }), setHistory: (messages: any[]) => { history = new Collection(messages.map(m => [m.id, m])); } };
}
test("Privéthreadcreatie gebruikt neutrale marker, invitable=false en bevestigde aanvrager", async () => {
  const f = discordFixture(); const result = await f.port.execute(delivery());
  assert.deepEqual(result, { thread_id: threadId, parent_channel_id: parent, requester_discord_id: user, requester_added: true, invitable: false });
  assert.equal(f.counters().creates, 1);
});
test("Crashherstel vindt bestaande thread zonder een tweede aan te maken", async () => {
  const f = discordFixture(); f.port.threads = async () => [f.thread];
  await f.port.execute(delivery({ reconcile: true })); assert.equal(f.counters().creates, 0);
});
test("Onzekere threadaanmaak zonder bewezen resultaat wordt niet blind herhaald", async () => {
  const f = discordFixture(); await assert.rejects(f.port.execute(delivery({ reconcile: true })), DeliveryError); assert.equal(f.counters().creates, 0);
});
test("Gesloten ticket maakt geen nieuwe thread en bevestigt afwezigheid", async () => {
  const f = discordFixture(); assert.deepEqual(await f.port.execute(delivery({ ticketStatus: "closed" })), { thread_absent: true }); assert.equal(f.counters().creates, 0);
});
test("Dubbele markers en onverwachte deelnemers blokkeren effecten", async () => {
  const f = discordFixture(); f.port.threads = async () => [f.thread, { ...f.thread, id: source }];
  await assert.rejects(f.port.execute(delivery()), (e: unknown) => e instanceof DeliveryError && e.code === "duplicate_marker");
  f.port.threads = async () => [f.thread]; f.port.participants = async () => [user, source];
  await assert.rejects(f.port.execute(delivery()), (e: unknown) => e instanceof DeliveryError && e.code === "unexpected_participants");
  assert.deepEqual(f.counters(), { creates: 0, sends: 0, removes: 0 });
});
test("Uitgaand antwoord ondersteunt 4000 tekens zonder mentions of dubbele aflevering", async () => {
  const f = discordFixture(); f.port.threads = async () => [f.thread];
  const d = delivery({ kind: "send_message", threadId, payload: { message_id: deliveryId, content: "x".repeat(4000) } });
  assert.deepEqual(await f.port.execute(d), { thread_id: threadId, message_id: source }); assert.equal(f.counters().sends, 1);
  f.setHistory([{ id: source, author: { id: botId }, nonce: d.nonce, embeds: [{ description: d.payload.content }] }]);
  await f.port.execute({ ...d, reconcile: true }); assert.equal(f.counters().sends, 1);
});
test("Onzeker bericht zonder noncebewijs wordt niet opnieuw verstuurd", async () => {
  const f = discordFixture(); f.port.threads = async () => [f.thread];
  await assert.rejects(f.port.execute(delivery({ kind: "send_message", threadId, reconcile: true, payload: { message_id: deliveryId, content: "TESTFIXTURE" } })), DeliveryError);
  assert.equal(f.counters().sends, 0);
});
test("Bekende thread onder ander kanaal wordt geweigerd", async () => {
  const f = discordFixture(); f.port.threads = async () => [{ ...f.thread, parentId: source }];
  await assert.rejects(f.port.execute(delivery()), DeliveryError); assert.equal(f.counters().creates, 0);
});
test("Volledige deelnemerscontrole loopt door na een volle pagina", async () => {
  const f = discordFixture(); let requests = 0;
  f.port = new DiscordTickets({ user: { id: botId }, rest: { get: async () => { requests++; return requests === 1 ? Array.from({ length: 100 }, (_, n) => ({ user_id: `${100000000000000000n + BigInt(n)}` })) : []; } } } as unknown as Client, guild, parent, api());
  assert.equal((await f.port.participants(f.thread)).length, 100); assert.equal(requests, 2);
});
test("Formulier wordt direct getoond; modal acknowledge gaat vóór actorcontrole en APIwrite", async () => {
  const actions: string[] = []; const f = discordFixture();
  f.port.validateRequester = async () => { actions.push("validate"); return f.channel; };
  const handler = createTicketHandler(api({ create: async (actor, _subject, _content, key) => { actions.push("create"); assert.equal(actor, user); assert.equal(key, source); return own; } }), f.port, () => {});
  const command: any = { commandName: "besc", guildId: guild, isChatInputCommand: () => true, isModalSubmit: () => false,
    options: { getSubcommandGroup: () => "ticket", getSubcommand: () => "openen" }, showModal: async (modal: any) => { assert.ok(modal.toJSON()); actions.push("modal"); } };
  await handler(command as ChatInputCommandInteraction); assert.deepEqual(actions, ["modal"]); actions.length = 0;
  const form: any = { id: source, customId: "besc:ticket:open:v1", guildId: guild, user: { id: user }, isChatInputCommand: () => false, isModalSubmit: () => true,
    fields: { getTextInputValue: () => "TESTFIXTURE" }, deferReply: async (input: any) => { assert.equal(input.flags, MessageFlags.Ephemeral); actions.push("defer"); },
    editReply: async (input: any) => { assert.deepEqual(input.allowedMentions.parse, []); actions.push("reply"); } };
  await handler(form as ModalSubmitInteraction); assert.deepEqual(actions, ["defer", "validate", "create", "reply"]);
});
test("Ingest weigert bot/webhook/ander kanaal/ander deelnemer en lege attachmentinhoud", async () => {
  const f = discordFixture(); let writes = 0;
  const ingest = createTicketIngest(api({ ingest: async () => { writes++; } }), f.port, () => {});
  const base = { id: source, guildId: guild, channel: f.thread, author: { id: user, bot: false }, content: "TESTFIXTURE", webhookId: null };
  for (const input of [{ ...base, author: { id: user, bot: true } }, { ...base, webhookId: source }, { ...base, channel: { ...f.thread, parentId: source } },
    { ...base, author: { id: source, bot: false } }, { ...base, content: "" }]) await ingest.message(input as unknown as Message);
  assert.equal(writes, 0); await ingest.message(base as unknown as Message); assert.equal(writes, 1);
});
test("HTTP-client voldoet aan definitieve CC-fixtures voor claim, completion en failure", async () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/ticketing-v1.fixtures.json", import.meta.url), "utf8"));
  const expected = [fixtures.claim, fixtures.createThreadComplete, fixtures.sendMessageComplete, fixtures.uncertainFailure]; let calls = 0;
  const client = createTicketApi(config, (async (url, init) => {
    const fixture = expected[calls++];
    assert.equal(new URL(String(url)).pathname, fixture.path); assert.equal(init?.method, fixture.method);
    assert.deepEqual(JSON.parse(String(init?.body)), fixture.body);
    return Response.json(calls === 1 ? { deliveries: [] } : { recorded: true });
  }) as typeof fetch);
  await client.claim("worker_instance_123");
  await client.complete(delivery(), "worker_instance_123", { parent_channel_id: parent, requester_discord_id: user, thread_id: threadId, requester_added: true, invitable: false });
  await client.complete(delivery(), "worker_instance_123", { thread_id: threadId, message_id: source });
  await client.fail(delivery(), "worker_instance_123", "outcome_unknown", true); assert.equal(calls, 4);
});
test("Na verloren intake-antwoord wordt maximaal eenmaal met exact dezelfde key herhaald", async () => {
  const bodies: string[] = []; const keys: string[] = [];
  const client = createTicketApi(config, (async (_url, init) => {
    bodies.push(String(init?.body)); keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
    if (bodies.length === 1) throw Error("response lost after commit");
    return Response.json(own);
  }) as typeof fetch);
  await client.create(user, "TESTFIXTURE", "Test", source); assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]); assert.deepEqual(keys, [source, source]);
});
test("Eigen-ticketendpoint accepteert volledige 50 berichten, geen andere ticket-ID", async () => {
  const client = createTicketApi(config, (async () => Response.json({ ...own, messages: Array.from({ length: 50 }, () => ({ content: "界".repeat(4000) })) })) as typeof fetch);
  assert.equal((await client.own(ticketId, user)).ticketId, ticketId);
  const wrong = createTicketApi(config, (async () => Response.json({ ...own, ticketId: deliveryId })) as typeof fetch);
  await assert.rejects(wrong.own(ticketId, user), ApiError);
});
test("Sluiten vergrendelt en archiveert; verwijderen en verdwenen thread zijn herhaalbaar", async () => {
  const f = discordFixture(); f.port.threads = async () => [f.thread]; let edit: unknown;
  f.thread.edit = async (options: unknown) => { edit = options; };
  await f.port.execute(delivery({ kind: "close_thread", threadId, payload: {} })); assert.deepEqual(edit, { locked: true, archived: true });
  await f.port.execute(delivery({ kind: "delete_thread", threadId, payload: {} })); assert.equal(f.counters().removes, 1);
  f.port.threads = async () => []; (f.port.client as any).channels.fetch = async () => null;
  assert.deepEqual(await f.port.execute(delivery({ kind: "delete_thread", threadId, payload: {} })), { thread_id: threadId, thread_absent: true });
});
test("Herstelscan stopt bij onvolledige archiefpagina, zonder afwezigheid te claimen", async () => {
  const f = discordFixture(); f.channel.threads.fetchActive = async () => ({ threads: new Collection() });
  f.channel.threads.fetchArchived = async () => ({ threads: new Collection(), hasMore: true });
  f.port.threads = DiscordTickets.prototype.threads.bind(f.port);
  await assert.rejects(f.port.execute(delivery({ reconcile: true })), DeliveryError); assert.equal(f.counters().creates, 0);
});
test("Threaddeelnemer moet ook volgens CC de eigenaar zijn vóór een antwoord", async () => {
  const f = discordFixture(); f.port.threads = async () => [f.thread]; f.port.api = api({ own: async () => { throw new ApiError("ticket_unavailable", 404); } });
  await assert.rejects(f.port.execute(delivery({ kind: "send_message", threadId, payload: { content: "TESTFIXTURE", message_id: deliveryId } })), ApiError);
  assert.equal(f.counters().sends, 0);
});
