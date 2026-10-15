import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { snowflake, validLease, type SlotFailure, type SlotLease } from "./slot-api.ts";

export type SlotRecord = SlotLease & { phase: "claimed" | "dispatching" | "sent" | "fail" | "uncertain";
  messageId?: string; errorCode?: SlotFailure };
export interface SlotState {
  readonly workerId: string;
  read(): SlotRecord | null;
  write(record: SlotRecord | null): void;
}
function validRecord(v: unknown): v is SlotRecord {
  if (!validLease(v)) return false;
  const r = v as SlotRecord;
  return ["claimed", "dispatching", "sent", "fail", "uncertain"].includes(r.phase)
    && (r.phase !== "sent" || (typeof r.messageId === "string" && snowflake.test(r.messageId)))
    && (r.phase !== "fail" || ["dm_closed", "discord_unavailable", "outcome_unknown"].includes(r.errorCode ?? ""));
}
function minimal(r: SlotRecord | null): SlotRecord | null {
  return r && { id: r.id, lease_token: r.lease_token, lease_until: r.lease_until, phase: r.phase,
    ...(r.messageId ? { messageId: r.messageId } : {}), ...(r.errorCode ? { errorCode: r.errorCode } : {}) };
}
/** One bounded in-flight record, fsynced before dispatch and before acknowledging a send.
 * A process lock fails closed after an unclean exit; only an operator may clear a stale lock.
 * No message content, recipient, booking details, API key or bot token is stored. */
export class FileSlotState implements SlotState {
  readonly workerId: string;
  readonly path: string;
  private active: SlotRecord | null;
  private lock: number;
  private poisoned = false;
  private closed = false;
  private namespace: string;
  private directory: string;
  constructor(directory: string, binding: { apiUrl: string; guildId: string; applicationId: string; clientId: string }) {
    if (!isAbsolute(directory)) throw Error("slot_state_absolute_path_required");
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const namespace = createHash("sha256").update(JSON.stringify(binding)).digest("hex");
    this.namespace = namespace;
    this.path = join(directory, `slots-${namespace}.json`);
    this.lock = openSync(`${this.path}.lock`, "wx", 0o600);
    try {
      if (existsSync(this.path)) {
        if (statSync(this.path).size > 32_768) throw Error("slot_state_invalid");
        const saved = JSON.parse(readFileSync(this.path, "utf8"));
        if (saved.version !== 1 || saved.namespace !== namespace || !/^[A-Za-z0-9_-]{8,40}$/.test(saved.workerId)
          || (saved.active !== null && !validRecord(saved.active))) throw Error("slot_state_invalid");
        this.workerId = saved.workerId; this.active = minimal(saved.active);
      } else {
        this.workerId = `slot_${randomUUID().replaceAll("-", "")}`;
        this.active = null;
      }
      this.persist();
    } catch (e) { closeSync(this.lock); unlinkSync(`${this.path}.lock`); throw e; }
  }
  private save(namespace: string, directory: string) {
    const temporary = `${this.path}.tmp`;
    const fd = openSync(temporary, "w", 0o600);
    try { writeFileSync(fd, JSON.stringify({ version: 1, namespace, workerId: this.workerId, active: this.active })); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, this.path);
    // Linux production: make the directory entry durable as well. Windows cannot fsync directories.
    if (process.platform !== "win32") { const dir = openSync(directory, "r"); try { fsyncSync(dir); } finally { closeSync(dir); } }
  }
  private persist() {
    if (this.poisoned || this.closed) throw Error("slot_state_unavailable");
    try { this.save(this.namespace, this.directory); } catch { this.poisoned = true; throw Error("slot_state_unavailable"); }
  }
  read() { if (this.closed || this.poisoned) throw Error("slot_state_unavailable"); return minimal(this.active); }
  write(record: SlotRecord | null) {
    if (record !== null && !validRecord(record)) throw Error("slot_state_invalid");
    this.active = minimal(record); this.persist();
  }
  close() {
    if (this.closed) return;
    this.closed = true; closeSync(this.lock); unlinkSync(`${this.path}.lock`);
  }
}
