# Aparte bot-DEV-server

Doel: **Termius — botserver BESCSRVDEV-02 / `104.248.194.147`**, map `/opt/besc-discordbot`. De bot draait daar met Docker Compose; verbonden runtime, gebruiker node, duurzaam schrijfbaar state-volume en 60 seconden stoptermijn zijn via operatoruitvoer bevestigd. Dat bewijst geen recente OS-/capaciteitsaudit. CC staat op de aparte BESCSRVDEV in `/opt/besc-dev/command-center`. Verander de CC-webcontainer of database niet met deze botinstructies.

## Voorbereiden

1. Merge de gecontroleerde botwijziging. Start daarna op `main` handmatig `Publish tested DEV image` en bewaar de volledige commit-tag of image-digest. Dit rolt niet automatisch uit.
2. Verbind via Termius. Controleer `docker --version`, `docker compose version`, vrije schijf/RAM en bestaande services. Installeer Docker pas na vaststellen van het besturingssysteem en toestemming voor de installatie.
3. Zet `compose.yaml` in een eigen map, bijvoorbeeld `/opt/besc-discordbot`. Bewaar het bot-envbestand apart, bijvoorbeeld `/etc/besc-discordbot/bot.env`, alleen leesbaar voor de beheerder. Vul de zes namen uit `.env.example` in. Neem lokale geheimen veilig over; plak ze niet in chat of commandgeschiedenis. Organisatiebinding blijft in CC.
4. Log voor de private GHCR-image in met een daartoe bevoegde account en een token met benodigde leesrechten (`read:packages`). Gebruik `docker login ghcr.io --username <account> --password-stdin` via veilige invoer. Bewaar dit token niet in Git of bot-env. Controleer dat het package private blijft.

## Eerste installatie na akkoord

Onderstaande exports horen bij de eerste inrichting. Voor de bestaande DEV-installatie gelden het vaste Compose-project en `deployment.env` onderaan; voer eerste-installatiestappen niet opnieuw uit als diagnose.

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

De oorspronkelijke leessleutelrotatie is uitgevoerd en oude leesclients zijn ingetrokken. De huidige ticketclient is `besc-discord-tickets-dev`, laatst veilig gecontroleerd geldig tot `2027-01-09T16:33:18Z`; controleer bij een nieuwe wijziging opnieuw de actuele geldigheid en binding in CC. De oorspronkelijke sleutel blijft alleen in de geheime botconfiguratie, de hash in CC. Test nieuwe toegang en trek een oude client pas na bevestigde omschakeling in; verleng of reactiveer nooit automatisch.

## Bestaande DEV-installatie: update of configuratie herladen

**Alleen Termius op botserver BESCSRVDEV-02 / 104.248.194.147, `/opt/besc-discordbot`.** Compose-bestand `compose.yaml`, project `besc-discordbot-dev`, service `bot`, selectie via `deployment.env`; geheime env `/etc/besc-discordbot/bot.env`. Bewaar secrets buiten Git. Lees nooit volledige Compose-configuratie of container-env uit naar chat/log.

- Voor een code-update: goedgekeurde image-digest vastleggen, vorige image/deploymentselectie veilig back-uppen, uitsluitend de nieuwe geteste image ophalen en de botservice heraanmaken. Controleer de werkelijk ingelezen image en Discordverbinding, niet alleen Up.
- Voor alleen een flagwijziging: beveiligde env-backup, uitsluitend de genoemde flag aanpassen en dezelfde service heraanmaken met dezelfde image zonder pull. Controleer exacte overige instellingen, image-ID, Ticketing V2, duurzaam state-volume en verbinding. Verander CC niet tegelijkertijd.
- Gebruik bij de bestaande selectie expliciet `docker compose -p besc-discordbot-dev --env-file deployment.env -f compose.yaml`. Een los shell-export mag de bestaande image/envselectie niet onbedoeld overschrijven. De heraanmaak is een wijziging en vereist een afzonderlijk afgesproken doel.
- Bewaar `/app/state` en de journals/parentlijst bij iedere update; nooit `down -v`. Eén instantie tegelijk. Een onzekere aflevering eerst onderzoeken; geen restart/journalreset om een tweede effect af te dwingen.
- Voor slotafronding: eerst CC-keuze uit op de CC-server, daarna de CC-wachtrij uitsluitend lezend controleren; pas zonder resterende of onzekere aflevering de bot-slotworker uit. Ticketing V2 behoudt zijn eigen schakelaar.

Na de laatste configuratiestap zijn image, overige instellingen en state-volume behouden en de verbinding bevestigd. De [statuspagina](HUIDIGE-DEV-STATUS.md) bewaart de datum en testgrenzen. De e-mailminuuttimer en ticketretentietaak zijn CC-/databasebeheer, geen botserveropdracht.
