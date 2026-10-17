# BESC ticketing op DEV

> Dit beschrijft de V1-transportbasis. V2 is inmiddels actief op DEV; gebruik [V2](TICKETING-V2.md) en de [actuele status](HUIDIGE-DEV-STATUS.md) voor inrichting en bewijs. Oude eerste-uitrolstappen hieronder niet blind herhalen.

Deze botuitbreiding gebruikt het definitieve CC-contract `besc-ticketing-v1` uit PR #88. Zonder `DISCORD_TICKET_PARENT_CHANNEL_ID` blijven uitsluitend de bestaande leescommando's actief. Met deze instelling moeten alle vier ticket-scopes aanwezig zijn en moet de clientidentiteit `readOnly: false` zijn.

## Bevestigde inrichting

- Organisatie `999b6af9-479c-4082-b9d8-fa0a78aefac5`.
- Testserver `1067893182387474432` en botapplicatie `1558542661265129474`.
- Intakekanaal `#maak-een-ticket`, ID `1558853872766689382`, gekozen door de gebruiker. De normale privéthreadflow is door de gebruiker live bevestigd; dit is geen automatische actuele rechtencontrole.
- Bot blijft op aparte server `104.248.194.147`.
- Iedereen op de testserver mag intake doen. Staff behandelt in Command Center; ongekoppelde aanvragers krijgen geen CC-membership of eventrechten.

## Discord instellingen

Geef de bot alleen in dit kanaal: Kanalen bekijken, Privéthreads creëren, Berichten sturen in threads, Berichtgeschiedenis lezen, Threads beheren en Embedded links. Embedded links is nodig voor ticketantwoorden tot 4000 tekens als één embed. De aanvrager moet het parentkanaal kunnen zien en in threads kunnen spreken. Openbare berichten en zelfstandig threads maken zijn voor aanvragers niet nodig. Geef de bot geen Administrator of rolbeheer.

Zet voor deze bot onder Developer Portal, Bot, Privileged Gateway Intents **Server Members Intent** en **Message Content Intent** aan. Eventuele vereiste Discordgoedkeuring moet eerst rond zijn. De implementatie gebruikt Guilds, GuildMessages, MessageContent en GuildMembers. GuildMembers is nodig voor de volledige deelnemerslijst van privéthreads; onvolledige lijsten zijn geen privacybewijs.

De bot maakt privéthreads met een neutrale marker `besc-ticket-{UUID}`, `invitable=false`, en voegt alleen de aanvrager toe. Discordmoderators met Threads beheren kunnen privéthreads ook zien. Onverwachte expliciete threaddeelnemers blokkeren verwerking.

## Client en serverconfiguratie

Behoud lees-scopes `identity:read`, `account:read`, `events:read` en voeg toe: `tickets:create`, `tickets:own:read`, `tickets:ingest`, `tickets:deliver`. Stel in CC `ticketParentChannelId` in op `1558853872766689382`. Gebruik een stabiele client-ID; de API draagt bestaande tickets en deliveryqueues niet automatisch over naar een andere ID.

Voeg op de botserver aan het geheime env-bestand toe:

```dotenv
DISCORD_TICKET_PARENT_CHANNEL_ID=1558853872766689382
```

Dit is geen nieuwe botsleutel. De bestaande zes basisvelden blijven nodig. Deel bot- en API-tokens niet in de chat en kopieer geen oude lokale env-bestanden naar de server.

Publiceer eerst een geteste image van deze branch. Daarna configureert de CC-chat de ticketclient en volgt een gecontroleerde botomschakeling. De reeds draaiende leesbot versie 0.1 accepteert alleen `readOnly: true`; verruim daarom niet stilzwijgend de actieve client vóór de nieuwe image beschikbaar is. Gecontroleerde omschakeling kan een korte onderbreking vereisen.

Na instellen van de nieuwe image en client registreert de operator de vernieuwde `/besc`-definitie op alleen de testserver. Gebruik vanuit een broncheckout met veilige env-injectie `npm run commands:register`; registratie gebruikt de optionele kanaalinstelling. Het runtime-image bevat bewust geen broncode of env-bestand. Alle andere commands/applicaties blijven behouden.

