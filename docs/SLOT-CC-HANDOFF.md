# Afzonderlijke CC-overdracht — slotworker

## Context en bevestigde feiten

De botworker is lokaal gebouwd tegen CC PR #99 / main `d7022f659dac52dce7743e4887265c24a9c80de2`, het definitieve release-99-contract en de gedeelde fixtures. De vier POST-routes zijn `slot-messages/claim`, `dispatch`, `sent`, `fail`. De bot vraagt uitsluitend `slots:deliver`; hij beheert geen boekerslijsten of willekeurige ontvangers. De commandactorvertrouwensgrens blijft gedocumenteerd.

De gebruiker bevestigt PR #99 en #100 gemerged en gedeployd op DEV, de succesvolle migratie, mailverwerking elke minuut en live verificatie/ontvangst/voorlopige agenda/eigenaarmelding/goedkeuring/annulering met mail. Geannuleerde boekingen verdwijnen uit agenda/PDF; historie blijft behouden. CC-main is gecontroleerd op `739d72a58eb1662a0e03d6fc81e1e9cc60cca831`; PR #100 wijzigt het slotcontract niet. Deze botchat heeft de live server/database niet zelf geïnspecteerd. Bestaande actieve botclient volgens de overdracht: `besc-discord-tickets-dev`. Actuele scopes/expiry/config zijn niet live door deze botchat teruggelezen.

## Verzoek voor de CC-chat — eerst voorbereiding en readback

1. Neem de hierboven bevestigde DEV- en mailacceptatie over; voer migratie, deploy en schedulerinrichting niet opnieuw uit vanwege deze overdracht. Leg bij de latere Discordacceptatie de dan actieve image/health vast en behoud bestaande mailconfiguratie/HTTPS-origin.
2. Inspecteer de actuele `besc-discord-tickets-dev` client via de bestaande beveiligde configuratieroute. Behoud client-ID, bestaande sleutel/hash, expiry, organisatie `999b6af9-479c-4082-b9d8-fa0a78aefac5`, guild `1067893182387474432`, bestaande lees-/ticketscopes, overige clients, instellingen en image. Toon uitsluitend veilige status, clientlabel, binding en scopenamen.
3. Bereid een minimale toevoeging van **alleen `slots:deliver`** aan deze bestaande client voor. Geen beheerrechten, nieuwe key, scopeverwijdering, verlopen sleutel ongemerkt verlengen of andere client toevoegen. Activeer nog niets; laat de gebruiker de concrete wijziging afzonderlijk goedkeuren.
4. Behoud e-mail als standaard en `BESC_SLOT_DISCORD_NOTIFICATIONS_ENABLED` uit. Bereid een afgeschermde DEV-test voor gekoppeld account, DM-weigering en ontkoppeling voor. CC-flag en bot-opt-in zijn verschillende schakelaars. Activering gebeurt pas na aparte toestemming, review en bevestigde CC-migratie/deploy + mailwerking.
5. Bevestig de veilige beheerprocedure voor `uncertain`: de huidige CC-implementatie accepteert alleen een eerste `sent` vóór leaseverloop, of exact dezelfde reeds verwerkte `sent`. De bot bewaart een onopgeloste message-ID en verstuurt nooit opnieuw. Er is geen inspect/reconcile-route in dit contract. Richt handmatig herstel vooraf in of lever een afzonderlijk gereviewde contractuitbreiding; deze bot-PR verzint geen endpoint en wijzigt de CC-database niet.

## Grenzen

Deze overdracht is voorbereiding, geen toestemming voor clientwijziging, migratie, deploy, featureflag, Discord/MEE6-effect of databaseherstel. Eventuele acties daarna moeten apart worden goedgekeurd en gevolgd door veilige readback. Bestaande organisatiefilters, serverbinding en actuele Discordidentitychecks blijven gelden. Alleen aantoonbare `dm_closed` of CC-ontkoppeling mag automatische e-mailterugval veroorzaken; een onzekere DM vereist eerst onderzoek op reference. Ticketretentie van 180 dagen blijft los van slotboekingen.

Bronnen: CC `src/lib/event-slot-bot-api.ts`, migratie `20261014213254_event_slot_bookings.sql`, definitief `API-CONTRACT.md` en gedeelde `API-FIXTURES.json`. Het concrete testplan staat in `docs/SLOT-DEV-ACCEPTANCE.md`; de exacte minimale configuratiewijzigingen staan in `docs/SLOT-CONFIGURATION.md`. Niets daarvan is nu toegepast.
