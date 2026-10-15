# DEV acceptatieplan voor ticketing V2

De reviewbranch is op 15 oktober bijgewerkt tegen bot-main `26b7762` met de slotworker. `BESC_TICKETING_V2` en `BESC_SLOT_WORKER_ENABLED` blijven onafhankelijke schakelaars, standaard uit. Beide gebruiken `BESC_BOT_STATE_DIR=/app/state` met gescheiden journalbestanden. Behoud de volume bij updates. V2 heeft de drie configuratiescopes nodig; de slotworker heeft afzonderlijk `slots:deliver` nodig. Geen van deze scopes wordt door deze branchupdate verleend.

Voer bij een latere gezamenlijke acceptatie ook het [slotacceptatieplan](SLOT-DEV-ACCEPTANCE.md) uit. Eerst met beide nieuwe functies uit de bestaande commands/tickets bewijzen; vervolgens iedere uitbreiding afzonderlijk activeren en pas daarna samen. Controleer dat panelherstel en slot-sent-herstel elkaar niet beïnvloeden. Scopeactivering, publicatie en echte DM's vereisen nog steeds afzonderlijke toestemming.

Dit plan wordt pas uitgevoerd na afzonderlijke toestemming voor merge, imagepublicatie, scope-inlezen, botdeploy en benoemde Discordtests. Niets uit dit plan is als live V2-resultaat gerapporteerd. Testserver `1067893182387474432`; aparte botserver `104.248.194.147`; geen productie of MEE6.

## Voorwaarden en begincontrole

De bot-PR en CI zijn gereviewd. CC-main bevat het definitieve schema-2-contract; de gebruiker heeft PR 93/94 en migraties als uitgevoerd bevestigd. Verifieer de werkelijk gedeployde CC-versie voordat de proef begint. De actuele ticketclient behoudt alle oude velden/scopes en heeft de afzonderlijk geverifieerde drie configuratiescopes. Een botbeheerder en ticketmedewerker hebben hun eigen juiste capabilities; een beheer-only account heeft geen ticketleesrecht.

Bewaar de huidige geteste botdigest, volledige server-env en Compose-instelling als rollbackmateriaal op de server zonder secrets te loggen. Pin de nieuwe geteste digest; behoud het legacy parent-ID. Neem het state-volume op in de back-up. Slechts één botinstantie. Bestaande Discord-intents en kanaalrechten blijven gelden; het openbare paneel heeft ook SendMessages/EmbedLinks nodig. Wijzig rechten alleen na concrete testinrichtingstoestemming.

## Uitvoering en bewijs

