import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { snowflake, uuid } from "./ticket-api.ts";
export type EffectRecord = { guild: string; channel: string; message: string; payloadHash: string; marker: string };
export interface V2State {
  parents(): string[];
  parent(id: string): Promise<void>;
  effect(id: string): EffectRecord | undefined;
  remember(id: string, record: EffectRecord): Promise<void>;
  forget?(id: string): Promise<void>;
}
export class FileV2State implements V2State {
  private directory: string; private path: string; private data = { parents: [] as string[], effects: {} as Record<string, EffectRecord> };
  private writes: Promise<void> = Promise.resolve();
  constructor(directory: string, guild: string, application: string) {
    if (!snowflake.test(guild) || !snowflake.test(application)) throw Error("invalid_state_binding");
    this.directory = directory; this.path = join(directory, `${guild}-${application}.json`);
  }
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const text = await readFile(this.path, "utf8");
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw Error("state_too_large");
      const v = JSON.parse(text);
      if (!Array.isArray(v.parents) || v.parents.length > 1000 || v.parents.some((p: unknown) => typeof p !== "string" || !snowflake.test(p))
        || !v.effects || typeof v.effects !== "object" || Array.isArray(v.effects) || Object.keys(v.effects).length > 10000) throw Error("invalid_state");
      for (const [id, e] of Object.entries(v.effects) as [string, EffectRecord][]) {
        if (!uuid.test(id) || !e || !snowflake.test(e.guild) || !snowflake.test(e.channel) || !snowflake.test(e.message)
          || !/^[a-f0-9]{64}$/.test(e.payloadHash) || !/^besc-panel-[a-f0-9-]{36}$/i.test(e.marker)) throw Error("invalid_state");
      }
      this.data = v;
    } catch (e) { if (!(typeof e === "object" && e && "code" in e && e.code === "ENOENT")) throw e; }
  }
  private update(change: (next: typeof this.data) => void) {
    const write = this.writes.then(async () => {
      const next = structuredClone(this.data); change(next); const snapshot = JSON.stringify(next);
      if (Buffer.byteLength(snapshot) > 16 * 1024 * 1024) throw Error("state_too_large");
      await writeFile(`${this.path}.next`, snapshot, { mode: 0o600 }); await rename(`${this.path}.next`, this.path); this.data = next;
    });
    this.writes = write.catch(() => {}); return write;
  }
  parents() { return [...this.data.parents]; }
  async parent(id: string) {
    if (!snowflake.test(id)) throw Error("invalid_parent");
    if (!this.data.parents.includes(id)) await this.update(next => { if (!next.parents.includes(id)) { if (next.parents.length >= 1000) throw Error("parent_limit"); next.parents.push(id); } });
  }
  effect(id: string) { return this.data.effects[id]; }
  async remember(id: string, record: EffectRecord) {
    if (!uuid.test(id)) throw Error("invalid_effect");
    await this.update(next => { if (!next.effects[id] && Object.keys(next.effects).length >= 10000) throw Error("effect_limit"); next.effects[id] = record; });
  }
  forget(id: string) { return this.update(next => { delete next.effects[id]; }); }
}
