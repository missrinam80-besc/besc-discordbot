import { createHash, randomBytes } from "node:crypto";
const id = process.argv[2];
if (!id || !/^[a-z0-9-]{3,64}$/.test(id)) {
  console.error("Gebruik: npm run key:generate -- besc-discord-dev. Bewaar uitvoer als geheim buiten Git."); process.exitCode = 1;
} else {
  const key = `bb_${id}.${randomBytes(32).toString("base64url")}`;
  console.info(JSON.stringify({ apiKey: key, clientId: id, keyHash: createHash("sha256").update(key).digest("hex") }, null, 2));
}
