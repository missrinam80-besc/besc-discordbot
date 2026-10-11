# BESC Discordbot

Alleen-lezen bot met `/besc status`, `/besc account` en `/besc events`. Antwoorden zijn privé voor de aanvrager. De bot draait op een **aparte bot-DEV-server**, met HTTPS-verzoeken naar `https://cc-dev.belgianstreamerscommunity.be/api/v1/bot/`. Geen directe databaseverbinding, publieke poort, moderatie, rollenbeheer, XP of Bucks. MEE6 blijft behouden.

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

Gebruik de bevestigde testserver/applicatie, gewone `Guilds`-intent en geen privileged intents of Administrator. Installatiescopes: `bot`, `applications.commands`, `permissions=0`. `npm run commands:preview` wijzigt niets; `npm run commands:register` registreert na toestemming uitsluitend het eigen `/besc`-commando. DEV-commands zijn al geregistreerd. Containerstart registreert geen commands.

## Container

Zie [serverinstructies](docs/DEV-HOSTING.md). De image bevat alleen gebouwde botcode en runtime-afhankelijkheden, draait als gebruiker `node` en ontvangt geheimen pas bij start. Compose publiceert geen poorten en herstart een gestopt proces automatisch tenzij bewust gestopt. Laat slechts één botinstantie draaien.

CI controleert TypeScript, tests, build, Docker-image en Compose. De handmatige workflow `Publish tested DEV image` publiceert vanaf `main` met commit-tag naar `ghcr.io/missrinam80-besc/besc-discordbot`. Publiceren start of wijzigt geen server.

## Acceptatie

Op 10–11 oktober 2026 zijn live gebruikersproeven bevestigd voor positieve toegang, ongekoppeld account, ontbrekende eventrechten, geen actief organisatielidmaatschap en sleutelintrekking/herstel. Niet elk scenario heeft een afzonderlijke screenshot of HTTP-trace. Permanente containerhosting is hiermee nog niet bewezen.

De huidige acceptatiesleutel verloopt **17 oktober 2026 om 20:13 Belgische tijd**. Regel voor hosting bewust de sleutelgeldigheid/rotatie; die wordt niet automatisch verlengd.
