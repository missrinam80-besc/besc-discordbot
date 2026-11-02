import type { EventInterestApi } from './event-sync-api.ts';
import type { EventInterestDiscord } from './event-sync-discord.ts';
/** Only complete, bounded user-ID snapshots are submitted. No RSVP or check-in writes. */
export function createEventInterestWorker(api: EventInterestApi, discord: EventInterestDiscord,
  log: (code: string) => void = () => {}, now = Date.now) {
  let active: Promise<void> | undefined, stopped = false;
  async function run() {
    try {
      for (const target of await api.interestTargets()) {
        if (stopped) return;
        try {
          const observed = new Date(now()).toISOString();
          const users = await discord.interestedUsers(target.discord_event_id, target.publication_id);
          if (now() - Date.parse(observed) > 9 * 60_000 || stopped) return;
          await api.interestSnapshot(target, users, observed);
        } catch { log('event_interest_unconfirmed'); }
      }
    } catch { log('event_interest_unavailable'); }
  }
  return { tick() { if (stopped) return Promise.resolve(); if (!active) active = run().finally(() => { active = undefined; }); return active; },
    async stop() { stopped = true; await active; } };
}
