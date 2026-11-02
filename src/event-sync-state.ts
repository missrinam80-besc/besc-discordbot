import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { validEventSyncLease, type EventSyncRecord, type EventSyncState } from "./event-sync-worker.ts";
const snowflake = /^[1-9]\d{16,19}$/;
function validRecord(v: unknown): v is EventSyncRecord {
  if (!validEventSyncLease(v)) return false;
  const r = v as EventSyncRecord;
  return ["claimed", "dispatching", "applied", "uncertain"].includes(r.phase)
    && (r.discord_event_id === undefined || snowflake.test(r.discord_event_id));
}
function minimal(r: EventSyncRecord | null): EventSyncRecord | null {
  return r && { id: r.id, lease_token: r.lease_token, lease_until: r.lease_until, phase: r.phase,
    ...(r.discord_event_id ? { discord_event_id: r.discord_event_id } : {}) };
}
/** Separate fsynced journal and exclusive process lock. No event description,
 * attendee details, bot token or CC key is persisted. Opened only after the explicit runtime flag and scope checks. */
export class FileEventSyncState implements EventSyncState {
  readonly workerId: string;
  readonly path: string;
  private active: EventSyncRecord | null;
  private lock: number;
  private poisoned = false;
  private closed = false;
  private namespace: string;
  private directory: string;
  constructor(directory: string, binding: { apiUrl: string; guildId: string; applicationId: string; clientId: string }) {
    if (!isAbsolute(directory)) throw Error("event_sync_state_absolute_path_required");
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const namespace = createHash("sha256").update(JSON.stringify(binding)).digest("hex");
    this.namespace = namespace;
    this.path = join(directory, `events-${namespace}.json`);
    this.lock = openSync(`${this.path}.lock`, "wx", 0o600);
    try {
      if (existsSync(this.path)) {
        if (statSync(this.path).size > 32_768) throw Error("event_sync_state_invalid");
        const saved = JSON.parse(readFileSync(this.path, "utf8"));
        if (saved.version !== 1 || saved.namespace !== namespace || !/^[A-Za-z0-9_-]{8,40}$/.test(saved.workerId)
          || (saved.active !== null && !validRecord(saved.active))) throw Error("event_sync_state_invalid");
        this.workerId = saved.workerId; this.active = minimal(saved.active);
      } else {
        this.workerId = `event_${randomUUID().replaceAll("-", "")}`;
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
    if (this.poisoned || this.closed) throw Error("event_sync_state_unavailable");
    try { this.save(this.namespace, this.directory); } catch { this.poisoned = true; throw Error("event_sync_state_unavailable"); }
  }
  read() { if (this.closed || this.poisoned) throw Error("event_sync_state_unavailable"); return minimal(this.active); }
  write(record: EventSyncRecord | null) {
    if (record !== null && !validRecord(record)) throw Error("event_sync_state_invalid");
    this.active = minimal(record); this.persist();
  }
  close() {
    if (this.closed) return;
    this.closed = true; closeSync(this.lock); unlinkSync(`${this.path}.lock`);
  }
}
