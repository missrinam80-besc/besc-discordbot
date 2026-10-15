# DEV-acceptatieplan — slotberichten

Dit is een uitvoerbaar plan voor **na afzonderlijke toestemming**; geen van onderstaande live handelingen is met deze PR uitgevoerd. E-mail blijft standaard en beide opt-ins blijven uit. Gebruik uitsluitend herkenbare `TESTFIXTURE — NIET PUBLICEREN`-boekingen en vooraf aangewezen testaccounts.

## Bevestigde uitgangssituatie en resterende voorbereiding

1. Reeds door de gebruiker bevestigd: CC PR #99/#100 gemerged en gedeployd op DEV; migratie geslaagd. CC-main `739d72a58eb1662a0e03d6fc81e1e9cc60cca831` wijzigt het contract van PR #99 niet. Deze botchat heeft de live omgeving niet zelf geïnspecteerd. Geen nieuwe migratie of CC-deploy nodig voor deze botcode.
2. Reeds door de gebruiker live bevestigd: Gmail-verwerking elke minuut; verificatie, ontvangst, voorlopige agenda, eigenaarmelding, goedkeuring en annulering met mail. Annulering verdwijnt uit agenda/PDF, boekingshistorie blijft. Behoud deze werking en voer tijdens Discordacceptatie alleen de gerichte fallback-/regressieproeven hieronder uit. Geen verificatiecodes, adressen of sleutels in rapport/chat. E-mail blijft standaard.
3. Review en merge van de bot-PR apart goedkeuren; daarna imagepublicatie en botdeploy op de aparte server `104.248.194.147` apart goedkeuren. Geen workflow-dispatch in deze oplevering. Volledige digest vastleggen en rollbackimage/config veilig bewaren.
4. Laat CC de actieve `besc-discord-tickets-dev` configuratie veilig teruglezen: organisatie `999b6af9-479c-4082-b9d8-fa0a78aefac5`, guild `1067893182387474432`, bestaande scopes/expiry/revocation. De bot-applicatie is `1558542661265129474`. Deel geen sleutel/hash/token. Voeg alleen na toestemming `slots:deliver` toe; bestaande scopes, client-ID, key, binding en overige clients behouden. Zie afzonderlijke overdracht.
5. Bewijs één botinstantie, duurzame schrijfbare `/app/state`-volume met niet-rootrechten, beveiligde backup en 60 seconden stoptermijn. Geen volume-reset of `down -v`. Inspecteer het journal alleen via beveiligde beheerkanalen: het bevat leasegegevens.
6. Bot-opt-in en de **aparte CC-flag** uitsluitend tijdelijk en afzonderlijk activeren voor afgesproken acceptatie. CC-flag is globaal, geen ingebouwde tester-allowlist: bepaal vooraf hoe de DEV-test afgeschermd wordt en dat alleen aangewezen testers de DM-keuze gebruiken. Geen productiepagina of echte boekingen gebruiken.

De minimale client- en botinstellingen staan exact in [SLOT-CONFIGURATION.md](SLOT-CONFIGURATION.md). Scope en beide opt-ins zijn nog niet geactiveerd.

## Testvolgorde en bewijs

