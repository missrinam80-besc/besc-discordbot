export type EventSyncLease = { id: string; lease_token: string; lease_until: string };
export type DiscordEventPayload = {
  name: string; description: string; scheduled_start_time: string; scheduled_end_time: string;
  privacy_level: 2; entity_type: 3; channel_id: null; entity_metadata: { location: string };
};
export type EventSyncJob = EventSyncLease & {
  guild_id: string; publication_id: string; event_id: string; revision: number; operation: "upsert" | "withdraw" | "complete";
  discord_event_id: string | null; payload: DiscordEventPayload | null;
};
export type EventSyncFailure = "invalid_job" | "not_dispatched" | "remote_missing" | "remote_terminal" | "outcome_unknown";
export type EventSyncRecord = EventSyncLease & {
  phase: "claimed" | "dispatching" | "applied" | "uncertain";
  discord_event_id?: string;
};
export interface EventSyncState { readonly workerId: string; read(): EventSyncRecord | null; write(value: EventSyncRecord | null): void }
export interface EventSyncApi {
  claim(workerId: string): Promise<EventSyncJob | null>;
  inspect(workerId: string, lease: EventSyncLease): Promise<EventSyncJob | null>;
  // The CC implementation must recheck current release, source revision, guild,
  // bound client, lease and cancellation immediately before returning true.
  dispatch(workerId: string, lease: EventSyncLease): Promise<boolean>;
  complete(workerId: string, lease: EventSyncLease, discordEventId: string | null): Promise<void>;
  // A dispatched or uncertain lease must NEVER become a fresh create job merely
  // because its timeout elapsed. Human reconciliation is required on ambiguity.
  fail(workerId: string, lease: EventSyncLease, code: EventSyncFailure): Promise<void>;
}
export interface EventSyncDiscord {
  readonly guildId: string;
  readonly botUserId: string;
  inspect(id: string): Promise<RemoteScheduledEvent | null>;
  findByReference(publicationId: string): Promise<RemoteScheduledEvent[]>;
  create(payload: DiscordEventPayload): Promise<string>;
  update(id: string, payload: DiscordEventPayload): Promise<void>;
  setStatus(id: string, status: 3 | 4): Promise<void>;
}
export type RemoteScheduledEvent = { id: string; guild_id: string; creator_id: string; status: 1 | 2 | 3 | 4;
  publication_id: string | null; payload: DiscordEventPayload | null };
const snowflake = /^[1-9]\d{16,19}$/;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function validEventSyncLease(v: unknown): v is EventSyncLease {
  const x = v as EventSyncLease | null;
  return Boolean(x && uuid.test(x.id) && uuid.test(x.lease_token)
    && typeof x.lease_until === "string" && Number.isFinite(Date.parse(x.lease_until)));
}
function validJob(j: EventSyncJob, guild: string, now: number) {
  if (!validEventSyncLease(j) || j.guild_id !== guild || !uuid.test(j.event_id) || !uuid.test(j.publication_id)
    || !Number.isSafeInteger(j.revision) || j.revision < 1 || !["upsert", "withdraw", "complete"].includes(j.operation)
    || (j.discord_event_id !== null && !snowflake.test(j.discord_event_id))) return false;
  if (j.operation !== "upsert") return j.payload === null;
  const p = j.payload;
  return Boolean(p && typeof p.name === "string" && p.name.trim() && p.name.length <= 100
    && typeof p.description === "string" && p.description.trim() && p.description.length <= 1000
    && !/@everyone|@here|<@[!&]?\d+>|[\u0000-\u0008\u000b-\u001f\u007f]/i.test(p.name + p.description + p.entity_metadata?.location)
    && Object.keys(p).sort().join(',') === 'channel_id,description,entity_metadata,entity_type,name,privacy_level,scheduled_end_time,scheduled_start_time'
    && Object.keys(p.entity_metadata ?? {}).join(',') === 'location'
    && p.privacy_level === 2 && p.entity_type === 3 && p.channel_id === null
    && typeof p.entity_metadata?.location === "string" && p.entity_metadata.location.trim() && p.entity_metadata.location.length <= 100
    && typeof p.scheduled_start_time === "string" && typeof p.scheduled_end_time === "string"
    && /(?:Z|[+-]\d\d:\d\d)$/.test(p.scheduled_start_time) && /(?:Z|[+-]\d\d:\d\d)$/.test(p.scheduled_end_time)
    && Date.parse(p.scheduled_end_time) > Date.parse(p.scheduled_start_time)
    && (j.discord_event_id !== null || Date.parse(p.scheduled_start_time) > now));
}
function minimalLease(j: EventSyncLease): EventSyncLease { return { id: j.id, lease_token: j.lease_token, lease_until: j.lease_until }; }
function samePayload(a: DiscordEventPayload | null, b: DiscordEventPayload | null): boolean {
  return Boolean(a && b && a.name === b.name && a.description === b.description
    && a.entity_type === b.entity_type && a.privacy_level === b.privacy_level && a.channel_id === b.channel_id
    && a.entity_metadata.location === b.entity_metadata.location
    && Date.parse(a.scheduled_start_time) === Date.parse(b.scheduled_start_time)
    && Date.parse(a.scheduled_end_time) === Date.parse(b.scheduled_end_time));
}

