# Ticketing V2 runtime

Deze botuitbreiding voert het definitieve CC-contract `cc-ticketing-v2-1` uit. De canonieke contracten en fixtures zijn exact overgenomen uit Command Center-main op `fac133d0972e4085004ebdd6745108288b7c3665`. De statusregels in die CC-contractsnapshot zijn historisch; de gebruiker heeft PR 93/94, migraties en DEV-pagina’s als uitgevoerd bevestigd. Deze botbranch is nog niet live geaccepteerd.

## Wat verandert

- `/besc ticket openen` toont bij ingeschakelde V2 gepubliceerde tickettypes in een privékeuzelijst, met pagina’s boven 25 types.
- De panelen gebruiken klassieke embeds en een keuzelijst. Na typekeuze krijgt de aanvrager privé uitleg en de knop Formulier invullen.
- De modal gebruikt moderne Label-componenten voor korte/lange tekst en single/multi-keuzes. Maximaal vijf vragen; geen extra verborgen onderwerpvraag.
- Intent en intake gebruiken de echte interaction-ID als duurzame CC-idempotencykey. Retries gebruiken exact dezelfde actor, editie en payload. CC registreert atomisch ticket, snapshot en opdrachten.
- Oude intents houden hun eigen editie. Bij lokale cacheverliezen wordt die editie opgehaald en een nieuwe knopinteraction gevraagd; een modal wordt niet na een defer getoond.
- Runtimeversie, features en maximaal 50 GuildText-kanalen worden als metadata gerapporteerd. Geen leden-/rollenlijst, gesprekken of tokens in dit rapport. Kanaal- en beheerbewijs worden afzonderlijk via geautoriseerde controleopdrachten bevestigd.
- De aparte configworker doet claim, inspect, complete en fail. Hij inspecteert vlak vóór send/edit en houdt intrekking, leases en reconciliatie aan. Geen nieuwe config-kinds in de ticketwachtrij.
- Geen teammodule, automatische toewijzing, afbeeldingen, media, Moderation, Administrator of ManageRoles. CC-botbeheer verleent geen ticketleesrechten.

De bestaande commanddefinitie blijft gelijk. Deze branch registreert niets automatisch. Status/account/events, eigen-ticketinzage, gesprek, interne-notitieprivacy, gesloten-statusbeleid en de inhoudloze 180-dagen-delete-opdracht blijven behouden.

## Expliciete inschakeling

V2 staat standaard uit (`BESC_TICKETING_V2=false`). De huidige client moet alle bestaande lees-/ticketrechten behouden en daarnaast `bot-config:read`, `bot-config:report`, `bot-config:deliver` hebben. Die drie scopes zijn niet in deze taak live geverifieerd of gewijzigd.

Later, na review en afzonderlijke toestemming, gebruikt de serverconfiguratie:

```dotenv
BESC_TICKETING_V2=true
BESC_BOT_STATE_DIR=/app/state
```

Het bestaande `DISCORD_TICKET_PARENT_CHANNEL_ID` blijft het oorspronkelijke legacykanaal. Het wordt niet door een nieuw paneelkanaal overschreven. Ontbrekende configuratiescopes pauzeren V2 en loggen uitsluitend `v2_configuration_scopes_missing`; de bestaande lees- en V1-ticketfuncties blijven draaien. Een onleesbaar/corrupt register pauzeert V2 met `v2_state_unavailable`, zonder het register stil te wissen.

## Duurzaam register en oude threads

Compose voegt het volume `bot-state:/app/state` toe. De image maakt de mountdirectory vooraf met eigenaar `node`; de container blijft non-root en de rest van de filesystem read-only. Het register bevat alleen geautoriseerde parent-IDs en tijdelijke delivery/message/hash/marker-metadata. Geen token, API-key, vraagtekst of antwoorden.

Parents worden geleerd uit gevalideerde CC-configuratie, oude toegestane formulieredities en geauthenticeerde ticketdeliveries. Ze blijven na een conceptwijziging en herstart bekend. Live events uit een eerder onbekende historische parent worden alleen toegelaten als de thread bot-owned is en CC de exacte ticket/threadbinding voor die aanvrager bevestigt. Er wordt geen guildbrede berichtgeschiedenis gescand. CC blijft bij elke ingest de opgeslagen org/client/guild/thread/parent controleren.

Eén botproces gebruikt het volume. Neem de state-volume mee in de serverback-up en behoud hem bij imagewissels; gebruik geen `docker compose down -v`. Herstel een beschadigde historische parentlijst uit een gecontroleerde back-up, niet door algemene serveruitlezing. Zonder dat register kunnen live geverifieerde threads opnieuw worden geleerd; volledige backfill van niet-actieve onbekende parents is dan niet bewezen.

Een paneeleffect wordt vóór de complete-ack met zijn messagebinding geregistreerd. Het record verdwijnt pas na een geaccepteerde CC-complete. Herstel controleert ook de bot-auteur, kanaal, marker en exacte publicatie-inhoud in Discord. Verloren send/edit-responses kunnen daardoor zonder tweede paneel worden bevestigd.

## Grenzen van herstel

De historiezoekopdracht is begrensd tot 50 pagina’s van 100 berichten en de lease-deadline. Onvolledige historie of meerdere markers wordt `uncertain`, nooit bewijs van afwezigheid. Een onzekere eerste plaatsing zonder aangetroffen effect wordt niet blind opnieuw verstuurd. Herstel vraagt dan een medewerker om de concrete delivery en het kanaal te onderzoeken. Alleen na gecontroleerde afwezigheid of een gevonden effect mag de CC-herstelactie worden gebruikt.

Intrekking verhindert een nieuwe plaatsing of wijziging. Een al aantoonbaar voltooid effect kan na een verloren response worden bevestigd; een overgeslagen mapped update bevat de oorspronkelijke message-ID. Een paneeluitschakeling behoudt zijn marker en zet de interacties disabled. Een verdwenen paneel kan zonder nieuw Discordbericht als disabled bevestigd worden.

Intake-idempotency is duurzaam in CC. De bot houdt geen ingevulde antwoorden op disk. Als na een crash de submitresponse én de oude gebruikte editie niet meer opvraagbaar zijn, ontstaat geen nieuw ticket als automatische fallback; een medewerker controleert eerst het bestaande ticket. Herstel is niet geclaimd als algemene exactly-once-garantie voor alle netwerkvensters.

## Validatie en rollout

De nieuwe tests gebruiken de canonieke CC-fixtures, gesimuleerde Discordobjecten, een lokaal HTTP-serverscenario en een tijdelijke filesystem-journal. Dat bewijst de botprotocolwerking, niet de live DEV-autorisatie of Discordpermissions. Geen echte credentials of Discordlogin worden gebruikt.

Zie [DEV-acceptatie](DEV-ACCEPTATIE-V2.md) en [scope-overdracht](CC-CONFIGSCOPES-V2.md). Docker/image/volume/Compose-controles lopen daarnaast in CI. Geen merge, imagepublicatie, deploy, clientwijziging, panelpublicatie of MEE6-wijziging hoort bij deze branchvoorbereiding.

Bronnen voor de Discordmechanismen: [interactions](https://docs.discord.com/developers/interactions/receiving-and-responding), [componenten](https://docs.discord.com/developers/components/reference), [message nonce](https://docs.discord.com/developers/resources/message). De gebruikte discord.js-versie blijft gepind op 14.27.0.
