import assert from "node:assert/strict";
import test from "node:test";
import { createRewardsApi } from "../src/rewards-api.ts";
import { FileRewardState } from "../src/rewards-state.ts";
import { createRewardsWorker } from "../src/rewards-worker.ts";
import { apiConfig, binding, examples, job, response, testDirectory } from "./support/rewards-fixture.ts";

test("Actual rewards transport replays the immutable journal envelope after a lost response and process restart", async t => {
  const directory = await testDirectory(t), bodies: string[] = []; let lost = true, now = 1_800_000_000_000;
  const api = createRewardsApi(apiConfig, async (url, init) => {
    assert.equal(String(url), "https://fixture.invalid/api/v1/bot/rewards/requests");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${apiConfig.apiKey}`);
    bodies.push(String(init?.body)); assert.deepEqual(JSON.parse(String(init?.body)), examples.requestEnvelope);
    if (lost) { lost = false; throw Error("TESTFIXTURE response lost after upstream commit"); }
    return response(examples.requestAccepted);
  });
  let state = new FileRewardState(directory, binding), worker = createRewardsWorker(api, state, false, undefined, () => now);
  try {
    worker.enqueue(job); await worker.tick(); assert.equal(state.read("request", job.id)?.phase, "pending");
    await worker.stop(); state.close(); now += 5000;
    state = new FileRewardState(directory, binding); worker = createRewardsWorker(api, state, false, undefined, () => now);
    await worker.tick(); assert.equal(state.read("request", job.id)?.phase, "done"); assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
  } finally { await worker.stop(); state.close(); }
});
