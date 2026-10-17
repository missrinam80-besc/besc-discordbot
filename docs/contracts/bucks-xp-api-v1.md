# BESC Bucks en XP API contract versie 1

Dit contract volgt CC-PR #107, commit `43d05ba38eea43c4e8317293b7a1bd3a6b721abb`. De botimplementatie staat afzonderlijk in `codex/bucks-xp-v1`. De API bestaat naast ticketing, botbeheer en slotberichten; nieuwe scopes worden niet automatisch aan een live client toegevoegd.

## Authenticatie en grenzen

Basis: `/api/v1/bot/rewards`. Authenticatie blijft `Authorization: Bearer bb_<client-id>.<key>` via de bestaande CC-clientvalidatie: niet ingetrokken, niet verlopen en gebonden aan de organisatie en guild. Elk verzoek controleert de benodigde scope.

Persoonlijke acties vereisen de actuele Discord Auth-identity, een niet-geblokkeerd account en actief CC-lidmaatschap binnen de clientorganisatie. Organisatie en intern gebruikers-ID komen uitsluitend van CC. De bot is verantwoordelijk voor de echte Discord-commandactor; er is geen cryptografisch bewijs van de actor naast het vertrouwen in de client.

De API accepteert uitsluitend de hieronder beschreven velden. Alle responses hebben `Cache-Control: no-store`. POST vereist `application/json`, maximaal 8192 bytes en een body die binnen drie seconden is gelezen. De bestaande totale serverdeadline van vijf seconden annuleert ook echte upstream-aanvragen en responsebodies. De proceslimiet is 180 verzoeken per minuut per client; meerdere CC-replica's vereisen een gedeelde limiter voordat ze worden gebruikt.

CC vertrouwt de bot ook voor de feitelijke Discordactiviteit, deelnemerstelling en voice-status. CC vraagt Discord niet zelfstandig om bewijs van ieder bericht of iedere voiceminute. Dat vertrouwen is beperkt door client-/guildbinding, actuele accountcontrole, de geselecteerde kanalen, leeftijdsgrenzen, deduplicatie en de ingestelde quota.

## Routes en scopes

| Methode en route | Scope | Betekenis |
| --- | --- | --- |
| GET `/account` | `rewards:own:read` | Eigen XP, level, Bucks, reserveringen en maximaal 25 historiekregels. |
| GET `/catalog` | `rewards:own:read` | Maximaal 25 beschikbare beloningen, prijs, versie en beschikbare voorraad. |
| GET `/requests` | `rewards:own:read` | Maximaal 25 eigen aanvragen en hun beslissingen. |
| POST `/requests` | `rewards:own:write` | Een beloning aanvragen en Bucks reserveren. |
| POST `/requests/{uuid}/cancel` | `rewards:own:write` | Een eigen onbehandelde aanvraag annuleren en reservering vrijgeven. |
| GET `/config` | `rewards:activity:ingest` | Ingeschakelde verdienregels binnen de clientguild, zonder deelnemersgegevens. |
| POST `/activity` | `rewards:activity:ingest` | Eén tekstgebeurtenis of volledige geschikte voiceminute aanleveren. |

Er bestaan geen botroutes voor handmatige toekenningen, correcties, beloningbeheer of goedkeuringen. Botbeheer en ticketleesrechten geven geen Bucks-beheerrechten.

## Leesverzoeken

`account`, `catalog` en `requests` hebben queryparameters `guild_id`, `discord_user_id` en optioneel `offset`. `offset` is een decimaal geheel getal tussen 0 en 99975. Dubbele of onbekende parameters worden geweigerd. Elke response heeft `schemaVersion: 1` en `nextOffset: number | null`. Bij precies 25 regels kan de volgende pagina leeg zijn; daarop is `nextOffset` null.

`config` heeft alleen `guild_id`. Een Discordactor is voor deze technische configuratielezing niet vereist. Wanneer de serverflag uitstaat is het antwoord exact:

```json
{"schemaVersion":1,"enabled":false,"rules":[]}
```

Bij een ingeschakelde serverflag bevat `rules` uitsluitend regels met `enabled=true` voor de organisatie en guild van de client. Elk item heeft `organization_id`, `guild_id`, `kind`, `channel_ids`, `xp`, `bucks`, `cooldown_seconds`, `daily_xp`, `daily_bucks`, `enabled`, `version`, `voice_min_participants`, `exclude_muted`, `exclude_deafened` en `exclude_afk`. Een serverflag die aanstaat met nul regels levert nog geen automatische punten op.

