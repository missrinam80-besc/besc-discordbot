import { snowflake } from "./ticket-api.ts";
import type { RewardConfig, RewardRule, RewardJob } from "./rewards-api.ts";

export type VoiceFact = { actor: string; channel: string; known: boolean; bot: boolean; muted: boolean | null; deafened: boolean | null; afk: boolean };
type VoiceMinute = { channel: string; start: number; participants: number; muted: boolean; deafened: boolean; afk: boolean };
/** Metadata only. No message content, audio, presence inference or retroactive time. */
export class RewardsActivity {
  private guild: string;
  private enqueue: (job: RewardJob) => unknown;
  private log: (code: string) => void;
  private config: RewardConfig = { enabled: false, rules: [] };
  private until = 0;
  private connected = false;
  private voices = new Map<string, VoiceMinute>();
  private last = new Map<string, number>();
  private observed = 0;
  constructor(guild: string, enqueue: (job: RewardJob) => unknown, log: (code: string) => void = () => {}) {
    this.guild = guild; this.enqueue = enqueue; this.log = log;
  }
  setConfig(config: RewardConfig, now: number) {
    if (JSON.stringify(this.config) !== JSON.stringify(config)) this.voices.clear();
    this.config = structuredClone(config); this.until = now + 90_000;
  }
  connection(ready: boolean) { this.connected = ready; this.voices.clear(); this.observed = 0; }
  invalidate() { this.config = { enabled: false, rules: [] }; this.until = 0; this.voices.clear(); }
  private rule(kind: "text" | "voice", now: number): RewardRule | undefined {
    for (const [id, stamp] of this.last) if (now - stamp > 86400_000) this.last.delete(id);
    if (!this.connected || now >= this.until || !this.config.enabled) { this.voices.clear(); return; }
    return this.config.rules.find(x => x.kind === kind && x.enabled && x.guild_id === this.guild);
  }
  private send(job: RewardJob, now: number) {
    try { this.enqueue(job); this.last.set(`${job.data.kind}:${job.actor}`, now); }
    catch { this.log("rewards_activity_not_queued"); }
    for (const [id, stamp] of this.last) if (now - stamp > 86400_000) this.last.delete(id);
  }
  text(message: { id: string; actor: string; guild: string | null; channel: string; bot: boolean; webhook: boolean; system: boolean; timestamp: number }, now: number) {
    const rule = this.rule("text", now);
    if (!rule || message.guild !== this.guild || message.bot || message.webhook || message.system || !rule.channel_ids.includes(message.channel)
      || !snowflake.test(message.id) || !snowflake.test(message.actor) || !Number.isSafeInteger(message.timestamp) || message.timestamp < now - 120_000 || message.timestamp > now + 5000
      || Math.abs(Number((BigInt(message.id) >> 22n) + 1420070400000n) - message.timestamp) > 1000
      || now - (this.last.get(`text:${message.actor}`) ?? -Infinity) < rule.cooldown_seconds * 1000 || this.last.size >= 10000) return;
    this.send({ id: message.id, actor: message.actor, operation: "activity", data: { kind: "text", channel_id: message.channel, occurred_at: new Date(message.timestamp).toISOString() } }, now);
  }
  observe(facts: readonly VoiceFact[], now: number) {
    const rule = this.rule("voice", now);
    if (!rule) return;
    // A missed sampling interval (e.g. suspended process) invalidates elapsed time.
    if (this.observed && now - this.observed > 15_000) this.voices.clear(); this.observed = now;
    if (facts.length > 10000) { this.voices.clear(); this.log("rewards_voice_snapshot_too_large"); return; }
    const humans = facts.filter(x => x.known && !x.bot && snowflake.test(x.actor) && snowflake.test(x.channel));
    const counts = new Map<string, number>();
    for (const f of humans) counts.set(f.channel, (counts.get(f.channel) ?? 0) + 1);
    const eligible = new Set<string>();
    for (const f of humans) {
      const participants = counts.get(f.channel) ?? 0;
      if (!rule.channel_ids.includes(f.channel) || f.muted === null || f.deafened === null || participants < rule.voice_min_participants
        || rule.exclude_muted && f.muted || rule.exclude_deafened && f.deafened || rule.exclude_afk && f.afk) continue;
      eligible.add(f.actor);
      const prior = this.voices.get(f.actor);
      if (prior && prior.channel === f.channel) {
        prior.participants = Math.min(prior.participants, participants); prior.muted ||= f.muted; prior.deafened ||= f.deafened; prior.afk ||= f.afk;
      } else { this.voices.set(f.actor, { channel: f.channel, start: now, participants, muted: f.muted, deafened: f.deafened, afk: f.afk }); }
    }
    for (const actor of this.voices.keys()) if (!eligible.has(actor)) this.voices.delete(actor);
  }
  tick(now: number) {
    const rule = this.rule("voice", now); if (!rule) return;
    if (!this.observed || now - this.observed > 15_000) { this.voices.clear(); return; }
    for (const [actor, minute] of this.voices) {
      const duration = now - minute.start;
      if (duration < 60_000) continue;
      if (duration <= 75_000 && this.last.size < 10000 && now - (this.last.get(`voice:${actor}`) ?? -Infinity) >= rule.cooldown_seconds * 1000) {
        this.send({ id: `${actor}:${now}`, actor, operation: "activity", data: { kind: "voice", channel_id: minute.channel,
          started_at: new Date(minute.start).toISOString(), occurred_at: new Date(now).toISOString(), eligible_participants: minute.participants,
          muted: minute.muted, deafened: minute.deafened, afk: minute.afk } }, now);
      }
      // New observation period, never emit catch-up minutes after a delay.
      this.voices.delete(actor);
    }
  }
}
