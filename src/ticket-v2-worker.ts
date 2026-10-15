import { randomUUID } from "node:crypto";
import type { V2Api } from "./ticket-v2-api.ts";
import type { ConfigDelivery } from "./ticket-v2-schema.ts";
export type ConfigFailureCode = "discord_unavailable" | "permission_denied" | "message_missing" | "duplicate_marker" | "outcome_unknown" | "server_admin_denied";
export class ConfigFailure extends Error {
  code: ConfigFailureCode; uncertain: boolean;
  constructor(code: ConfigFailureCode, uncertain = true) { super(code); this.code = code; this.uncertain = uncertain; }
}
export interface ConfigEffects { execute(d: ConfigDelivery, inspect: () => Promise<ConfigDelivery>): Promise<Record<string, unknown>>; confirmed?(d: ConfigDelivery): Promise<void>; }
export function createConfigWorker(api: V2Api, effects: ConfigEffects, log: (code: string) => void, worker = `config_${randomUUID()}`) {
  let running = false;
  return async () => {
    if (running) return; running = true;
    try {
      const batch = await api.claim(worker);
      await Promise.all(batch.map(async d => {
        const inspect = async () => {
          const current = await api.inspect(d, worker);
          if (Date.parse(current.leasedUntil) - Date.now() < 10000) throw new ConfigFailure("outcome_unknown");
          return current;
        };
        if (Date.parse(d.leasedUntil) - Date.now() < 10000) return;
        let result: Record<string, unknown>;
        try { result = await effects.execute(await inspect(), inspect); }
        catch (e) {
          const f = e instanceof ConfigFailure ? e : typeof e === "object" && e && "code" in e && [50013, 50001].includes(Number(e.code))
            ? new ConfigFailure("permission_denied", false) : new ConfigFailure("outcome_unknown");
          try { await api.fail(d, worker, f.code, f.uncertain); } catch { log("config_failure_ack_unavailable"); }
          return;
        }
        try { await api.complete(d, worker, result); } catch { log("config_complete_ack_unavailable"); return; }
        try { await effects.confirmed?.(d); } catch { log("config_journal_cleanup_unavailable"); }
      }));
    } catch { log("config_claim_unavailable"); }
    finally { running = false; }
  };
}
