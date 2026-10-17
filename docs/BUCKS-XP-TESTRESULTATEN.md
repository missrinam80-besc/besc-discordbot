# BESC Bucks en XP testresultaten

Datum: 17 oktober 2026. Botbranch `codex/bucks-xp-v1`, basis bot-main `196323e`. CC-contract: PR #107, commit `43d05ba38eea43c4e8317293b7a1bd3a6b721abb`. Testgegevens zijn `TESTFIXTURE — NIET PUBLICEREN` en gebruiken geen live credentials.

## Lokaal gecontroleerd

- TypeScriptcontrole en productiebuild slagen.
- Alle 295 bottests slagen, waaronder 79 nieuwe Bucks-tests. Bestaande leescommando’s, ticketing V1/V2 en slotberichten blijven onderdeel van de suite.
- API-projectie gebruikt dezelfde fixtures als CC. De genormaliseerde fixture-SHA256 is `2d858c6275089e806a2e246f3ba18ed502c5426dd873c583f45832fac08b758e`.
- Onbekende velden, foutieve guild/schema, saldo-inconsistenties, te grote pagina’s en ongeldige timestamps worden geweigerd. Een vastlopende echte HTTP-responsebody wordt daadwerkelijk afgebroken.
- Een request wordt pas na de aparte bevestiging aangeboden. Actor, guild, applicatie, verlopen knoppen, restart, herhaalde interactie, accountontkoppeling en verouderde beslissingen zijn getest. Persoonlijke gegevens blijven in privéantwoorden zonder mentions.
- Het journal overleeft heropenen. Dezelfde sleutel met andere inhoud, gelijktijdige instantie, beschadigd bestand, onopgeloste clientrotatie en schrijffout worden tegengehouden. Persoonlijke acties krijgen voorrang; bestaande slotstate kan dezelfde map blijven gebruiken.
- Netwerkonzekerheid herhaalt dezelfde inhoud na restart. Ook de echte rewards-transportlaag en het schijfjournal worden samen getest met een verloren upstreamantwoord. Geen tweede aanvraag-ID of onterechte succesmelding.
- Accountontkoppeling na een onzekere verzending houdt de actie voor controle geblokkeerd. Stoppen wacht ook een lopende configuratielezing af en start daarna geen nieuwe timers.
- Weigeringen, rate limiting, achtpogingengrens, intrekking/scopes, stoppen tijdens verwerking en nooit aangeboden verlopen activiteit zijn getest.
- Tekstfilters, lokale cooldown, volledige voiceminuten, bots/onbekende leden, mute/deafen/AFK, minimaal deelnemersaantal, kanaalwissel, onderbroken verbinding, nieuwe regels en gemiste observatieperiode zijn getest. Geen retrospectieve minuten of audioverwerking.
- Beide botvlaggen staan standaard uit. Privécommando’s kunnen apart van activiteit aan. De standaard commanddefinitie en bestaande ticketintents zijn behouden; activiteit voegt geen privileged content- of memberintent toe.

Een parallelle lokale testrun raakte de zeer korte opstartdeadline van de HTTP-annuleringstests voordat de bedoelde responsebody was gestart. De tests warmen nu eerst de lokale verbinding op en controleren daarna afzonderlijk de bodydeadline; de nieuwe Bucks-test controleert bovendien dat de body werkelijk was gestart en de verbinding wordt gesloten. De runtime-deadline is niet gewijzigd. De volledige eindrun slaagt.

## CI

CI voert dezelfde tests en build uit op Node.js 24.14.0 en bouwt de Docker-image. De bestaande controles op non-root, image-inhoud, Compose en het slotjournal blijven behouden. Een extra controle heropent een pending Bucks-opdracht in een tweede non-root container met alleen-lezen root en dezelfde schrijfbare state-volume. Het definitieve CI-resultaat hoort bij de draft PR.

## Open voor live acceptatie

Er is geen Discordcommand geregistreerd, bericht verstuurd, serverconfiguratie gewijzigd, scope toegevoegd of database gemigreerd. De volledige bot-naar-CC-naar-Discordketen is nog niet live bewezen. De CC-zijde heeft eigen tests en een aparte migratie in PR #107; deze botbranch kan die ontbrekende DEV-API niet zelfstandig activeren. Automatisch verdienen blijft uit totdat daarvoor afzonderlijk regels en een proef zijn goedgekeurd.
