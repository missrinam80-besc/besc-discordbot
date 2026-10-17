import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { validRewardJob, validRewardWrite, type RewardJob, type RewardWrite } from "./rewards-api.ts";

export type RewardRecord = RewardJob & { phase: "pending" | "done" | "rejected" | "attention"; createdAt: number; attempts: number; nextAttemptAt: number; error?: string; result?: RewardWrite };
export interface RewardState {
  enqueue(job: RewardJob, now: number): RewardRecord;
  read(operation: RewardJob["operation"], id: string): RewardRecord | undefined;
  pending(now: number, activity: boolean): RewardRecord | undefined;
  update(record: RewardRecord): void;
  outstanding(actor: string): boolean;
}
export const rewardKey = (job: RewardJob) => `${job.operation}:${job.id}`;
const clone = <T>(v: T): T => structuredClone(v);
const canonical = (job: RewardJob) => JSON.stringify({ actor: job.actor, operation: job.operation, data: Object.fromEntries(Object.entries(job.data).sort(([a], [b]) => a.localeCompare(b))) });
const phase = (v: unknown): v is RewardRecord => {
  if (!validRewardJob(v)) return false;
  const r = v as RewardRecord;
  return ["pending", "done", "rejected", "attention"].includes(r.phase) && Number.isSafeInteger(r.createdAt) && r.createdAt > 0
    && Number.isSafeInteger(r.nextAttemptAt) && r.nextAttemptAt >= 0 && Number.isInteger(r.attempts) && r.attempts >= 0 && r.attempts <= 8
    && (r.error === undefined || /^[a-z_]{1,64}$/.test(r.error))
    && (r.phase !== "done" || validRewardWrite(r.result, r));
};

/** Fsynced before every API write. No Discord interaction token, message text,
 * API key, mail address or voice audio is stored. A stale process lock fails closed. */
export class FileRewardState implements RewardState {
  readonly path: string;
  private directory: string;
  private namespace: string;
  private lock: number;
  private closed = false;
  private poisoned = false;
  private records: RewardRecord[] = [];
  constructor(directory: string, binding: { apiUrl: string; guildId: string; applicationId: string; clientId: string }) {
    if (!isAbsolute(directory)) throw Error("rewards_state_absolute_path_required");
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.namespace = createHash("sha256").update(JSON.stringify(binding)).digest("hex");
    this.path = join(directory, `rewards-${this.namespace}.json`);
    // A rotated binding may not silently abandon an uncertain earlier action.
    for (const name of readdirSync(directory)) {
      if (!/^rewards-[a-f0-9]{64}\.json$/.test(name) || join(directory, name) === this.path) continue;
      const oldPath = join(directory, name);
      if (!lstatSync(oldPath).isFile() || lstatSync(oldPath).size > 4_194_304) throw Error("rewards_previous_binding_unavailable");
      const old: unknown = JSON.parse(readFileSync(oldPath, "utf8"));
      if (!old || typeof old !== "object") throw Error("rewards_previous_binding_unavailable");
      const saved = old as { version?: unknown; namespace?: unknown; records?: unknown };
      if (saved.version !== 1 || saved.namespace !== name.slice(8, -5) || !Array.isArray(saved.records)
        || saved.records.length > 1000 || !saved.records.every(phase)) throw Error("rewards_previous_binding_unavailable");
      if (saved.records.some(x => x.phase === "pending" || x.phase === "attention")) throw Error("rewards_previous_binding_unresolved");
    }
    this.lock = openSync(`${this.path}.lock`, "wx", 0o600);
    try {
      if (existsSync(this.path)) {
        const stat = lstatSync(this.path);
        if (!stat.isFile() || stat.size > 4_194_304) throw Error("rewards_state_invalid");
        const saved = JSON.parse(readFileSync(this.path, "utf8"));
        if (saved.version !== 1 || saved.namespace !== this.namespace || !Array.isArray(saved.records) || saved.records.length > 1000 || !saved.records.every(phase)
          || new Set(saved.records.map(rewardKey)).size !== saved.records.length) throw Error("rewards_state_invalid");
        this.records = saved.records;
      }
      this.persist();
    } catch (e) { closeSync(this.lock); unlinkSync(`${this.path}.lock`); throw e; }
  }
  private check() { if (this.closed || this.poisoned) throw Error("rewards_state_unavailable"); }
  private persist() {
    this.check();
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(temporary, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify({ version: 1, namespace: this.namespace, records: this.records })); fsyncSync(fd); }
      finally { closeSync(fd); }
      renameSync(temporary, this.path);
      if (process.platform !== "win32") { const dir = openSync(this.directory, "r"); try { fsyncSync(dir); } finally { closeSync(dir); } }
    } catch { this.poisoned = true; throw Error("rewards_state_unavailable"); }
  }
  enqueue(job: RewardJob, now: number) {
    this.check();
    if (!validRewardJob(job) || !Number.isSafeInteger(now) || now <= 0) throw Error("rewards_job_invalid");
    const old = this.records.find(x => rewardKey(x) === rewardKey(job));
    if (old) { if (canonical(old) !== canonical(job)) throw Error("rewards_idempotency_conflict"); return clone(old); }
    if (job.operation !== "activity" && this.outstanding(job.actor)) throw Error("rewards_previous_action_unresolved");
    this.records = this.records.filter(x => x.phase === "pending" || x.phase === "attention" || now - x.createdAt < 7 * 86400_000);
    while (this.records.length >= 1000) {
      const i = this.records.findIndex(x => x.phase === "done" || x.phase === "rejected");
      if (i < 0) throw Error("rewards_queue_full"); this.records.splice(i, 1);
    }
    if (this.records.filter(x => x.phase === "pending" || x.phase === "attention").length >= 256) throw Error("rewards_queue_full");
    const record: RewardRecord = { ...clone(job), phase: "pending", createdAt: now, attempts: 0, nextAttemptAt: now };
    this.records.push(record); this.persist(); return clone(record);
  }
  read(operation: RewardJob["operation"], id: string) { this.check(); const r = this.records.find(x => x.operation === operation && x.id === id); return r && clone(r); }
  pending(now: number, activity: boolean) {
    this.check();
    const rows = this.records.filter(x => x.phase === "pending" && x.nextAttemptAt <= now && (activity || x.operation !== "activity"));
    const r = rows.find(x => x.operation !== "activity") ?? rows[0]; return r && clone(r);
  }
  update(record: RewardRecord) {
    this.check(); const index = this.records.findIndex(x => rewardKey(x) === rewardKey(record));
    if (index < 0 || !phase(record) || canonical(record) !== canonical(this.records[index])) throw Error("rewards_job_invalid");
    this.records[index] = clone(record); this.persist();
  }
  outstanding(actor: string) { this.check(); return this.records.some(x => x.actor === actor && x.operation !== "activity" && ["pending", "attention"].includes(x.phase)); }
  close() { if (this.closed) return; this.closed = true; closeSync(this.lock); unlinkSync(`${this.path}.lock`); }
}
