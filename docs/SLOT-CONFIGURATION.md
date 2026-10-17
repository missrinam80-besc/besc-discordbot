# Exacte aanvullende configuratie — naslag

> Naslag voor een latere goedgekeurde wijziging. Scope slots:deliver is op DEV al aanwezig; de gecontroleerde proef is afgesloten met beide slotopties uit. Niet opnieuw rechten toevoegen of flags aanzetten op basis van deze pagina. Zie [status](HUIDIGE-DEV-STATUS.md).

De runtime en PR staan klaar voor review. Deze pagina beschrijft alleen de later afzonderlijk goed te keuren wijziging. Geen sleutels, hashes of tokens zijn opgenomen. De huidige live clientconfiguratie is niet door deze botchat uitgelezen; vervang daarom nooit de volledige clientlijst door een voorbeeld.

## CC: één scope toevoegen aan de bestaande client

Zoek in de bestaande server-side configuratie `BESC_BOT_CLIENTS_JSON` exact het record met `id = besc-discord-tickets-dev`. Voeg aan de **actuele bestaande** `scopes`-array één waarde toe, zonder duplicaat:

```text
slots:deliver
```

De wijziging is uitsluitend: `nieuwe scopes = bestaande scopes ∪ {slots:deliver}`. Behoud alle bestaande scopes, inclusief eventueel al verleende configuratiescopes. Geen Administrator- of algemene beheerrechten nodig. De vier POST-routes gebruiken deze ene scope.

| Clientveld | Actie |
| --- | --- |
| `id` | Behoud `besc-discord-tickets-dev`. |
| `organizationId` | Behoud `999b6af9-479c-4082-b9d8-fa0a78aefac5`. |
| `guildId` | Behoud `1067893182387474432`. |
| `ticketParentChannelId` | Behoud `1558853872766689382`. |
| `keyHash` | Exact behouden; geen nieuwe sleutel of hash genereren of tonen. |
| `expiresAt`, `revoked` | Behouden; vooraf veilig controleren dat de client nog geldig en niet ingetrokken is. Een verlopen/ingetrokken client vraagt een afzonderlijk besluit. |
| Overige clients, bindings en instellingen | Exact behouden. |

Deze wijziging hoort alleen in de bestaande beveiligde CC-configuratiebron; nooit in de botimage, chat of Git. Pas na toestemming veilig teruglezen: clientlabel, binding, scopenamen en geldigheidsstatus. Geen volledige secretconfiguratie afdrukken.

## Bot: duurzame opslag en afzonderlijke opt-in

Op de bestaande aparte botserver `104.248.194.147`, pas na een apart goedgekeurde merge/imagepublicatie/deploy:

| Instelling | Voorbereiding / waarde bij gecontroleerde acceptatie |
| --- | --- |
| `BESC_SLOT_WORKER_ENABLED` | Nu `false` of afwezig houden. Alleen na toestemming `true`. Dit is de bot-opt-in. |
| `BESC_BOT_STATE_DIR` | `/app/state`, met de door deze PR geleverde duurzame `bot-state`-volume en schrijfbare map voor gebruiker `node`. Geen tijdelijke opslag. |
| `BESC_BOT_IMAGE` | Alleen na goedkeuring vervangen door de nieuw geteste gepubliceerde digest; die image is nu nog niet gepubliceerd. |
| `BESC_BOT_ENV_FILE` | Bestaand absoluut pad behouden, normaal `/etc/besc-discordbot/bot.env`. Het journal hoort in de volume, niet in dit bestand. |
| `BESC_BOT_API_KEY`, `DISCORD_BOT_TOKEN` | Huidige waarden behouden, niet tonen of opnieuw aanmaken. |
| `COMMANDCENTER_API_URL` | Behoud `https://cc-dev.belgianstreamerscommunity.be/api/v1/bot/`. |
| `DISCORD_GUILD_ID` | Behoud `1067893182387474432`. |
| `DISCORD_APPLICATION_ID` | Behoud `1558542661265129474`. |
| Ticketkanaal, web-URL en overige instellingen | Exact behouden. |

Gebruik de Compose uit dezelfde gereviewde botcommit; die levert de named volume en 60 seconden stoptermijn. Eén botinstantie. Geen nieuwe Discordintents, installatiescopes, kanaalrechten, commandregistratie of MEE6-wijziging nodig voor de DM-worker. Het bestaande Bot-token wordt gebruikt; de nieuwe CC-scope is geen Discordpermission.

## CC: aparte keuzeschakelaar

`BESC_SLOT_DISCORD_NOTIFICATIONS_ENABLED` blijft op CC nu `false` of afwezig. Alleen in een afzonderlijk goedgekeurd, afgeschermd DEV-acceptatievenster wordt dit `true`, zodat testers expliciet voor Discord kunnen kiezen. De flag is globaal en is geen tester-allowlist. Plaats deze instelling niet als vervanging van de bot-opt-in op de botserver.

Volgorde na review en toestemming: scope veilig toevoegen/readback → gereviewde botimage met behouden state deployen → bot-opt-in aan → CC-keuze uitsluitend voor gecontroleerde proef aan → DM/gesloten-DM-fallback/ontkoppeling/herstel/regressies testen. Zet de CC-keuze en bot-opt-in daarna weer uit tenzij verdere activering expliciet is goedgekeurd. Bestaande Gmail-configuratie, minuutplanning, cronsecret en databasemigratie blijven behouden.
