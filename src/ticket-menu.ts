import { randomBytes } from "node:crypto";
import { ComponentType, type Message } from "discord.js";
import { uuid } from "./ticket-api.ts";

type Row = ReturnType<Message["components"][number]["toJSON"]>;

// The optional UI nonce is not a CC revision or an authorization credential.
// 83-character panel IDs plus ':' and 16 hex characters fit Discord's 100 limit.
export function ticketMenuBaseId(id: string): string | null {
  const parts = id.split(":");
  if (parts[0] !== "besc" || parts[1] !== "v2") return null;
  const length = parts[2] === "choose" ? 3 : parts[2] === "p" && uuid.test(parts[3] ?? "") && uuid.test(parts[4] ?? "") ? 5 : 0;
  if (!length || !(parts.length === length || parts.length === length + 1 && /^[a-f0-9]{16}$/.test(parts[length]))) return null;
  return parts.slice(0, length).join(":");
}

export function renewTicketMenu(rows: Row[], baseId: string): Row[] {
  const used = new Set(rows.flatMap(row => [row.id, ...(row.type === ComponentType.ActionRow ? row.components.map(c => c.id) : [])]));
  const nextId = () => { let id = 1; while (used.has(id)) id++; used.add(id); return id; };
  return rows.map(row => {
    if (row.type !== ComponentType.ActionRow || !row.components.some(c => c.type === ComponentType.StringSelect && ticketMenuBaseId(c.custom_id) === baseId)) return row;
    return { ...row, id: nextId(), components: row.components.map(c => c.type === ComponentType.StringSelect && ticketMenuBaseId(c.custom_id) === baseId
      ? { ...c, id: nextId(), custom_id: `${baseId}:${randomBytes(8).toString("hex")}`, options: c.options.map(option => ({ ...option, default: false })) } : c) };
  });
}
