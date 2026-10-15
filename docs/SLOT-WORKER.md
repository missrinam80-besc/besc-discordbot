# Discordworker voor eventtijdslots en boekingen

## Bron en grens

Gebouwd vanaf bot-main `14b8e0890ef8e606fd2af77c4d76c70330308214`, tegen CC-main `d7022f659dac52dce7743e4887265c24a9c80de2` (PR #99). Definitieve bron: de aangeleverde release-99 `API-CONTRACT.md` / `API-FIXTURES.json`, gecontroleerd tegen `src/lib/event-slot-bot-api.ts` en migratie `20261014213254_event_slot_bookings.sql` op die CC-commit. De gedeelde fixture staat ongewijzigd in `tests/fixtures/event-slot-bookings.json` en is uitsluitend synthetisch. Deze Ticketing V2-reviewbranch (PR #3) bevat inmiddels ook main met de slotworker uit PR #4. Beide functies houden hun eigen opt-in, scopecontrole en journalbestanden.

Bij afronding opnieuw gecontroleerd tegen CC-main `739d72a58eb1662a0e03d6fc81e1e9cc60cca831` (PR #100): de slot-API, migratie en gedeelde fixtures zijn sinds PR #99 ongewijzigd. De gebruiker bevestigt PR #99/#100 gedeployd op DEV, de migratie, minuutplanning van mail en live mailacceptatie inclusief annulering. Dit zijn gebruikersbevestigingen; deze botchat heeft geen server- of database-inspectie uitgevoerd. Deze wijziging voert geen migratie, clientwijziging, merge, imagepublicatie, deploy, paneelpublicatie of Discord/MEE6-actie uit.

E-mail blijft standaard. De bot heeft een afzonderlijke lokale opt-in `BESC_SLOT_WORKER_ENABLED=false`; de CC-flag `BESC_SLOT_DISCORD_NOTIFICATIONS_ENABLED` blijft uitsluitend CC-configuratie. Alleen wanneer de bot-opt-in expliciet aanstaat, vereist opstart de scope `slots:deliver` en een absoluut `BESC_BOT_STATE_DIR` op duurzame opslag. Scope ontbreekt: geen Discordlogin en geen claim. Worker uit: geen slotrequests, geen journal en geen DM; de bestaande runtime blijft werken.

## Protocol en externe effecten

Alle vier POST-routes gebruiken de bestaande, vaste CC-origin, Bearer-authenticatie, geconfigureerde `guild_id`, JSON en een begrensde body van maximaal 8 KiB. De worker kiest geen organisatie, account, ontvanger of tekst en stuurt geen commandactor mee. CC controleert de actuele boekingsidentity bij claim én dispatch. De bestaande command-API vertrouwt de bot om de echte actor uit `interaction.user.id` door te geven; deze vertrouwensgrens blijft behouden. CC vertrouwt ook het externe verzendresultaat van deze worker.

1. Claim hoogstens één bericht met een duurzaam worker-ID (37 toegestane tekens). Poll elke 15 seconden, zonder overlappende pogingen.
2. Schrijf een minimale claim naar het journal. Controleer lease en één volledig renderbaar bericht, zonder tekst af te kappen of op te splitsen.
3. Schrijf een dispatch-intent en sync die naar schijf vóór de dispatchaanvraag. Alleen een werkelijk `{ok:true}` geeft toestemming voor Discord.
4. Na bevestigde dispatch: open de DM voor uitsluitend het CC-ID, controleer DM-type en ontvanger, verstuur één embed met onveranderde titel/tekst en zichtbaar `BESC-SLOT-…` in de footer. `allowed_mentions.parse/users/roles` zijn leeg en `replied_user=false`.
5. Bewaar het bewezen Discord-message-ID duurzaam vóór `sent`. Bij verloren `sent`-antwoord wordt alleen exact dezelfde bevestiging hervat, met dezelfde worker, lease en message-ID. Geen nieuwe DM of nieuwe claim zolang deze poging onopgelost is.

De eigen Discord-HTTP-sender gebruikt de vaste Discord API v10, HTTPS, `redirect:error`, maximaal 64 KiB per antwoord en een gedeelde deadline van maximaal 20 seconden inclusief responsebodies, via een echt AbortSignal. Geen automatische netwerk-/5xx-/429-herhaling of lange rate-limit-wachtrij. Iedere send heeft een deterministische nonce met `enforce_nonce`; dit is slechts extra bescherming, geen basis voor opnieuw verzenden. CC-verzoeken gebruiken de bestaande transportdeadline van 8 seconden, eveneens inclusief responsebody. Bij begin van dispatch resteert minimaal 40 seconden van de twee-minutenlease; vóór Discord en na DM-openen wordt de resterende tijd opnieuw gecontroleerd.

Discordgrenzen: één embed, titel maximaal 256, body maximaal 4096, totaal maximaal 6000 tekens. Ongeschikte inhoud blijft vóór dispatch zonder Discordeffect en wordt als `discord_unavailable` aan CC gemeld. CC beheert retryplanning; de bot wijzigt of verkort de tekst niet.

Officiële Discordreferenties: [Create Message / mentions / nonce / embedgrenzen](https://docs.discord.com/developers/resources/message#create-message), [Create DM](https://docs.discord.com/developers/resources/user#create-dm), [foutcodes](https://docs.discord.com/developers/topics/opcodes-and-status-codes#json).

## Fouten en e-mailterugval

| Situatie | Gedrag |
| --- | --- |
| Claim leeg / ongeldig / onbevoegd | Geen dispatch of Discordactie; begrensde fout zonder inhoud/token loggen. |
| Niet renderbaar / te korte lease vóór dispatch | `fail:discord_unavailable`; CC mag veilig opnieuw plannen. |
| Dispatch `409 recipient_no_longer_linked` | Geen DM. CC heeft terugval naar e-mail verzorgd. |
| Verloren of onduidelijk dispatchantwoord | Geen enkele Discordactie, geen nieuwe claim, bewijs behouden. Lease laten verlopen en CC-wachtrij onderzoeken. |
| Aantoonbare Discordweigering HTTP 403 + JSON-code 50007 | `fail:dm_closed`; CC zet het bericht terug naar de e-mailwachtrij. |
| Andere Discordweigering, 429 of 5xx | `fail:discord_unavailable`; na dispatch is dit onzeker, geen blinde herhaling of geforceerde e-mail. |
| Netwerkverlies / onvolledig antwoord / onbekende verzenduitkomst | `fail:outcome_unknown`; bewijs behouden, handmatige controle op reference. |
| Succesvolle DM, verloren `sent` | Journal bevat message-ID; alleen `sent` hervatten. |
| `fail`-antwoord verloren | Alleen dezelfde foutmelding hervatten; nooit de DM herhalen. CC maakt alleen `sent` expliciet idempotent, dus een reeds verwerkte `fail` kan controle vereisen. |
| Schrijffout journal | Fail closed. Geen dispatch vóór duurzame intent, geen herhaling na onzekere opslag van het verzendresultaat. |

De bot verstuurt zelf geen e-mail en kiest nooit een alternatief account. Onzekere uitkomsten worden niet als gesloten DM voorgesteld. Ticketrechten, status/account/events, organisatiefilters, serverbinding en bestaande identitycontroles zijn behouden. Ticketretentie van 180 dagen wordt niet op boekingen of het slotjournal toegepast.

## Duurzame opslag en herstel

Compose mount een named volume op `/app/state`; de image maakt die map aan voor de bestaande niet-rootgebruiker `node` (0700). De container blijft read-only, zonder publieke poorten of extra rechten. Stoptermijn 60 seconden: een actieve slotpoging wordt eerst afgerond voordat de proceslock wordt vrijgegeven. Eén botinstantie per volume; een tweede schrijver wordt geweigerd.

Het journal is gebonden aan CC-origin, guild, applicatie en client-ID. Het bevat maximaal één actieve poging, lease, status en eventueel Discord-message-ID/foutcode; geen ontvanger, tekst, e-mailadres, API-key of bot-token. Updates gebruiken tijdelijke file, file-fsync, atomic rename en op Linux directory-fsync; bestanden zijn 0600. Windows-tests bewijzen atomische vervanging en heropenen; directory-fsync is alleen in Linux beschikbaar. Een succesvol bevestigde `sent` of e-mailfallback ruimt de actieve lokale poging op. Onopgeloste pogingen worden nooit automatisch gewist. Daardoor blijft de opslag begrensd, maar blokkeert één onzeker bericht deze worker totdat het gecontroleerd is. Bestaande commando's/tickets blijven draaien.

Bij herstel:

1. Normale herstart: dezelfde volume behouden. `sent` hervat uitsluitend de bevestiging. Een achtergebleven `claimed` zonder dispatch-intent wordt veilig vrijgegeven; een `dispatching`/`uncertain` wordt nooit verstuurd.
2. Hard stop/crash: de `.lock` blijft bewust staan. Stop alle instanties en bevestig dat geen schrijver actief is. Maak een beveiligde kopie van het journal. Alleen de bijbehorende lege `.lock` mag daarna door de operator worden verwijderd; journal en volume behouden. Geen automatische stale-lock-verwijdering op basis van een klok of container-PID.
3. Controleer de CC-wachtrij en het Discordbericht op de exacte reference. Bewaar eventuele message-ID en beslis met de CC-beheerder of de wachtrij handmatig hersteld moet worden. Geen nieuw bericht, alternatieve ontvanger of e-mail forceren zolang de uitkomst niet vaststaat.
4. **Contractgrens:** CC accepteert dezelfde `sent` opnieuw wanneer die al verwerkt is, maar weigert een eerste `sent` na verlopen lease / `uncertain`. De worker bewaart het bewijs en blijft uitsluitend bevestigen; dit vraagt CC-reconciliatie. De huidige vier routes hebben geen inspect- of herstelendpoint. Deze PR claimt daarom geen automatisch herstel na iedere crash of onbeperkt late bevestiging.
5. Na bewijs en gecontroleerd CC-herstel kan een operator de betreffende lokale actieve poging afronden, met beveiligde backup en dubbele-verzendcontrole. Dit is een afzonderlijke operationele handeling, geen automatische resetfunctie van de worker.

Verander de client-ID of verwijder/vervang het volume niet om een vastgelopen poging te omzeilen. Bij sleutelrotatie voor dezelfde client blijft het journal bruikbaar; scope- of clientwijzigingen worden hier niet uitgevoerd.

## Verificatie

`npm run check`, `npm test`, `npm run build`. De suite gebruikt de gedeelde CC-fixture, echte lokale HTTP voor protocol/annulering en gesimuleerde Discordantwoorden voor weigeringen, verloren responses en deadlines. Hersteltests heropenen het echte bestandsjournal en controleren dat geen tweede send ontstaat. CI controleert daarnaast Docker/Compose en twee opeenvolgende niet-root/read-only containers met hetzelfde journalvolume. Dit bewijst geen live migratie, Gmailfallback, Discordaflevering of huidige scopeconfiguratie.

Zie [DEV-acceptatieplan](SLOT-DEV-ACCEPTANCE.md), [exacte aanvullende configuratie](SLOT-CONFIGURATION.md) en [afzonderlijke CC-overdracht](SLOT-CC-HANDOFF.md).
