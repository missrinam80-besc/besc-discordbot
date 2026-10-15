# Afzonderlijke CC-overdracht voor configuratiescopes

Dit is een voorbereide opdracht, geen uitgevoerde clientwijziging. De actieve client is `besc-discord-tickets-dev`. De aanwezigheid van de drie nieuwe scopes is nog niet live bevestigd. Wijzig pas na afzonderlijke toestemming voor deze concrete configuratiestap.

1. Lees het actuele clientrecord op de CC-DEV-service, zonder volledige secrets/env of credentials te tonen. Neem niet een oud prototype- of exportbestand als bron.
2. Controleer dat het juiste record actief is, niet ingetrokken en niet verlopen, en aan de bestaande organisatie `999b6af9-479c-4082-b9d8-fa0a78aefac5` en guild `1067893182387474432` is gebonden. Stop bij afwijking; reactiveer of verleng niets automatisch.
3. Maak een behoudende kopie van de volledige huidige clientconfiguratie. Voeg alleen ontbrekende `bot-config:read`, `bot-config:report`, `bot-config:deliver` toe aan dit ene record. Behoud alle bestaande scopes, ID, sleutelhash, organisatie, guild, legacy parent, expiry, revoked-status, overige recordvelden en alle andere clients exact.
4. Toon een gesanitiseerde diff: uitsluitend de toegevoegde scopenamen en client-ID. Toon geen token, oorspronkelijke API-key of complete credentialconfiguratie.
5. Leg de normale CC-review/goedkeuring voor deze afzonderlijke wijziging vast. Pas geen migratie, webservice-image, Discordrechten of botinstellingen aan als onderdeel van scope-inlezen.
6. Na toestemming de gewijzigde configuratie volgens de bestaande CC-procedure inlezen. Verifieer de webservicehealth en lees veilig terug dat dit record actief is, de bestaande scopes behouden zijn en de drie configuratiescopes aanwezig zijn. Behoud de huidige image en overige instellingen.
7. Meld client-ID, scopes en behoudscontrole terug aan de botchat. De botchat start pas na aparte botdeploytoestemming de nieuwe runtime en gebruikt dezelfde bestaande key.

Deze scopes geven alleen CC-configuratie lezen, beperkte runtime/kanaalmetadata rapporteren en vooraf door CC geautoriseerde configdeliveries uitvoeren. Zij geven geen `manageTickets`, organisatiebeheer, algemene Discordadmin, vrije actoroverride of wildcardguild. CC vertrouwt de bot nog steeds voor de echte Discordactor uit de interaction.

Als de scopes al aanwezig blijken, wijzig niets en rapporteer alleen dat de controle geslaagd is. De oude ingetrokken leesclients blijven ingetrokken; genereer of roteer geen key en stel de expiry niet opnieuw op 90 dagen in.
