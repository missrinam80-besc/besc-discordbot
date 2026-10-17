# BESC Discordbot

Bot met `/besc status`, `/besc account`, `/besc events` en optionele privéticketing. Ticketing V2 ondersteunt CC-tickettypes, vragenformulieren en gecontroleerde paneelpublicaties. Antwoorden zijn privé voor de aanvrager. De bot draait op een **aparte bot-DEV-server**, met HTTPS-verzoeken naar `https://cc-dev.belgianstreamerscommunity.be/api/v1/bot/`. Geen directe databaseverbinding, publieke poort, moderatie of rollenbeheer. MEE6 blijft behouden.

Begin bij de [documentatiewiki](docs/README.md) en [huidige DEV-status](docs/HUIDIGE-DEV-STATUS.md). Zie [Ticketing V2](docs/TICKETING-V2.md) voor het definitieve contract, de expliciete opt-in, duurzame state-volume, scope-overdracht en DEV-acceptatie. De V2-functies worden niet bij containerstart gepubliceerd of geactiveerd; CC-concepten blijven zonder Discordeffect.

De afzonderlijke [BESC Bucks en XP-module](docs/BUCKS-XP.md) voegt privécommando's en verwerking van tekst- en voiceactiviteit toe. Zowel de module als automatisch verdienen staan standaard uit. Deze wijziging vereist CC-PR #107; scopes, commandregistratie en DEV-activering volgen pas na aparte beoordeling. Bestaande live tickets en slotopties worden niet gewijzigd.

## Bouwen en controleren

Gebruik Node.js 24.14.0 en de npm-lockfile:

```sh
npm ci
npm run check
npm test
npm run build
npm run demo
```

Tests en demo gebruiken synthetische gegevens (`TESTFIXTURE — NIET PUBLICEREN`) en een testkopie van de echte Command Center API-kern onder `tests/support/commandcenter`. Een naastliggende CC-checkout is niet nodig. Deze kopie wordt niet in de image opgenomen; de server blijft eigenaar van actuele toegangsregels.

## Configuratie en Discord

Kopieer `.env.example` naar `.env` en vul de zes instellingen in. Token en oorspronkelijke API-sleutel blijven buiten Git, logs en de image. Command Center bewaart alleen de sleutelhash. `npm start` verbindt lokaal. Bij de Windows-acceptatie was Node's `--use-system-ca` nodig voor vertrouwde Windows-certificaten. Schakel TLS-controle nooit uit.

De bot controleert de API-client en drie leesrechten bij opstart en controleert API-toegang opnieuw per commando. De API vertrouwt de geauthenticeerde bot om de echte commandactor door te geven; de bot gebruikt uitsluitend `interaction.user.id`.

De optionele [slotberichtenworker](docs/SLOT-WORKER.md) gebruikt uitsluitend `slots:deliver` en de door CC gekozen ontvanger/inhoud. Hij staat standaard uit (`BESC_SLOT_WORKER_ENABLED=false`). E-mail blijft standaard; de aparte CC-keuze `BESC_SLOT_DISCORD_NOTIFICATIONS_ENABLED` wordt hierdoor niet geactiveerd. De bestaande tickets, privéthreads, interne notities en verwijderketen blijven behouden. Het lokale verzendjournal hoort op de duurzame `/app/state`-volume; verwijder die volume niet bij een update.

Gebruik de bevestigde testserver/applicatie. De leesmodus heeft alleen `Guilds` nodig; ticketing gebruikt daarnaast `GuildMessages`, `GuildMembers` en `MessageContent` met de reeds overeengekomen privileged intents. Geen Administrator. Zie [ticketrechten](docs/TICKETING-DEV.md) en [V2](docs/TICKETING-V2.md) voor de beperkte kanaalrechten. `npm run commands:preview` wijzigt niets; `npm run commands:register` registreert na toestemming uitsluitend het eigen `/besc`-commando. V2 behoudt die commanddefinitie. Containerstart registreert geen commands.

## Container

Zie [serverinstructies](docs/DEV-HOSTING.md). De image bevat alleen gebouwde botcode en runtime-afhankelijkheden, draait als gebruiker `node` en ontvangt geheimen pas bij start. Compose publiceert geen poorten en herstart een gestopt proces automatisch tenzij bewust gestopt. Laat slechts één botinstantie draaien.

CI controleert TypeScript, tests, build, Docker-image en Compose. De handmatige workflow `Publish tested DEV image` publiceert vanaf `main` met commit-tag naar `ghcr.io/missrinam80-besc/besc-discordbot`. Publiceren start of wijzigt geen server.

## Acceptatie

De normale V1/V2-ticketflow, leescommando’s en de slot-DM-/gesloten-DM-terugval voor aanvraag, goedkeuring en annulering zijn op DEV door de gebruiker bevestigd. De slotopties zijn na de proef weer uit; Ticketing V2 blijft aan. De bewaartaak is eerder als actief en geslaagd bevestigd, maar een daadwerkelijke V2-purge is niet apart live bewezen. Zie [resultaten en open grenzen](docs/HUIDIGE-DEV-STATUS.md).

De oorspronkelijke leessleutel is intussen vervangen en ingetrokken. De actieve ticketclient is `besc-discord-tickets-dev`; gebruik de actuele CC-configuratie als bron voor geldigheid en scopes. Geen sleutel wordt automatisch verlengd.
