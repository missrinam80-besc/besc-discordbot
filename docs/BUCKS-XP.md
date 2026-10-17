# BESC Bucks en XP

[← Documentatie](README.md)

Leden met een actueel gekoppeld BESC-account kunnen hun saldo bekijken en een beloning aanvragen. Command Center beheert rekeningen, XP, levels, catalogus, voorraad, beslissingen en de boekingshistoriek. De bot gebruikt uitsluitend de beperkte HTTPS-API. Handmatige beloningen en correcties gebeuren in CC; de bot heeft daarvoor geen beheerroutes.

Deze module is voorbereid tegen [CC-PR #107](https://github.com/missrinam80-besc/besc-commandcenter/pull/107), commit `43d05ba38eea43c4e8317293b7a1bd3a6b721abb`. Beide wijzigingen vereisen afzonderlijke review. Er is geen live Bucks-acceptatie uitgevoerd en niets is geactiveerd. Twitch en Streamer.bot vallen buiten deze versie. MEE6-moderatie, rollen en bestaande levels worden niet aangepast of geïmporteerd.

## Privécommando’s

| Commando | Werking |
| --- | --- |
| `/besc bucks saldo` | Eigen beschikbare en gereserveerde Bucks, totaal, XP en level. |
| `/besc bucks beloningen` | Catalogus, 25 per pagina. Kies een beloning en bevestig expliciet het reserveren van Bucks. |
| `/besc bucks aanvragen` | Eigen aanvragen en beslissing. Een open aanvraag kan na bevestiging worden geannuleerd. |

Alle antwoorden zijn privé en onderdrukken mentions. Er is geen optie om een andere gebruiker als actor op te geven. Knoppen zijn gebonden aan de gebruiker en de ingestelde server en komen uit een bericht van de ingestelde applicatie. Ze verlopen na 30 minuten of een botrestart. Een oude prijs of versie kan geen stilzwijgende nieuwe aanvraag opleveren: CC weigert de gewijzigde versie, waarna de gebruiker de actuele lijst opnieuw opent.

Aanvragen reserveert Bucks; het keurt de beloning niet goed. De bevoegde medewerker beslist in CC. Annuleren kan alleen zolang CC de aanvraag nog als onbehandeld beschouwt. Huidige Discordkoppeling en actief organisatielidmaatschap worden bij ieder API-verzoek opnieuw gecontroleerd, ook bij herhalen na een timeout. Ticketintake voor ongekoppelde gebruikers verleent geen toegang tot Bucks.

## Afzonderlijke schakelaars en scopes

| Locatie | Instelling | Standaard |
| --- | --- | --- |
| Bot | `BESC_REWARDS_ENABLED` | `false`; geen Bucks-register, commandoafhandeling of rewards-API-verzoeken. |
| Bot | `BESC_REWARDS_ACTIVITY_ENABLED` | `false`; geen activiteitlisteners, nieuwe voice-intent of configuratiepolling. Vereist de eerste vlag. |
| CC | `BESC_REWARDS_ACTIVITY_ENABLED` | `false`; activiteitconfiguratie is leeg en nieuwe toekenningen zijn geblokkeerd. |
| CC | Verdienregels per guild en activiteitstype | Uitgeschakeld; geen verzonnen tarieven, kanalen of beloningen. De eerste CC-beheerflow slaat regels uitgeschakeld op. |

De persoonlijke module vereist `rewards:own:read` en `rewards:own:write`. Automatisch verdienen vereist daarnaast `rewards:activity:ingest`. De bot voegt geen scopes toe aan een client en verlengt of reactiveert geen credential. Ontbrekende scopes of een onbruikbaar register schakelen de nieuwe module uit; bestaande tickets blijven hun eigen instellingen gebruiken.

De optionele commanddefinitie wordt alleen meegenomen als `BESC_REWARDS_ENABLED=true` bij de bestaande commandpreview/registratie. Containerstart registreert niets. Live scopes, registratie en instellingen zijn in deze wijziging niet aangepast.

## Tekst en voice

Tekstactiviteit gebruikt uitsluitend bericht-ID, actor, guild, kanaal en tijdstip. Botberichten, webhooks, systeemberichten, DM’s, edits en niet geselecteerde kanalen tellen niet mee. De bot bewaart of verstuurt hiervoor geen berichtinhoud. CC bepaalt punten, wachttijd en UTC-daglimieten en controleert de huidige accountkoppeling. Ongekoppelde gebruikers krijgen geen toekenning.

Voice telt volledige waargenomen intervallen van 60 tot 75 seconden. Deelnemers zijn bekende echte gebruikers; bots en onbekende leden tellen niet mee voor het minimum. De ingestelde uitsluiting van mute, deafen en AFK geldt gedurende het volledige interval. Het minimumaantal deelnemers en eventuele mute/deafen/AFK gedurende het interval worden conservatief doorgegeven. De bot meet aanwezigheid, geen hoorbaar spreken en geen audio.

Een kanaalwissel of ongeschikte status onderbreekt de minuut. Na reconnect, restart, verouderde configuratie, onzekere gatewaystatus of een gemiste observatieperiode begint de meting opnieuw. Er worden geen ontbrekende minuten achteraf aangemaakt. Configuratie wordt iedere minuut opgehaald en maximaal 90 seconden vertrouwd. Een regelwijziging start een nieuwe observatieperiode.

Alleen automatische activiteit voegt `GuildVoiceStates` en, waar nodig, `GuildMessages` toe. Dat vereist geen nieuwe `MessageContent`- of `GuildMembers`-intent. De bestaande ticketingintents blijven behouden. Zie [Discord Gateway](https://docs.discord.com/developers/events/gateway) en [discord.js VoiceState](https://discord.js.org/docs/packages/discord.js/14.27.0/VoiceState:Class).

CC vertrouwt de geauthenticeerde bot voor de echte actor en waargenomen gatewayfeiten. Die feiten zijn geen apart door Discord ondertekend bewijs. De bot kiest nooit een XP- of Bucks-bedrag. Alleen CC mag de organisatie, interne gebruiker en uiteindelijke toekenning bepalen.

## Duurzame verwerking en herstel

`BESC_BOT_STATE_DIR` moet een absoluut pad op de bestaande duurzame `/app/state`-volume zijn. Bucks gebruikt eigen `rewards-*.json`-bestanden; ticket- en slotjournals blijven apart. Eén instantie mag het register openen. Het register wordt atomair geschreven en vóór een API-mutatie naar schijf gesynchroniseerd. De container blijft als `node` draaien met een verder alleen-lezen bestandssysteem.

Een aanvraag of annulering gebruikt de echte interactie-ID; tekst gebruikt de echte bericht-ID. Voice bewaart begin, einde en feiten. Bij verloren antwoorden, timeout of restart blijven sleutel en inhoud identiek. Een nieuwe sleutel maken om een onzekere uitkomst te omzeilen is niet toegestaan. De bot meldt pas succes na een geldige CC-bevestiging. Een onzekere persoonlijke actie blokkeert een tweede persoonlijke mutatie van dezelfde actor totdat ze is opgelost.

De worker verstuurt maximaal één operatie tegelijk, met minstens 500 ms tussen starts. Er zijn maximaal acht pogingen met vertraging; HTTP 429 wacht minstens een minuut. Businessweigeringen worden vastgelegd zonder nieuwe sleutel. `invalid_client`, `insufficient_scope` of `guild_not_allowed` pauzeert alleen de Bucks-worker. Een inhoudsconflict, blijvende onzekerheid of beschadigd register vraagt handmatige controle.

Verdwijnt de accountkoppeling na een onzekere eerdere verzending, dan blijft de actie voor controle geblokkeerd. Die toegangsweigering bewijst niet dat de eerste boeking mislukte: CC controleert toegang voordat het de eerdere ontvangst opzoekt.

Een activiteit die nog nooit is aangeboden en ouder is dan twee minuten vervalt. Een eerder aangeboden onzekere activiteit behoudt haar oorspronkelijke feiten om een eventuele CC-ontvangst te kunnen herkennen. Na uitschakelen van de activiteitworker worden activiteitsrecords niet meer verstuurd; open records moeten daarom eerst worden gecontroleerd.

Bij een harde processtop kan een `.lock` blijven staan. Bij clientrotatie verhindert onopgelost werk onder een eerdere binding dat een nieuw register die opdrachten stilzwijgend achterlaat. Verwijder of vervang geen journal of lock als standaard herstelactie. Controleer eerst dat de oude instantie gestopt is, bewaar een afgeschermde kopie, vergelijk de oorspronkelijke opdracht met de CC-boekingsuitkomst en bereid een gecontroleerde herneming met dezelfde identiteit voor. Een beschadigd bestand blijft behouden. Er is geen automatisch reset- of migratiecommando dat onzeker werk overslaat.

Het register bevat alleen technische IDs, operatie, minimale feiten, pogingen en uitkomst; geen sleutel, token, interactietoken, e-mail, berichtinhoud of audio. Er zijn hoogstens 1000 records en 256 openstaande/aandachtrecords. Bevestigde en definitief geweigerde records kunnen na zeven dagen of bij ruimtegebrek worden opgeruimd; onzekere records niet. Bewaar het register afgeschermd en deel geen volledige bestanden in chat of Git.

## Latere DEV-acceptatie

Dit zijn voorwaarden voor een apart goedgekeurde proef, geen opdracht om nu te deployen.

1. Review CC en bot apart. Voer daarna pas de CC-migratie en beide deployments uit met hun eigen goedkeuring. Nieuwe flags blijven uit.
2. Controleer de actuele beperkte client, organisatie/guild/applicatie, geldigheid en duurzame state. Voeg uitsluitend na akkoord de benodigde rewardsscopes toe.
3. Activeer eerst alleen de privécommando’s, registreer de nieuwe definitie bewust en gebruik fictieve catalogusitems. Controleer actorkoppeling, reservering, goedkeuren/afwijzen, annuleren, voorraad en herhaling na verloren antwoord.
4. Automatisch verdienen blijft voorlopig uit zoals afgesproken. Een latere proef vereist gekozen tarieven, kanalen, limieten, expliciete activering van de CC-regels en beide activiteitvlaggen. Controleer tekstfilters, mute/deafen/AFK, reconnect en dagquota met testaccounts.
5. Voor gecontroleerd stoppen: schakel eerst de CC-regels uit terwijl de CC-activiteitroute bereikbaar blijft, laat de bot lege configuratie ophalen en controleer/drain open opdrachten met dezelfde IDs. Zet daarna de botactiviteit uit en als laatste de globale CC-activiteitvlag. Controleer afzonderlijk dat ticketing en de bestaande slotinstellingen behouden zijn.

**Termius botserver:** BESCSRVDEV-02, `/opt/besc-discordbot`. **Termius CC-server:** BESCSRVDEV, `/opt/besc-dev/command-center`. Migraties horen in de **DEV Supabase SQL Editor**, geen van beide Termius-sessies. Deze versie voert op geen van deze doelen iets uit.

Het [API-contract](contracts/bucks-xp-api-v1.md) en de [gedeelde voorbeelden](../tests/fixtures/rewards-v1.json) leggen de velden en foutafhandeling vast. [Testresultaten](BUCKS-XP-TESTRESULTATEN.md) onderscheiden lokale en CI-controles van nog uit te voeren live proeven.
