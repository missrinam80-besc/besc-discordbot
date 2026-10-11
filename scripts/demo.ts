import { createServer } from "node:http";
import { once } from "node:events";
import { createApi } from "../src/api.ts";
import { createCommandHandler, type CommandInteraction } from "../src/handler.ts";
import { fixture, fixtureDiscord, fixtureGuild, fixtureKey } from "./fixture.ts";

const f = fixture();
const server = createServer(async (req, res) => {
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("no_address");
    const response = await f.handle(new Request(`http://127.0.0.1:${address.port}${req.url}`, {
      method: req.method, headers: req.headers as Record<string, string>,
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  } catch { res.writeHead(500); res.end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
try {
  const address = server.address();
  if (!address || typeof address === "string") throw Error("no_address");
  const api = createApi({ apiUrl: `http://127.0.0.1:${address.port}/api/v1/bot/`, apiKey: fixtureKey, guildId: fixtureGuild });
  const handler = createCommandHandler(api, fixtureGuild);
  console.info("LOKALE PROEF — TESTFIXTURE — NIET PUBLICEREN. Geen Discord- of Supabase-verbinding.");
  for (const subcommand of ["status", "account", "events"]) {
    const interaction: CommandInteraction = { id: `demo-${subcommand}`, commandName: "besc", guildId: fixtureGuild,
      user: { id: fixtureDiscord }, options: { getSubcommand: () => subcommand, getInteger: () => null },
      deferReply: async () => {}, editReply: async ({ content }) => console.info(`/besc ${subcommand}\n${content}\n`) };
    await handler(interaction);
  }
} finally { server.close(); server.closeAllConnections(); }