/** Dependency-injected synchronization core.
 * The durable journal is written BEFORE the Discord mutation and BEFORE the CC
 * acknowledgement. A restart or lost response never causes a second create. */
export function createEventSyncWorker(api: EventSyncApi, discord: EventSyncDiscord, state: EventSyncState,
  log: (code: string) => void = () => {}, now = Date.now) {
  let active: Promise<void> | undefined, stopped = false;
  async function run() {
    try {
      const pending = state.read();
      if (pending) {
        if (pending.phase === "applied") {
          await api.complete(state.workerId, pending, pending.discord_event_id ?? null); state.write(null);
        } else if (pending.phase === "claimed") {
          await api.fail(state.workerId, pending, "not_dispatched"); state.write(null);
        } else {
          const previous = await api.inspect(state.workerId, pending);
          if (previous && validJob(previous, discord.guildId, Number.NEGATIVE_INFINITY)) {
            const candidates = previous.discord_event_id
              ? [await discord.inspect(previous.discord_event_id)].filter((v): v is RemoteScheduledEvent => v !== null)
              : await discord.findByReference(previous.publication_id);
            const matches = candidates.filter(v => v.guild_id === discord.guildId && v.creator_id === discord.botUserId
              && v.publication_id === previous.publication_id && snowflake.test(v.id));
            if (matches.length === 1 && (previous.operation === "upsert"
              ? [1, 2].includes(matches[0].status) && samePayload(matches[0].payload, previous.payload)
              : [3, 4].includes(matches[0].status))) {
              state.write({ ...minimalLease(pending), phase: "applied", discord_event_id: matches[0].id });
              await api.complete(state.workerId, pending, matches[0].id); state.write(null); return;
            }
          }
          await api.fail(state.workerId, pending, "outcome_unknown"); log("event_reconciliation_required");
        }
        return;
      }
      const job = await api.claim(state.workerId); if (!job) return;
      if (!validEventSyncLease(job)) { log("event_invalid_lease"); return; }
      const lease = minimalLease(job); state.write({ ...lease, phase: "claimed" });
      if (!validJob(job, discord.guildId, now()) || Date.parse(job.lease_until) - now() < 40_000) {
        await api.fail(state.workerId, lease, "invalid_job"); state.write(null); return;
      }
      let remote: Awaited<ReturnType<EventSyncDiscord["inspect"]>> = null;
      if (job.discord_event_id) {
        remote = await discord.inspect(job.discord_event_id);
        if (remote && (remote.id !== job.discord_event_id || remote.guild_id !== discord.guildId || remote.creator_id !== discord.botUserId || remote.publication_id !== job.publication_id || ![1, 2, 3, 4].includes(remote.status))) {
          await api.fail(state.workerId, lease, "invalid_job"); state.write(null); return;
        }
        if (!remote) { await api.fail(state.workerId, lease, "remote_missing"); state.write(null); return; }
        if (job.operation === "upsert" && remote && [3, 4].includes(remote.status)) { await api.fail(state.workerId, lease, "remote_terminal"); state.write(null); return; }
      }
      if (Date.parse(job.lease_until) - now() < 20_000 || !await api.dispatch(state.workerId, lease) || Date.parse(job.lease_until) - now() < 10_000) {
        await api.fail(state.workerId, lease, "not_dispatched"); state.write(null); return;
      }
      // Full payloads, visitor details and credentials never enter durable state.
      state.write({ ...lease, phase: "dispatching" });
      let appliedId = job.discord_event_id;
      try {
        if (job.operation === "upsert") {
          if (appliedId) await discord.update(appliedId, job.payload!);
          else appliedId = await discord.create(job.payload!);
          if (!appliedId || !snowflake.test(appliedId)) throw Error("invalid_effect_response");
        } else if (remote && ![3, 4].includes(remote.status)) {
          // Discord forbids scheduled -> completed and active -> cancelled.
          await discord.setStatus(remote.id, remote.status === 1 ? 4 : 3);
        }
      } catch {
        state.write({ ...lease, phase: "uncertain" });
        await api.fail(state.workerId, lease, "outcome_unknown"); log("event_reconciliation_required"); return;
      }
      // Persist outside the effect catch. A storage failure must not be treated
      // as proof that Discord did not create the event.
      state.write({ ...lease, phase: "applied", ...(appliedId ? { discord_event_id: appliedId } : {}) });
      await api.complete(state.workerId, lease, appliedId); state.write(null);
    } catch { log("event_sync_unconfirmed"); }
  }
  return {
    tick(): Promise<void> { if (stopped) return Promise.resolve(); if (!active) active = run().finally(() => { active = undefined; }); return active; },
    async stop() { stopped = true; await active; },
  };
}
