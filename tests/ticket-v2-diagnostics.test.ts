import test from "node:test";
import assert from "node:assert/strict";
import { DiscordAPIError } from "discord.js";
import type { DiscordErrorData } from "@discordjs/rest";
import { ApiError } from "../src/api.ts";
import { safeV2Diagnostic } from "../src/ticket-v2-handler.ts";

const privateValue = "SECRET_TOKEN_OR_ANSWER";
function discordError(code: number, errors: DiscordErrorData["errors"] = {}) {
  return new DiscordAPIError({ message: privateValue, code, errors }, code, 400, "POST",
    `https://discord.com/api/v10/interactions/123/${privateValue}/callback`, { body: { data: { answer: privateValue } } });
}

test("Discord modal failure reports numeric category and structural field paths, never values or URL", () => {
  const error = discordError(50035, {
    data: { components: { "0": { component: { label: { _errors: [{ code: privateValue, message: privateValue }] } } } } },
    [privateValue]: { _errors: [{ code: privateValue, message: privateValue }] },
  });
  const output = safeV2Diagnostic(error, true);
  assert.deepEqual(output, ["typed_show_modal_discord_50035", "typed_show_modal_field_data.components.0.component.label"]);
  assert.ok(!JSON.stringify(output).includes(privateValue));
});

test("Known Discord failures remain distinct; unknown codes and arbitrary error text are suppressed", () => {
  for (const code of [10062, 40060, 50001, 50013]) assert.deepEqual(safeV2Diagnostic(discordError(code), true), [`typed_show_modal_discord_${code}`]);
  assert.deepEqual(safeV2Diagnostic(discordError(999999), false), ["typed_interaction_discord_other"]);
  assert.deepEqual(safeV2Diagnostic(new Error(privateValue), true), ["typed_show_modal_unexpected"]);
  assert.deepEqual(safeV2Diagnostic({ code: 50035, message: privateValue }, true), ["typed_show_modal_unexpected"]);
});

test("API diagnostics use only allowlisted codes and distinguish earlier failures from modal opening", () => {
  assert.deepEqual(safeV2Diagnostic(new ApiError("invalid_response", 502), false), ["typed_interaction_api_invalid_response"]);
  assert.deepEqual(safeV2Diagnostic(new ApiError(privateValue, 500), false), ["typed_interaction_api_other"]);
});

test("Invalid-form field metadata is bounded and rejects arbitrary field names", () => {
  const components = Object.fromEntries(Array.from({ length: 25 }, (_, n) => [n, { component: { label: { _errors: [{ code: privateValue, message: privateValue }] } } }]));
  const output = safeV2Diagnostic(discordError(50035, { components }), true);
  assert.equal(output.length, 11);
  assert.ok(output.every(code => !code.includes(privateValue)));
});