## Schrijfverzoeken

Alle POST-routes gebruiken de volgende envelop. Ze hebben geen queryparameters:

```json
{
  "guild_id":"1067893182387474432",
  "discord_user_id":"111111111111111111",
  "idempotency_key":"1558853872766689382",
  "data":{"reward_id":"30000000-0000-4000-8000-000000000001","version":1}
}
```

Het voorbeeld bevat uitsluitend TESTFIXTURE-IDs. Een beloningsaanvraag gebruikt `data.reward_id` en de catalogusversie die aan de gebruiker is getoond. Een annulering gebruikt `data.version` van de aanvraag; `data.id` mag uitsluitend hetzelfde aanvraag-ID als in het pad bevatten en wordt door CC uit het pad bepaald. Laat `data.id` in de botrequest weg.

`idempotency_key` voor aanvragen en annuleringen is de echte Discord-interactie-ID, als string. De API bindt die aan guild en operatie in een stabiele Discordnamespace; clientrotatie mag geen tweede boeking veroorzaken. Voor webformulieren gebruikt CC een afzonderlijke namespace met een formulier-ID.

Een succesvolle aanvraag of annulering geeft HTTP 200:

```json
{
  "schemaVersion":1,
  "ok":true,
  "requestId":"40000000-0000-4000-8000-000000000001",
  "xpDelta":0,
  "bucksDelta":0,
  "reservedDelta":60
}
```

Bij annuleren is `reservedDelta` negatief. Dit antwoord bevestigt de boeking, niet de goedkeuring of levering. De actuele aanvraagstatus is op te vragen via GET `/requests`.

Eenzelfde sleutel met identieke actor, guild en gegevens retourneert dezelfde opgeslagen uitkomst. Gewijzigde inhoud geeft HTTP 409 `idempotency_conflict`. Ook afgewezen businessuitkomsten worden voor die sleutel vastgelegd. Actuele authenticatie en accountbevoegdheid worden voor elke replay opnieuw gecontroleerd.

Bij timeout, verbroken verbinding of HTTP 503 gebruikt de bot dezelfde sleutel en inhoud. Een andere sleutel gebruiken om een onzekere uitkomst te omzeilen is verboden. Bij `stale_version` toont de bot de actuele gegevens en laat een nieuwe bewuste interactie uitvoeren.

## Tekstactiviteit

`data` bevat alleen `kind: "text"`, `channel_id` en `occurred_at` (ISO 8601 met tijdzone). De sleutel is de echte Discord-bericht-ID. Het tijdstip moet binnen één seconde overeenkomen met de tijd uit de Discord-snowflake. Bewerkingen, bots, webhooks en DM's tellen niet mee; de bot filtert die gebeurtenissen voordat hij deze API aanroept. Berichtinhoud wordt niet aangeleverd of opgeslagen.

De gebeurtenis mag bij verwerking maximaal twee minuten oud zijn en maximaal vijf seconden in de toekomst liggen. CC controleert de kanaalselectie, actuele koppeling, wachttijd, daglimiet en regelstatus. De bot mag geen XP- of Bucks-bedrag kiezen.

## Voiceactiviteit

`data` bevat `kind: "voice"`, `channel_id`, `started_at`, `occurred_at`, `eligible_participants`, `muted`, `deafened` en `afk`. Tijdstippen zijn ISO 8601 met tijdzone; de laatste drie velden zijn booleans. Het aantal deelnemers is een geheel getal tussen 1 en 1000 en telt echte gebruikers, zonder bots.

Een interval duurt 60 tot 75 seconden en levert hoogstens één toekenning op. Het einde moet aan dezelfde ouderdomsgrenzen voldoen als tekstactiviteit. Intervallen van dezelfde persoon mogen binnen de guild niet overlappen, ook niet bij wisselen van kanaal of API-client. Langere sessies worden opgesplitst; een rest van minder dan 60 seconden levert geen toekenning op.

De bot bevestigt de geschiktheid gedurende het volledige interval. Een kanaalwissel, gewijzigde deelnemerstelling of wijziging van mute/deafen/AFK die de ingestelde criteria schendt, beëindigt de lopende geschikte minuut. Na herstart begint een nieuwe observatieperiode; de bot verzint geen retrospectieve voicetijd. Discords gatewaystatus bepaalt aanwezigheid en mute/deafen; hoorbaar spreken wordt niet gemeten.

