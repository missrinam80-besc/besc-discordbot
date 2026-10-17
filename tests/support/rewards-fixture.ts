import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { TestContext } from "node:test";
import type { RewardsApi, RewardJob, RewardWrite } from "../../src/rewards-api.ts";
export const examples = JSON.parse(readFileSync(new URL("../fixtures/rewards-v1.json", import.meta.url), "utf8"));
export const binding = { apiUrl: "https://fixture.invalid/api/v1/bot/", guildId: examples.guildId as string, applicationId: "222222222222222222", clientId: "fixture-rewards" };
export const apiConfig = { ...binding, apiKey: `bb_fixture-rewards.${"a".repeat(43)}` };
export const job: RewardJob = { id: examples.requestEnvelope.idempotency_key, actor: examples.discordUserId, operation: "request", data: examples.requestEnvelope.data };
export const accepted: RewardWrite = { ok: true, requestId: examples.requestAccepted.requestId, xpDelta: 0, bucksDelta: 0, reservedDelta: 60 };
export const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
export const baseApi = (): RewardsApi => ({
  async account() { return structuredClone(examples.account); }, async catalog() { return structuredClone(examples.catalog); },
  async requests() { return structuredClone(examples.requests); }, async config() { return { enabled: false, rules: [] }; }, async write() { return structuredClone(accepted); },
});
export async function testDirectory(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "besc-rewards-test-"));
  t.after(async () => {
    const target = resolve(directory), root = resolve(tmpdir()) + sep;
    if (!target.startsWith(root) || !target.slice(root.length).startsWith("besc-rewards-test-")) throw Error("Unexpected cleanup target");
    await rm(target, { recursive: true, force: true });
  }); return directory;
}
