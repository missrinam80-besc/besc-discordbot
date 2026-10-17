# Huidige DEV-status — 17 oktober 2026

[← Documentatie](README.md)

Gedateerde momentopname uit de gezamenlijke CC/botchat, aangeleverde servercontroles en Discordscreenshots. Geen automatische servermonitor of nieuwe serveruitlezing. Technische basis: bot-main `9050b2966c569ba19e5862eefe48da0ff01f4d0f` en CC-main `6db618aac85a5577c71e7b34f96bc023db9ae879`. De documentatie-update verandert geen runtime of API-fixtures.

## Laatst bevestigde inrichting

BESC Bucks en XP wordt afzonderlijk voorbereid in `codex/bucks-xp-v1`, tegen [CC-PR #107](https://github.com/missrinam80-besc/besc-commandcenter/pull/107). Dit is lokale ontwikkeling en review, geen nieuwe DEV-uitrol. De twee botvlaggen en de CC-verdienregels staan standaard uit. Zie [werking en grenzen](BUCKS-XP.md) en [tests](BUCKS-XP-TESTRESULTATEN.md).

| Onderdeel | Stand |
| --- | --- |
| Botserver | BESCSRVDEV-02 / `104.248.194.147`; werkmap `/opt/besc-discordbot`; aparte CC-server BESCSRVDEV. |
| Botcontainer | `besc-discordbot-dev-bot-1`; draait als node, verbonden met Discord. |
| Botimage | `ghcr.io/missrinam80-besc/besc-discordbot@sha256:c6b7bf440b9e2428751acb0851104d095f15c7f4a2f4e472e72a3fdc853e5100`. |
| Configuratie | `/etc/besc-discordbot/bot.env`, selectie via `deployment.env`; geen secrets in Git. |
| Ticketing V2 | `BESC_TICKETING_V2=true`. |
| Slotworker | `BESC_SLOT_WORKER_ENABLED=false`. |
| CC-Discordkeuze | `BESC_SLOT_DISCORD_NOTIFICATIONS_ENABLED=false` op CC, niet op botserver. |
| State | `BESC_BOT_STATE_DIR=/app/state`, duurzaam schrijfbaar Docker-volume, stoptermijn 60 seconden, één instantie. |
| API | CC-DEV `/api/v1/bot/`; geen directe databasetoegang. |
| Client | `besc-discord-tickets-dev`; laatst gecontroleerd actief, niet ingetrokken, geldig tot `2027-01-09T16:33:18Z`. Oudere leesclients ingetrokken. |
| Scopes | `identity:read`, `account:read`, `events:read`, vier ticket-scopes en `bot-config:read`, `bot-config:report`, `bot-config:deliver`, `slots:deliver`. |
| Binding | Organisatie `999b6af9-479c-4082-b9d8-fa0a78aefac5`, guild `1067893182387474432`, application `1558542661265129474`, legacy ticketparent `1558853872766689382`. |

De drie configuratiescopes en slotscope zijn veilig ingelezen met behoud van clientvelden en overige instellingen. De API vertrouwt deze beperkte bot om de echte commandactor uit de interaction door te geven; geen cryptografisch actorbewijs per API-aanvraag. Credentials nooit automatisch verlengen of een ingetrokken client reactiveren.

## Live door gebruiker bevestigd

### Tickets

- Status/account/events en bestaande V1-ticketflow werken.
- V2-types met tekst, enkelvoudige en meervoudige keuzes werken. Iedereen-intake laat toegestane ongekoppelde accounts toe; gekoppeld-only weigert ongekoppeld.
- Eén privéthread per normale intake; antwoorden in CC en het transcript in de privéthread; interne notities blijven uitsluitend in CC.
- Berichten in beide richtingen en sluiten/vergrendelen/archiveren werken.
- Afgebroken formulier maakt niets aan. Inzenden na paneeluitschakeling wordt geweigerd zonder ticket/thread.
- Oud formulier behoudt oude labels na herpublicatie; een nieuw formulier toont de nieuwe editie.
- Cacheverlies na restart vóór de formulierknop: eerste klik laadt de toegestane editie opnieuw, tweede klik opent het formulier; daarna één ticket/thread.
- Dropdownreset en dezelfde keuze opnieuw gebruiken werken na PR 7 en eenmalig vernieuwen van de bestaande Discordclientweergave. PR 6 alleen was onvoldoende.

### Slots, 16–17 oktober

- E-mailverificatie bleef vereist. Aanvraag, goedkeuring en annulering kwamen als afzonderlijke Discord-DM's aan.
- Bij geblokkeerde bot-DM's kwamen aanvraag, goedkeuring en annulering als e-mail aan. Dit bewijst de normale gesloten-DM-terugval, niet het exacte Discordfoutantwoord door onafhankelijke loginspectie.
- Annulering verdwijnt uit de eventagenda en geeft capaciteit vrij; historie blijft behouden.
- Na beide opt-ins uit: gebruiker bevestigde `/besc status`, `/besc account`, `/besc events`, Discord naar bestaand ticket in CC en extern CC-antwoord naar Discord.

De gebruiker bevestigde eerder dat de 180-dagenretentiejob actief en geslaagd is. Een echte V2-purge van antwoorden/snapshots/intents is niet afzonderlijk live bewezen; verwar de bewaartaakstatus niet met dat eindresultaat.

## Testvenster afgesloten

CC-keuze uit, daarna SELECT-wachtrijcontrole op `2026-10-17T12:14:13.218457Z`: 12 berichten sent, nul onafgeronde Discordberichten, geen aandachtregels of afkapping. Vervolgens bot-slotworker uit. Dezelfde image, overige instellingen, Ticketing V2 en duurzaam volume bleven behouden; botverbinding bevestigd. Backup: `bot.env.backup-stop-slotworker-20261017T121608581505Z` op botserver. CC bleef healthy en Caddy ongewijzigd.

De CC-testpagina van event `66a8aea6-1a86-49f9-922a-fdad16d8a986` is gesloten; twee geannuleerde testboekingen en historie zijn behouden. Geen verdere DM-activering door deze documentatie. De testbot deblokkeren is gevraagd, niet onafhankelijk bevestigd.

## Bekende oplossingen

- Lege/inactieve serverconfiguratie levert een stabiele geldige configuratierevisie; drie GET's zijn door botacceptatie bevestigd.
- Ontbrekende applicationbinding op het bestaande serverrecord is hersteld; geen tweede serverrecord. Runtime-report is daarna geslaagd.
- Fout bij formulierinzending kwam bij de onderzochte DEV-proef door ontbrekende `service_role`-USAGE op `private`; CC-migratie en hertest bevestigden herstel. De oude notitie over een nog onbekende modaloorzaak is historische diagnostiek.
- Verkeerde kanaalbinding in een eerdere check_channel-opdracht is gecontroleerd hersteld; een nieuwe verificatie is een mutatie en geen leescontrole.

## Niet live bewezen / bewust overgeslagen

Ticketformulier laten verlopen is door gebruiker overgeslagen. Aparte accounts voor beheer-only versus ticketmedewerker waren niet beschikbaar. Crash tijdens paneelpublicatie, antwoordverlies, exacte submitreplay, nieuwe parent met oude threads, V2-retentieverwijdering en lange Unicode-transcripten zijn niet apart live bewezen in deze ronde.

Bij slots: afwijzings-DM, mentions, ontkoppelen vóór/tussen claim en dispatch, harde crash, late ack en verloren dispatch/Discord/sent-antwoorden zijn niet afzonderlijk live bewezen. Lokale suites testen diverse van deze grenzen; dat is geen live effectbewijs. Er is geen productieacceptatie of toestemming voor brede activering.

Voor verdere proeven: gebruik herkenbare synthetische fixtures, geen echte ticketinhoud of credentials; beheer-only-tests verlenen geen nieuwe rechten zonder besluit. MEE6, botscope, organisatie-/guildgrenzen en API-only scheiding blijven gelden.
