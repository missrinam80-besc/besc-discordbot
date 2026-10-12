# BESC ticketing schema 2 — definitief CC-contract v1

Status: lokale CC-implementatie, draft PR; geen migratie, deployment, keywijziging of Discordeffect uitgevoerd. De botruntime wordt afzonderlijk tegen dit contract gebouwd. Canonieke voorbeelden: `ticketing-v2.fixtures.json` in dezelfde map. Alle voorbeeldinhoud is TESTFIXTURE — NIET PUBLICEREN.

## Gecorrigeerde scope

Geen teammodule, automatische teamkoppeling, mediabibliotheek of afbeeldingen. Toewijzing gebruikt de bestaande bevoegde `manageTickets`-medewerkers. Embeds hebben uitsluitend `title`, `description`, `color` (#RRGGBB) en `footer`. Geen `imageUrl`, `team`, `teamId` of `mediaAssetId`; zulke requestvelden worden geweigerd.

Beheer: `/app/beheer/discordbot`, capability `manageDiscordBot`, standaard Admin/Bestuur en expliciet toegekende bestaande organisatieprofielen. Behandelrechten blijven `manageTickets`. Botbeheer geeft geen ticketleesrecht of rollenbeheer. Alle webmutaties gebruiken actuele sessie, actieve membership, organisatie en een databasecontrole. Concepten hebben versies; verouderde updates leveren `version_conflict`.

## Client- en actorgrens

Gebruik bestaande Bearer-clientauthenticatie: sleutelhash, expiry/revocation en één org/guildbinding. Organisatie/client/guild komen uit serverconfiguratie. Geen wildcardguild, botadmin, serverbrede ledenlijst of vrije Discordopdrachten. Configuratierechten zijn `bot-config:read`, `bot-config:report`, `bot-config:deliver`; deze worden niet automatisch aan de actieve sleutel toegevoegd.

CC vertrouwt de beperkte bot om de echte Discordcommandactor en guilddeelname uit de interaction door te geven. Dit is geen cryptografisch bewijs per interaction. Voor `linked`-toelating valideert CC de actuele Auth-Discordidentity, verbanning en actieve organisatiemembership; een bewerkbaar profiel of oude naam verleent geen toegang. De actuele type-instelling kan toelating beperken, ook voor een reeds geopende oude editie.

## Routes

| Route | Methode | Scope | Request |
| --- | --- | --- | --- |
| ticket-config | GET | bot-config:read | Alleen `guild_id` |
| ticket-config/revisions/{uuid} | GET | bot-config:read | Alleen `guild_id` |
| bot-runtime/report | POST | bot-config:report | guild_id, application_id, installed=true, runtime_version, features, channels |
| bot-config-deliveries/claim | POST | bot-config:deliver | guild_id, worker_id |
| bot-config-deliveries/{uuid} | GET | bot-config:deliver | guild_id, worker_id, lease_token; actuele uitvoerbaarheid controleren |
| bot-config-deliveries/{uuid}/complete | POST | bot-config:deliver | Discriminated result hieronder |
| bot-config-deliveries/{uuid}/fail | POST | bot-config:deliver | guild_id, worker_id, lease_token, error_code, uncertain |
| ticket-intents | POST | tickets:create | Intentrequest hieronder |
| tickets/intake | POST | tickets:create | guild_id, discord_user_id, type_revision_id, intake_intent_id, answers |

Alle POSTs zijn JSON met maximaal 131072 bytes, ook chunked; bodydeadline 3 seconden en volledige upstreamdeadline 5 seconden met annulering. Geen extra queryvelden/duplicaten of bodyvelden. Configresponse maximaal 2 MiB. Responses zijn `no-store`. Fouten: `{error:{code,requestId}}`; upstreamouten tonen geen interne data. Envelopes/veldnamen staan exact in de fixtures.

## Runtime en installatie

`features` is een unieke subset van `typed_intake`, `ticket_panels`, `label_modals`. `channels` bevat maximaal 50 gewone tekstkanalen `{id,name,type:0}` van dezelfde guild, geen rollen/leden of ticketinhoud. Dit rapport is geen bewijs van de rechten van een beheerder of kanaal. CC legt het tijdstip vast; meldingen ouder dan 5 minuten worden als verouderd behandeld.

Legacy serverbindingen worden uit bestaande tickets geïmporteerd. Hun application-ID wordt bewust niet verzonnen: een botbeheerder vult die in. Voor extra guilds is vooraf een apart geautoriseerd clientrecord nodig. Een installatie-URL verandert niets en bewijst geen installatie. `verify_server_admin` draagt de actuele, uit Auth afgeleide CC-Discordidentity. Alleen een leased resultaat voor die actor/application/guild bevestigt de botdeelname en Discord-beheermacht. Bij activering moeten identity en beheerbewijs bij dezelfde CC-gebruiker horen en maximaal 10 minuten oud zijn. Een geschikte runtime moet recent zijn.

Kanalen worden apart met `check_channel` geverifieerd. Publicatie vereist controles van paneelkanaal én type-threadkanalen van maximaal 10 minuten oud. Vereiste permissions: view_channel, send_messages, create_private_threads, send_messages_in_threads, read_message_history, manage_threads, embed_links. Geen Administrator, ManageRoles of ManageMessages.

## Concepten, edities en configuratie

Typeconcept: name (1–80), description (0–100), active, eligibility (`everyone`/`linked`), parentChannelId, formTitle (1–45), subjectQuestionId (tekstvraag-ID of null), sortOrder (0–9999), embed, questions (1–5).

Vraag: stabiele id (1–40, letters/cijfers/_/-), label (1–45), description (0–100), placeholder (0–100), required. `short`/`paragraph` hebben minLength en maxLength (0/1–4000, minimum ≤ maximum). `single`/`multi` hebben 1–25 unieke `{value,label}`-opties, maxValues ≤ optieaantal; single heeft maxValues=1. De keuzeantwoorden zijn altijd arrays, ook bij single. IDs blijven bij ordenen en labelwijzigingen gelijk.

Paneelconcept: name, channelId, 1–25 unieke typeIds en embed. Een embed heeft maximaal 6000 tekens totaal. Opslaan verandert geen Discordbericht. Publiceren toont eerst inhoud en doelkanaal; de bevestiging maakt immutable type- en paneelrevisies en een opdracht. Alleen een gecontroleerde complete zet de gepubliceerde messagebinding. Huidige configuratie bevat uitsluitend bevestigde, enabled panelen en actieve type-edities; nooit concepten, intakeantwoorden of credentials. Alleen toegestane edities worden teruggegeven: actuele publicatie of een nog open intent; ingetrokken of gepauzeerde intake wordt geweigerd.

Uitgeschakelde/gearchiveerde types weigeren nieuwe intake. Het geïmporteerde algemene legacytype behoudt everyone-toelating en oorspronkelijk parentkanaal, zodat de oude slashflow ondersteund blijft. Oudere tickets worden niet inhoudelijk herschreven; CC toont ze als historisch. Legacy `POST tickets` wordt niet versoepeld tot een schema-2-omweg.

## Intent en typed intake

Idempotency-Key is voor intent de echte broninteraction-ID, en voor intake de echte modal-submitinteraction-ID. Nieuwe interactions moeten recent zijn; oude broninteractions kunnen niet na cleanup hergebruikt worden.

Slashintent: guild_id, discord_user_id, type_revision_id, source=`slash`. Panelintent voegt source=`panel`, panel_id, panel_revision_id, channel_id, message_id toe. CC controleert de actuele paneelbinding en dat de type-editie bij dat paneel hoort. Het antwoord is `{intentId,expiresAt,typeRevisionId}`. Intent bindt actor/client/org/guild/revisie/bron, verloopt na 30 minuten, bevat geen antwoorden en kan eenmaal een ticket maken.

Intake: opgeslagen editie en intent moeten bij de actor horen. CC weigert onbekende vragen, ontbrekende verplichte antwoorden, verkeerde/duplicaatkeuzes en overschrijding. Een nog geldige oude formuliereditie blijft geldig na een nieuwe publicatie; actuele server/typeactivering, actuele strengere toelating en paneelintrekking worden opnieuw gecontroleerd.

Ticket, exacte type/vraag/keuzelabelsnapshot, genormaliseerde antwoorden, idempotencyresponse en bekende `create_thread`/`send_message`-opdrachten worden atomisch vastgelegd. De thread krijgt een korte ontvangstbevestiging; volledige intake staat alleen in CC en komt nooit in openbare panelen/configuratiehistoriek. Onderwerp is maximaal 160 tekens uit de aangewezen tekstvraag, anders de typenaam. Geen zesde onderwerpvraag. Replay met dezelfde key/payload geeft hetzelfde ticket; een andere key op een verbruikte intent geeft `intent_consumed`; payloadwijziging geeft `idempotency_conflict`.

## Configuratielevering

Deze wachtrij staat los van de ticketwachtrij. Claim geeft `{deliveries:[...]}`, maximaal vijf, één per paneel of servercontrole in vaste sequencevolgorde. Kinds: publish_panel, disable_panel, check_channel, verify_server_admin. Oude ticketdeliverykinds blijven create_thread/send_message/close_thread/delete_thread.

Elke configdelivery heeft id, kind, guildId, channelId/panelId/revisionId/messageId (nullable), payload, payloadHash, leaseToken, leasedUntil, nonce, marker, reconcile, withdrawn en allowedMentions `{parse:[]}`. PayloadHash is een opaque SHA-256 van de opgeslagen JSON; echo exact, niet zelf opnieuw serialiseren/hashen. Nonce is de stabiele decimal sequence (maximaal 20 tekens). Marker is de stabiele `besc-panel-{panelId}` (bij controles delivery-ID). Een publishpayload bevat embed, typeRevisionIds én volledige immutable typeRevisions; de worker hoeft geen ongepubliceerde editie uit een algemene configuratieroute te halen.

Vóór elk nieuw Discordeffect vraagt de worker de inspectroute op met de actuele lease. `withdrawn=true` verbiedt nieuwe plaatsing: alleen bestaande effecten reconciliëren. Is een reeds bestaand bericht niet bijgewerkt wegens intrekking, bevestig `skipped=true` met de oorspronkelijke message_id (of geen message_id wanneer er geen oorspronkelijke binding was). Dit wijzigt de actieve revisie niet. Als een eerste plaatsing aantoonbaar niet bestaat, bevestig publish_panel met message_absent=true in plaats van message_id (verder dezelfde kanaal/auteur/revisie/leasevelden). Een niet-ingetrokken publicatie kan niet als afwezig worden afgevinkt. De unavoidable race tussen laatste controle en Discord wordt veilig afgehandeld: een later bevestigd bericht op een inmiddels ingetrokken paneel krijgt een disable-opdracht; nieuwe intake blijft ondertussen geweigerd.

Lease is 60 seconden. Verlopen leases worden uncertain en opnieuw aangeboden met reconcile=true, dezelfde nonce/marker. Bij onzekerheid controleert de bot bestaande berichten op server, kanaal, bot-auteur en marker. Geen blind tweede bericht. Bij meerdere marker-matches: duplicate_marker en uncertain. Een bestaande message wordt alleen bewerkt na controle van volledige binding en bot-auteur. Geen mentions; klassieke embed, geen IS_COMPONENTS_V2.

Complete bevat altijd guild_id, worker_id, lease_token, application_id, payload_hash en kind. Per kind:

- verify_server_admin: discord_user_id, is_admin.
- check_channel: channel_id, channel_type=0, permissions_ok, missing_permissions (bij true leeg).
- publish_panel: channel_id, message_id, bot_author_id, revision_id.
- disable_panel: channel_id, message_id, bot_author_id, disabled=true.

Verkeerde worker/lease/guild/revisie/kanaal/auteur wordt geweigerd. Een late oude complete kan geen nieuwere publicatie terugzetten. Uitschakelen trekt intake onmiddellijk in; als een reeds geleasede publicatie nog bevestigt, volgt gecontroleerde disable. Bij kanaalverplaatsing: eerst buiten gebruik stellen en die disable laten bevestigen; daarna opnieuw publiceren op het nieuwe kanaal. De bot mag een ingetrokken opdracht niet blind uitvoeren; reconnect/leaseverlies vraagt reconciliatie.

Failcodes: discord_unavailable, permission_denied, message_missing, duplicate_marker, outcome_unknown, server_admin_denied. Geen vrije fouttekst/tokens/formulierantwoorden. Failed/uncertain blijft zichtbaar; herstel is expliciet en vraagt eerst controle.

## Bestaande tickets en retentie

Legacy en typed ticketopdrachten gebruiken de opgeslagen parentbinding. Ingest/complete laten een geldige andere parent uit hetzelfde bestaande ticket toe, maar de database controleert actual client/org/guild/thread/parent. Vrij opgegeven nieuwe intakekanalen worden niet vertrouwd. Bot scant uitsluitend opgeslagen ticketouders; een gewone guildmessage wordt nooit automatisch een ticket.

Snapshots en antwoorden staan op support_tickets en worden via de bestaande 180-dagen-purge verwijderd. Intents voor dat ticket worden eveneens gewist. De bestaande inhoudloze delete_thread-opdracht blijft herstelbaar. Verlopen ongebruikte intents worden door dezelfde bewaartaak opgeruimd; geen nieuwe Cloud-crontaak vereist.

## Overdracht en acceptatie

CC-migratie en DEV-deploy volgen pas na review. Alleen daarna een concreet behouden clientrecord met drie extra configuratiescopes inlezen; geen automatisch verruimen van de actieve key. Nieuwe runtime rapporteren, eigen installatie/kanalen controleren en vervolgens de testserver activeren. Extra guilds blijven concept.

De botchat implementeert onmiddellijke modalreactie/cacheverlies, panelinteractions, schema-2-ingest met opgeslagen parents, claim/complete/fail en reconcile tegen deze fixtures. Lokale CC-tests bewijzen geen live Discordpermission- of leveringscontrole. Live acceptatie omvat drie types, concept zonder Discordeffect, oude intent na nieuw formulier, uitschakeling, reprise zonder dubbel paneel/ticket, oude threads/retentie, ongekoppelde actor en scheiding van beheer- en behandelrechten.
