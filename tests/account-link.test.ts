import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/api.ts";
import { createCommandHandler } from "../src/handler.ts";
test("Ongekoppelde gebruiker krijgt uitsluitend een accountlink naar de ingestelde webapp", async () => {
  let output = "";
  const denied = async () => { throw new ApiError("account_unavailable", 404); };
  const handler = createCommandHandler({ identity: denied, account: denied, events: denied }, "111111111111111111",
    undefined, undefined, "https://example.invalid");
  await handler({ id: "account-link", commandName: "besc", guildId: "111111111111111111", user: { id: "222222222222222222" },
    options: { getSubcommand: () => "account", getInteger: () => null }, deferReply: async () => {},
    editReply: async ({ content }) => { output = content; } });
  assert.match(output, /https:\/\/example.invalid\/app\/account/); assert.doesNotMatch(output, /discord_user_id|222222222222222222/);
});
