import assert from "node:assert/strict";
import test from "node:test";
import { handleBotRequest, hashBotKey, parseBotClients, BotRateLimiter, type BotClient, type BotStore, type BotMember } from "../src/lib/bot-api.ts";
const org = "11111111-1111-4111-8111-111111111111", guild = "111111111111111111", discord = "222222222222222222";
const key = `bb_fixture-discord.${"a".repeat(43)}`;
function fixture() {
  const c: BotClient = { id: "fixture-discord", keyHash: hashBotKey(key), organizationId: org, guildId: guild,
    scopes: ["identity:read", "account:read", "events:read"], expiresAt: "2099-01-01T00:00:00Z", revoked: false };
  let member: BotMember | null = { role: "member", finance_role: "none", status: "active", organization_id: org };
  let verified: string | null = discord, banned = false, reads = 0;
  const seen: string[] = [];
  const store: BotStore = { async findAccount() { return { userId: "fixture-user", verifiedDiscordId: verified, banned }; },
    async findMembership(user, organizationId) { seen.push(organizationId); return member; },
    async listEvents(organizationId, offset, count) { reads++; seen.push(organizationId); assert.equal(count, 6);
      return Array.from({ length: 6 }, (_, n) => ({ id: `fixture-${n}`, title: "TESTFIXTURE — NIET PUBLICEREN", status: "idea",
        event_type: "community", start_at: null, start_date: null, location: null, is_online: true, secret: "never_return" })); } };
  const limiter = new BotRateLimiter(1000);
  const run = (resource = "events", query = `guild_id=${guild}&discord_user_id=${discord}`, authorization = `Bearer ${key}`, method = "GET") =>
    handleBotRequest(new Request(`https://example.invalid/api/v1/bot/${resource}?${query}`, { method, headers: { authorization } }), { clients: [c], store, limiter });
  return { c, run, seen, reads: () => reads, setMember: (value: BotMember | null) => { member = value; },
    setVerified: (value: string | null) => { verified = value; }, setBanned: () => { banned = true; }, store };
}
test("Clientkey-hash, organisatiebinding, beperkt eventantwoord, paginering en no-store", async () => {
  const f = fixture(), response = await f.run(); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.events.length, 5); assert.equal(body.nextOffset, 5);
  assert.equal(JSON.stringify(body).includes("secret"), false); assert.deepEqual(f.seen, [org, org]);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
for (const mode of ["missing", "wrong", "revoked", "expired"]) test(`Geen toegang met ${mode} clientcredentials`, async () => {
  const f = fixture(); if (mode === "revoked") f.c.revoked = true; if (mode === "expired") f.c.expiresAt = "2000-01-01";
  const result = await f.run("events", undefined, mode === "missing" ? "" : mode === "wrong" ? `Bearer bb_fixture-discord.${"b".repeat(43)}` : undefined);
  assert.equal(result.status, 401); assert.equal(f.reads(), 0);
});
test("Geen organisatie-, actor- of guildoverride; geen dubbele queryparameters", async () => {
  for (const query of [`guild_id=${guild}&discord_user_id=${discord}&organization_id=${org}`, `guild_id=${guild}&discord_user_id=${discord}&user_id=other`,
    `guild_id=${guild}&guild_id=${guild}`, `guild_id=333333333333333333&discord_user_id=${discord}`,
    `guild_id=${guild}&discord_user_id=bad`, `guild_id=${guild}&discord_user_id=${discord}&offset=-1`]) {
    const f = fixture(); assert.ok([400, 403].includes((await f.run("events", query)).status)); assert.equal(f.reads(), 0);
  }
});
test("Clients kunnen alleen afzonderlijk verleende leesrechten gebruiken", async () => {
  const f = fixture(); f.c.scopes = ["identity:read"];
  assert.equal((await f.run("identity", `guild_id=${guild}`)).status, 200);
  assert.equal((await f.run()).status, 403); assert.equal(f.reads(), 0);
});
for (const mode of ["unlinked", "forged", "banned", "pending", "suspended", "other-org", "no-membership"]) test(`Gegevens blijven afgeschermd bij ${mode}`, async () => {
  const f = fixture();
  if (mode === "unlinked") f.setVerified(null); if (mode === "forged") f.setVerified("333333333333333333"); if (mode === "banned") f.setBanned();
  if (mode === "no-membership") f.setMember(null);
  if (["pending", "suspended", "other-org"].includes(mode)) f.setMember({ organization_id: mode === "other-org" ? "other" : org,
    role: "member", status: mode === "other-org" ? "active" : mode, finance_role: "none" });
  assert.ok([403, 404].includes((await f.run()).status)); assert.equal(f.reads(), 0);
});
for (const role of ["admin", "board", "member", "volunteer", "unknown"]) test(`Eventtoegang volgt webapp voor ${role}`, async () => {
  const f = fixture(); f.setMember({ organization_id: org, role, status: "active", finance_role: "none", capabilities: ["manageEvents"] });
  assert.equal((await f.run()).status, ["admin", "board", "member"].includes(role) ? 200 : 403);
});
test("Schrijfacties zijn volledig uitgeschakeld, ook met geldige clientkey", async () => {
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) { const f = fixture(); const r = await f.run("events", undefined, undefined, method);
    assert.equal(r.status, 405); assert.equal(r.headers.get("allow"), "GET"); assert.equal(f.reads(), 0); }
});
test("Storefouten lekken geen geheimen en geven 503", async () => {
  const f = fixture(); f.store.findAccount = async () => { throw Error("SUPABASE_SECRET_KEY=never_return"); };
  const response = await f.run(); assert.equal(response.status, 503); assert.equal((await response.text()).includes("SUPABASE"), false);
});
test("Rate limit blokkeert en herstelt na een minuut", async () => {
  const f = fixture(), limiter = new BotRateLimiter(1);
  const request = new Request(`https://example.invalid/api/v1/bot/identity?guild_id=${guild}`, { headers: { authorization: `Bearer ${key}` } });
  assert.equal((await handleBotRequest(request, { clients: [f.c], store: f.store, limiter, now: 0 })).status, 200);
  assert.equal((await handleBotRequest(request, { clients: [f.c], store: f.store, limiter, now: 1 })).status, 429);
  assert.equal((await handleBotRequest(request, { clients: [f.c], store: f.store, limiter, now: 60_000 })).status, 200);
});
test("Configuratie is fail closed en weigert onbekende scopes en dubbele clients", () => {
  const f = fixture(); assert.deepEqual(parseBotClients(undefined), []); assert.equal(parseBotClients(JSON.stringify([f.c])).length, 1);
  for (const input of ["{}", "null", JSON.stringify([f.c, f.c]), JSON.stringify([{ ...f.c, scopes: ["admin"] }]), JSON.stringify([{ ...f.c, keyHash: "bad" }])]) {
    assert.throws(() => parseBotClients(input));
  }
});

for (const offset of [99994, 99995, 99999]) test(`Paginering levert uitsluitend toegestane vervolgwaarden vanaf ${offset}`, async () => {
  const f = fixture();
  const response = await f.run("events", `guild_id=${guild}&discord_user_id=${discord}&offset=${offset}`);
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.events.length, 5);
  assert.equal(body.nextOffset, offset === 99994 ? 99999 : null);
  if (body.nextOffset !== null) {
    assert.equal((await f.run("events", `guild_id=${guild}&discord_user_id=${discord}&offset=${body.nextOffset}`)).status, 200);
  }
});
test("Offset boven de grens blijft geweigerd vóór een upstreamquery", async () => {
  const f = fixture(); assert.equal((await f.run("events", `guild_id=${guild}&discord_user_id=${discord}&offset=100004`)).status, 400);
  assert.equal(f.seen.length, 0); assert.equal(f.reads(), 0);
});