| Stap | Actie | Geslaagd als |
| --- | --- | --- |
| 1 | Nieuwe image starten met V2-opt-in en state-volume na toestemming. | Bot verbonden; runtime 2.0.0 en drie features bevestigd in CC; actuele kanaalmetadata, geen secrets in logs. |
| 2 | `/besc status`, account, events en een bestaand ticket controleren. | Zelfde beperkte toegang, geen leesregressie of actoroverride. |
| 3 | Installatie-/beheerbewijs en kanaalcontroles aanvragen in CC. | Actor/application/guild kloppen; alle effectieve rechten gecontroleerd; ontbrekende rechten als concrete fout. Geen paneel wordt hierdoor gepubliceerd. |
| 4 | Drie disposable types met tekst/single/multi-vragen als concept opslaan. Namen beginnen met TEST. | Concept zichtbaar in CC, geen nieuw Discordbericht en geen ticket. Nog geen goedkeuring voor publicatie veronderstellen. |
| 5 | Type wijzigen en formulierpreview gebruiken zonder Publiceren. | Discord blijft hetzelfde; versieconflict bij een verouderde bewerking. |
| 6 | Na toestemming één TEST-paneel publiceren op het gekozen intakekanaal. | Eén bot-owned bericht; CC toont Afgeleverd met correcte editie/link; geen mentions. |
| 7 | Alle drie types via paneel en één via `/besc ticket openen` gebruiken. | Privé type-uitleg, correct formulier, actor uit interaction, juiste answersnapshot in CC en precies één privéthread per intake. |
| 8 | Iedereen-type met ongekoppelde gebruiker testen; gekoppeld-only type met dezelfde gebruiker proberen. | Iedereen-intake lukt; linked-type weigert. Account/events-toegang wordt niet verruimd. |
| 9 | Oud formulier openen; vanuit CC dezelfde vraag wijzigen en een nieuwe editie publiceren; oud formulier inzenden binnen 30 min. | Oude vraag-ID/labels/antwoorden blijven coherent en worden met de oude snapshot geregistreerd; nieuwe aanvragen krijgen de nieuwe editie. |
| 10 | Formulier openen en type/paneel daarna uitschakelen; formulier inzenden. | Geen nieuw ticket/thread; duidelijke privéweigering; lopende andere tickets blijven behandelbaar. |
| 11 | Formulier laten verlopen of bot herstarten vóór de formulierknop. | Verlopen intent geweigerd; bij cacheverlies oude toegestane editie opnieuw geladen en pas een nieuwe knopinteraction opent modal. |
| 12 | Bestaand paneel bijwerken en de bot tijdens een TEST-publicatie gecontroleerd herstarten. | Na leaseverloop inspect/reconcile; geen tweede paneel. Bewezen effect kan compleet worden bevestigd; onzekerheid zonder bewijs blijft zichtbaar en wordt niet blind herhaald. |
| 13 | Gecontroleerde responseverliesproef op disposable testworker/paneel na toestemming, gericht op complete-ack. | Zelfde nonce/marker/hash/lease; één effect, nieuwe complete via reconcile. Gebruik geen algemene firewalling of keywijziging. De lokale HTTP-/Discordfixtures leveren vooraf dit foutinjectiebewijs. Als live foutinjectie niet verantwoord beschikbaar is, rapporteer dit scenario als alleen lokaal getest. |
| 14 | Intake replay met dezelfde modal-submit-ID/payload via gecontroleerde fixture; bij live verbinding botrestart na inzending. | CC geeft hetzelfde ticket bij dezelfde key; geen dubbele thread. Een tweede key op verbruikte intent wordt geweigerd. Geen automatische nieuwe intent als herstel. |
| 15 | Nieuw parentkanaal in een disposable type instellen; oude thread blijven gebruiken; bot herstarten. | Oude thread importeert via oorspronkelijke parent en CC-own-binding; geen algemene serverhistorie-scan. State-volume behouden. |
| 16 | Intern noteren, extern antwoorden, aanvrager antwoorden en sluiten. | Interne notitie blijft in CC; extern bericht arriveert; sluiten wordt Afgeleverd en de thread locked/archived. Gewone gebruiker kan niet heropenen. |
| 17 | Gecontroleerde disposable retentionfixture volgens de al geaccepteerde CC-procedure. | Ticket, intakeantwoorden, labelsnapshot en intents verdwijnen op de bewaartermijn; inhoudloze delete_thread wordt door de bot uitgevoerd, inclusief oude parent. Geen echte tickets vervroegd verwijderen. |
| 18 | Beheer-only versus ticketmedewerker testen. | Botbeheer geeft geen ticketinzage; ticketmedewerker zonder botrecht kan geen publicatie/instelling wijzigen. |

Leg per stap het gebruikte TEST-ticket/paneel-ID, actorcategorie, expected/actual, CC-leveringsstatus, threadstatus en veilige bewijsverwijzing vast. Geen secrets, volledige intake-inhoud of privégesprekken in algemene logs. Een snapshot van de beheerpagina is geen bewijs van een Discordeffect.

## Fouten, rollback en afronding

Bij dubbele marker, ontbrekend paneel of onvolledige historie: geen nieuwe publicatie forceren; onderzoek de concrete CC-delivery en bot-owned berichten. Bij een verdwenen gatewayverbinding opnieuw verbinden en vaste keys/markers behouden. Bij journalfouten de bestaande volume herstellen; niet leegmaken om de fout te verbergen.

Bij rollback eerst nieuwe V2-intake/panelen gecontroleerd pauzeren. Bestaande tickets en hun dossiers blijven staan. Een oude V1-image kent alleen het legacy parentkanaal; gebruik die niet als volledige rollback voor reeds gecreëerde tickets in andere parents. Houd de nieuwe runtime beschikbaar voor gesprekken, sluiten en verwijderen of rond die tickets eerst af. Een scope-intrekking is geen noodzakelijke rollback en wordt niet automatisch gedaan.

Afronding vereist concrete positieve uitkomsten van de live stappen en expliciete benoeming van eventueel alleen lokale crash/foutinjectietests. De huidige bot-PR, lokale suite of CC-paginacontrole geldt niet als volledige live V2-acceptatie.