| Proef | Concrete actie | Verwacht resultaat / vast te leggen bewijs |
| --- | --- | --- |
| Gates uit | Bot starten met worker uit; bestaande slashcommands en ticket afhandelen | Geen slotclaims/DM; status/account/events en ticketverkeer blijven werken. CC biedt geen DM-keuze zolang CC-flag uit staat. |
| Scope ontbreekt | Gecontroleerde start met bot-opt-in maar zonder nieuwe scope, eerst lokaal of in afgeschermde acceptatie | Start wordt vóór Discordlogin/claim geweigerd. Daarna bekende configuratie herstellen. Geen bestaande clientrechten verwijderen om dit te simuleren. |
| Goede DM | Gekoppeld testaccount met bevestigd overeenkomend e-mailadres kiest Discord voor een testsessie; verifieren, bevestigen, afwijzen/annuleren over aparte boekingen | Alleen CC-ontvanger; één DM per wachtrijbericht, juiste CC-tekst, zichtbaar reference; CC ziet message-ID en `sent`. Emailverificatie blijft het CC-protocol volgen. |
| Mentions | Testinhoud met `@everyone`, een gebruikers- en rolmention | Tekst blijft behouden, geen ping; payload bevat lege allowed mentions. |
| Ongekoppeld account | Testaccount zonder koppeling probeert DM-keuze; bestaande ongekoppelde `/besc account` en ticketintake testen | CC weigert DM-keuze / kiest e-mail volgens contract, geen zelf opgegeven Discord-ID. Ongekoppelde ticketaanvrager blijft toegestaan. |
| Ontkoppelen | Gecontroleerd testaccount ontkoppelen vóór claim, en apart tussen claim en dispatch | Geen DM; CC zet terug naar email. Bij dispatch `409 recipient_no_longer_linked`. Account daarna bewust herstellen. |
| Gesloten DM | Tester sluit bot-DMs en laat een testbericht ontstaan | Aantoonbaar 403/50007 → `dm_closed`; hetzelfde CC-bericht wordt door Gmail verwerkt. Geen andere foutcode als gesloten DM behandelen. |
| Dispatchantwoord kwijt | Via lokale fault-injectionproxy alleen het dispatchantwoord laten verdwijnen nadat CC het verwerkt heeft | Geen Discordactie, geen nieuwe claim; journal blijft `dispatching`; CC wordt na leaseverloop onzeker. Operator onderzoekt wachtrij/reference. Geen herstart om alsnog te sturen. |
| Discordantwoord kwijt | Eerst lokaal met gesimuleerde Discordresponse; alleen na aparte toestemming een gecontroleerde live verbinding onderbreken | Geen tweede DM, geen geforceerde e-mail. `outcome_unknown` en reference geven handmatige controle. |
| Sent-antwoord kwijt | Alleen `sent`-antwoord onderscheppen, binnen lease normaal herstarten met dezelfde volume | DM exact één keer; dezelfde worker/lease/message-ID wordt opnieuw bevestigd. Ook als CC de eerste ack al verwerkt had. |
| Late ack | Eerst lokaal lease laten verlopen vóór de eerste verwerkte `sent`; live alleen apart goedgekeurd | Geen nieuwe DM. Bewijs blijft staan; CC kan eerste late ack weigeren. Reconciliatie via CC-beheerder vereist, geen claim dat vier endpoints dit automatisch oplossen. |
| Herstart / harde crash | Normale herstart, daarna afzonderlijk gecontroleerde harde stop | Normaal: actieve poging afronden en journal heropenen. Hard: proceslock blokkeert nieuwe schrijver; operator controleert proces, bewaart journal, verwijdert alleen stale lock. Geen automatische reset. |
| CC / Discord uitval | Lokaal 401/403/429/503 en trage responsebody injecteren; DEV alleen afgeschermd | Geen dispatch zonder `ok:true`; geen verborgen retries; echte deadlines, geen inhoud/tokens in logs. |
| Bestaande threads | Bestaand ticket lezen, Discord→CC, extern CC→Discord, interne notitie, sluiten/vergrendelen en bestaande verwijderketen nalopen | Geen nieuwe thread of dubbele antwoorden, interne notitie uitsluitend CC; ticketretentie 180 dagen behouden. Slotberichten krijgen geen ticketretentie. |
| Annulering en historie | Testboeking met gekozen Discordkanaal annuleren en agenda/PDF/historie controleren | Annuleringsbericht volgens CC-queue, geen actief item in agenda/PDF; historie blijft behouden. E-mailfallback bij gesloten DM blijft werken. |
| Afronding | Beide nieuwe opt-ins terug uit zetten tenzij activering expliciet wordt goedgekeurd; journal behouden | E-mail blijft standaard, overige functionaliteit blijft werken; open onzekerheden expliciet vastleggen. |

API/fault-injectiontests draaien lokaal met synthetische fixtures; verstuur geen echte verificatiecodes of sleutels naar een publieke proxy. Een lokale simulatie wordt als lokaal gerapporteerd, niet als live acceptatie. Gebruik geen ongecontroleerde kill/replay op echte boekingen.

## Acceptatiebesluit en rollback

Leg per proef datum, image-digest/CC-commit, fixture-reference, resultaat, eventuele message-ID (beveiligd), aantal ontvangen DMs en geschoonde CC-status vast. Geen tokens, mailadressen, berichtinhoud of lease-token in het verslag. Bevestig positief én fallbackscenario, behoud bestaande tickets/commands en geen dubbele DM vóór ruimere activering.

Bij onzekere aflevering: pauzeer alleen deze worker via de bot-opt-in en zet de CC-DM-keuze uit. Bewaar volume/journal en controleer CC + Discord op reference. Zet niet zonder onderzoek een nieuwe instantie of nieuw client-ID in om de wachtrij te omzeilen. Herstel zo nodig de vorige geteste botimage met bestaande configuratie en behoud het volume. Terugdraaien wijzigt geen boekingen/migratie en verwijdert geen Discordberichten. Iedere verdere activering blijft een afzonderlijk besluit.