## Bediening

`/besc ticket openen` toont een formulier. De modalinzending wordt direct privé bevestigd, waarna de bot live serverdeelname en parentkanaalrechten controleert. CC ontvangt de echte actor en de modalinteraction-ID als vaste idempotencykey. Een onzeker API-antwoord wordt eenmaal met dezelfde key herhaald.

De privébevestiging bevat het ticket-ID. `/besc ticket bekijken nummer:{UUID}` levert alleen de eigen status en threadlink. De eerste threadboodschap en CC-antwoorden zijn aparte geordende opdrachten. Antwoorden tot 4000 tekens worden als één embed gestuurd, met vaste nonce en zonder mentions.

Gewone aanvragerberichten worden geïmporteerd; interne CC-notities blijven in CC. Bijlagen en latere edits/deletions van Discordberichten worden niet gespiegeld. De intakebevestiging vermeldt die beperking. Lege of alleen bijlagen bevattende berichten worden niet als geslaagde import geboekt.

Naast live events haalt de bot eenmaal per minuut oudere berichten op, verdeeld over maximaal drie threads en acht imports per thread per ronde. Hij gebruikt bronmessage-IDs voor replay, en cursorwaarden alleen in geheugen; na herstart controleert hij opnieuw de geschiedenis. De serverlimieten kunnen import vertragen. Een geschiedenis boven 5000 berichten per scan wordt als herstelprobleem gemeld, zonder stil berichten over te slaan.

CC bepaalt ticketstatus. Discord-autoarchivering sluit geen ticket. Bij sluiten vergrendelt en archiveert de bot de thread. Een CC-bewaaropdracht verwijdert de thread. De 180-dagenbewaarregel vereist ook de afzonderlijke CC-bewaartaak; deze bot activeert geen CC-scheduler.

## Herstel en grenzen

De worker claimt iedere vijf seconden opdrachten en gebruikt serverleases. Discordrequests hebben een achtsecondenbudget en geen automatische REST-retries; rate limits leiden tot veilige foutafhandeling, niet tot een onbegrensde wachtrij die na het verlopen van een lease schrijft. Vóór mutaties wordt de lease opnieuw gecontroleerd.

Een verloren complete-antwoord veroorzaakt geen nieuwe Discordactie. Herstel zoekt actieve en gearchiveerde privéthreads met dezelfde marker en vergelijkt kanaal, bot-eigenaarschap en deelnemers. Dubbele markers worden geweigerd. Uitgaande berichtreplay vereist een bestaande nonce plus overeenkomende inhoud in de geschiedenis.

Als een onzekere creatie of verzending geen aantoonbaar resultaat heeft, blijft zij `uncertain`. De bot herhaalt deze actie niet blind, ook niet na de CC-herstelknop. Een medewerker moet de situatie onderzoeken; een onzekere intake kan zo nodig worden gesloten en als nieuw ticket opnieuw worden ingediend. Absolute exact-eenmaalgaranties tussen CC en Discord worden niet geclaimd.

## Lokale controle en live acceptatie

Lokale tests gebruiken synthetische fixtures en Discordinterfaces. Ze toetsen de HTTP-client tegen de definitieve CC-fixtures, privacybinding, modalacknowledgement, idempotencykeys, verloren acknowledgements, verlopen leases, thread- en berichtreconciliation, deelnemercontrole, sluiten en verwijderen. Typecontrole en productiebuild worden afzonderlijk uitgevoerd.

Nog live te controleren: kanaaltype/rechten, beide privileged intents, API-clientconfiguratie, commandregistratie, Discordnoncegedrag, reconnect/backfill en de volledige flow met gekoppelde én ongekoppelde aanvragers. Controleer ook een tweede gebruiker zonder toegang, een interne notitie, medewerker zonder rechten, herstart en opruimen. Lokale tests bewijzen die live effecten niet.
