# Lokale validatie ticketing V2

## Bijgewerkt tegen main op 15 oktober 2026

PR #3 is samengevoegd met bot-main `26b7762f9a005ba87e4a0a419aad95eebdbbf537` (slotworker PR #4). Dit is een update van de bestaande reviewbranch, geen merge van PR #3 naar main. Conflicten in runtime, configuratie, foutcodes en documentatie zijn gecombineerd met behoud van beide functies. Dubbele volume- en mapaanmaakregels zijn verwijderd. Eén duurzame volume bevat afzonderlijke journals; beide opt-ins blijven standaard uit.

Typecontrole, productiebuild en **197 tests slagen**, zonder skips: 68 bestaande tests, 66 V2-tests, 56 slotworkertests en 7 combinatieproeven. De combinatieproeven behandelen alle vier schakelaarcombinaties, absolute duurzame opslag, afzonderlijke kanaalvereisten, gelijktijdig bewaren/heropenen en behoud van slot-verzendbewijs bij beschadigde V2-state. De slotworker blijft uitsluitend na bevestigde dispatch sturen; herstel herhaalt geen DM. Ticketcontexten, actorgrens, interne-notitieprivacy en 180-dagenketen blijven behouden.

De bijgewerkte CI controleert ook beide opslagpaden, Docker/Compose, niet-rootgebruik en een read-only container. Zie PR #3 voor de definitieve CI op de nieuwe head. Geen imagepublicatie, deploy, scopewijziging, paneelpublicatie of Discord/MEE6-actie uitgevoerd. De oudere resultaten hieronder blijven als historische verificatie bewaard.

## Oorspronkelijke V2-validatie

Gecontroleerd op 12 oktober 2026. Botbasis `14b8e0890ef8e606fd2af77c4d76c70330308214`; CC-contractbasis `fac133d0972e4085004ebdd6745108288b7c3665`. Beide main-commits zijn tijdens deze taak opnieuw gecontroleerd. Contractversie `cc-ticketing-v2-1`; Node 24.14.0; discord.js 14.27.0; TypeScript 5.9.3.

| Controle | Resultaat |
| --- | --- |
| `npm run check` | Geslaagd |
| `npm test` | 134 geslaagd, 0 mislukt, 0 overgeslagen |
| Bestaande regressies | Alle 68 oorspronkelijke tests behouden en geslaagd |
| Nieuwe V2-tests | 66 tests voor contract, formulieren, queue, HTTP-retry, parentcontext en journal |
| `npm run build` | Geslaagd |
| Docker/image/volume/Compose | In CI; geen lokale Dockerinstallatie beschikbaar. Definitieve CI-status wordt bij de PR vermeld. |

De nieuwe tests omvatten exacte CC-requestfixtures, inspectbinding, opaque payloadhash, begrensde body/configresponse, moderne modalrendering, field-ID/opties/labelsnapshots, replaykeys, cacheverlies, verlopen intent, intrekking, ongekoppelde gebruiker, beperkte installatiemetadata, actuele kanaalrechten, leaseverlies, duplicate markers, responseverlies na send/edit/complete, disable-replay, journalrestart en oude parentcontext voor ingest/close/delete. De lokale HTTP-proef registreert één synthetisch effect per key ondanks verloren responses; echte CC-databasetransacties zijn daarbij niet getest.

De tests gebruiken geen echte credentials, Discordlogin, DEV-request, keywijziging, paneelpublicatie of databasemutatie. De bestaande door de gebruiker geaccepteerde V1/retentionflow is behouden; live V2-acceptatie volgt het afzonderlijke plan. Configuratiescopes zijn nog niet live bevestigd als actief.

De productieruntime behoudt de API-only actorgrens: CC vertrouwt de bot voor de echte Discordactor en controleert de org/guild/type/intentbinding. Geen teammodule, toewijzingsautomatisering, afbeeldingen of media. MEE6 blijft behouden.