De envelopsleutel mag een stabiele eigen sleutel van 8 tot 128 tekens zijn. CC gebruikt voor voice feitelijk de combinatie van guild, actor en eindtijd voor deduplicatie en slaat de inhoudshash op. Bij een retry blijven begin, einde en alle feiten identiek. De eindtijd wordt nooit opnieuw naar nu verplaatst.

## Quota en activering

XP en Bucks per tekstbericht of voiceminute, wachttijd en beide daglimieten worden apart per guild en activiteitstype ingesteld. Daglimieten gelden per lid volgens UTC en voor alle geselecteerde kanalen samen. De serverklok is leidend; correcties maken verdiende dagquota niet opnieuw beschikbaar. Bij het bereiken van een limiet kan de laatste toekenning kleiner zijn dan de gewone hoeveelheid.

Voor elke activiteit wordt dezelfde rekening vergrendeld, zodat tegelijk binnenkomende tekst- en voicetoekenningen en beloningsaanvragen geen saldo verliezen. De ledger legt de gebruikte regelversie vast. Regelwijzigingen herschrijven eerdere boekingen niet; nieuwe verwerking gebruikt de op dat moment geldende regel.

Op deze branch blijft `BESC_REWARDS_ACTIVITY_ENABLED=false` en slaat de CC-formulieractie regels met `enabled=false` op. De toekomstige botmodule en listeners moeten eveneens standaard uit staan. Een gatewaylistener, nieuwe gatewayintents of registratie van extra slashcommands worden pas afzonderlijk op DEV geactiveerd na review. MEE6-levels en eventuele imports worden niet stilzwijgend gewijzigd.

## Foutafhandeling

Fouten hebben de vorm `{"error":{"code":"...","requestId":"..."}}`. De routewrapper kan bij een vroegtijdige upstreamfout alleen `error.code` teruggeven. Toon gebruikers geen technische stacktrace of ruwe databasefout.

| HTTP | Codes en actie |
| --- | --- |
| 400 | `invalid_fields`, `invalid_query`, `invalid_offset`, `invalid_discord_id`, `invalid_event_id`, `invalid_body`: programmeer- of invoerfout; niet blind opnieuw proberen. |
| 401 | `invalid_client`: stop de workerfunctie, meld configuratieprobleem; niets reactiveren of verlengen. |
| 403 | `insufficient_scope`, `guild_not_allowed`, `membership_required`: geen toegang; scopes niet automatisch uitbreiden. |
| 404 | `account_unavailable`, `not_found`: geen bruikbaar gekoppeld account of onbekende route. |
| 405 | `method_not_allowed`: verkeerde methode. |
| 408 / 413 / 415 | `body_timeout`, `body_too_large`, `json_required`: request herstellen. |
| 409 | `activity_disabled`, `stale_version`, `idempotency_conflict`: automatisering pauzeren of actuele toestand tonen; geen onzekere opdracht met een nieuw ID herhalen. |
| 422 | `insufficient_bucks`, `out_of_stock`, `reward_unavailable`, `invalid_state`, `linked_membership_required`: een persoonlijke aanvraag is niet uitgevoerd. Activiteitscodes `cooldown`, `daily_limit`, `activity_expired`, `voice_ineligible`, `activity_disabled` tellen niet mee; niet opnieuw aanbieden met een nieuwe sleutel. |
| 429 | `rate_limited`: vertraag en probeer dezelfde opdracht later opnieuw. |
| 503 | `upstream_unavailable`: uitkomst kan onzeker zijn; herhaal met dezelfde sleutel. |

## Gedeelde voorbeelden en tests

Voorbeelden staan in [rewards-v1.json](../../tests/fixtures/rewards-v1.json). Ze bevatten geen echte leden of beloningen. De CC-tests vergelijken deze antwoorden met de daadwerkelijke API-projectie en controleren de velden van schrijfverzoeken. De voorbeeldtijdstippen zijn vast en zullen bij een echte activiteit als verlopen worden geweigerd; genereer voor een tijdgebonden lokale test een nieuw tijdstip en bij tekst een bijpassende snowflake.

De bot heeft leescommando's voor eigen saldo, catalogus en aanvragen en knoppen voor aanvragen/annuleren. Reacties met persoonlijke gegevens zijn uitsluitend privé zichtbaar. Activitylisteners gebruiken een duurzaam lokaal register met dezelfde sleutel en inhoud bij retries en verwerken alleen de ingestelde guild/kanalen. Nieuwe functies blijven uit totdat de afzonderlijke botwijziging is getest en beoordeeld.
