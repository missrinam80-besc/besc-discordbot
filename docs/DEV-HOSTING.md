# Aparte bot-DEV-server

Doelserver: `104.248.194.147`, door gebruiker bevestigd, beheerd via Termius. Besturingssysteem, SSH-gebruiker, Dockerbeschikbaarheid en capaciteit zijn nog niet gecontroleerd. Termius is de SSH-client; deze instructies gebruiken Docker Compose op de server. Verander de Command Center-webcontainer of database niet.

## Voorbereiden

1. Merge de gecontroleerde botwijziging. Start daarna op `main` handmatig `Publish tested DEV image` en bewaar de volledige commit-tag of image-digest. Dit rolt niet automatisch uit.
2. Verbind via Termius. Controleer `docker --version`, `docker compose version`, vrije schijf/RAM en bestaande services. Installeer Docker pas na vaststellen van het besturingssysteem en toestemming voor de installatie.
3. Zet `compose.yaml` in een eigen map, bijvoorbeeld `/opt/besc-discordbot`. Bewaar het bot-envbestand apart, bijvoorbeeld `/etc/besc-discordbot/bot.env`, alleen leesbaar voor de beheerder. Vul de zes namen uit `.env.example` in. Neem lokale geheimen veilig over; plak ze niet in chat of commandgeschiedenis. Organisatiebinding blijft in CC.
4. Log voor de private GHCR-image in met een daartoe bevoegde account en een token met benodigde leesrechten (`read:packages`). Gebruik `docker login ghcr.io --username <account> --password-stdin` via veilige invoer. Bewaar dit token niet in Git of bot-env. Controleer dat het package private blijft.

## Start na akkoord

Stel onderstaande niet-geheime variabelen in met de werkelijk gepubliceerde tag/digest:

```sh
export BESC_BOT_IMAGE=ghcr.io/missrinam80-besc/besc-discordbot:<geteste-commit-tag>
export BESC_BOT_ENV_FILE=/etc/besc-discordbot/bot.env
cd /opt/besc-discordbot
docker compose config --quiet
docker compose pull
```

Stop vóór de eerste start de lokale acceptatiebot, zodat er geen dubbele antwoorden ontstaan. Daarna:

```sh
docker compose up -d
docker compose ps
docker compose logs --tail=30 bot
```

Controleer de melding van een geslaagde Discordverbinding en de drie `/besc`-commando's op de testserver. Herstart vervolgens bewust de botcontainer en controleer opnieuw `/besc status`. Controleer na een afgesproken serverherstart automatisch starten. Een draaiende container alleen bewijst geen Discord/API-bereikbaarheid. De restart policy herstart een beëindigd proces; er is nog geen volledige watchdog voor een vastgelopen proces.

Gebruik uitsluitend `docker compose config --quiet`: volledige configuratie-uitvoer kan geheimen bevatten. Geef de bot geen publieke poorten of Docker-socket. Controleer op Linux de geldige HTTPS-certificaatketen; schakel certificaatcontrole nooit uit.

## Updates en sleutelrotatie

Bewaar de vorige geteste image-tag/digest. Wijzig alleen `BESC_BOT_IMAGE`, pull en hermaak de eigen botservice; controleer commands en rol bij fouten terug naar de vorige image. Meng geen CC-uitrol in deze stap.

Regel vóór 17 oktober 2026 om 20:13 Belgische tijd de goedgekeurde sleutelrotatie/geldigheid. De originele nieuwe sleutel hoort alleen in het geheime bot-envbestand, de hash met beperkte scopes en dezelfde organisatie/server in CC. Test nieuwe toegang en trek de oude sleutel gecontroleerd in. Verleng toegang niet automatisch.
