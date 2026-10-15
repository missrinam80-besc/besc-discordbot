# Afzonderlijke CC-overdracht — slotworker

## Context en bevestigde feiten

De botworker is lokaal gebouwd tegen CC PR #99 / main `d7022f659dac52dce7743e4887265c24a9c80de2`, het definitieve release-99-contract en de gedeelde fixtures. De vier POST-routes zijn `slot-messages/claim`, `dispatch`, `sent`, `fail`. De bot vraagt uitsluitend `slots:deliver`; hij beheert geen boekerslijsten of willekeurige ontvangers. De commandactorvertrouwensgrens blijft gedocumenteerd.

De gebruiker bevestigt de merge van PR #99, maar migratie en DEV-deploy zijn nog niet bevestigd. Bestaande actieve botclient volgens de overdracht: `besc-discord-tickets-dev`. Actuele scopes/expiry/config zijn niet live door deze botchat teruggelezen.

## Verzoek voor de CC-chat — eerst voorbereiding en readback

1. Controleer read-only de exacte DEV-commit/image, health en de migratiestatus van `20261014213254_event_slot_bookings.sql`. Bevestig ook mail/schedulerwerking en HTTPS-site-origin zonder geheimen te tonen.
2. Inspecteer de actuele `besc-discord-tickets-dev` client via de bestaande beveiligde configuratieroute. Behoud client-ID, bestaande sleutel/hash, expiry, organisatie `999b6af9-479c-4082-b9d8-fa0a78aefac5`, guild `1067893182387474432`, bestaande lees-/ticketscopes, overige clients, instellingen en image. Toon uitsluitend veilige status, clientlabel, binding en scopenamen.
3. Bereid een minimale toevoeging van **alleen `slots:deliver`** aan deze bestaande client voor. Geen beheerrechten, nieuwe key, scopeverwijdering, verlopen sleutel ongemerkt verlengen of andere client toevoegen. Activeer nog niets; laat de gebruiker de concrete wijziging afzonderlijk goedkeuren.
4. Behoud e-mail als standaard en `BESC_SLOT_DISCORD_NOTIFICATIONS_ENABLED` uit. Bereid een afgeschermde DEV-test voor gekoppeld account, DM-weigering en ontkoppeling voor. CC-flag en bot-opt-in zijn verschillende schakelaars. Activering gebeurt pas na aparte toestemming, review en bevestigde CC-migratie/deploy + mailwerking.
5. Bevestig de veilige beheerprocedure voor `uncertain`: de huidige CC-implementatie accepteert alleen een eerste `sent` vóór leaseverloop, of exact dezelfde reeds verwerkte `sent`. De bot bewaart een onopgeloste message-ID en verstuurt nooit opnieuw. Er is geen inspect/reconcile-route in dit contract. Richt handmatig herstel vooraf in of lever een afzonderlijk gereviewde contractuitbreiding; deze bot-PR verzint geen endpoint en wijzigt de CC-database niet.

## Grenzen

Deze overdracht is voorbereiding, geen toestemming voor clientwijziging, migratie, deploy, featureflag, Discord/MEE6-effect of databaseherstel. Eventuele acties daarna moeten apart worden goedgekeurd en gevolgd door veilige readback. Bestaande organisatiefilters, serverbinding en actuele Discordidentitychecks blijven gelden. Alleen aantoonbare `dm_closed` of CC-ontkoppeling mag automatische e-mailterugval veroorzaken; een onzekere DM vereist eerst onderzoek op reference. Ticketretentie van 180 dagen blijft los van slotboekingen.

Bronnen: CC `src/lib/event-slot-bot-api.ts`, migratie `20261014213254_event_slot_bookings.sql`, definitief `API-CONTRACT.md` en gedeelde `API-FIXTURES.json`. Het concrete testplan staat in `docs/SLOT-DEV-ACCEPTANCE.md` van de bot-PR.
