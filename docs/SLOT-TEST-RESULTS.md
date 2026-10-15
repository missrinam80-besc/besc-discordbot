# Testresultaten slotworker

Uitgevoerd op 15 oktober 2026 met Node.js 24.14.0, vanaf bot-main `14b8e0890ef8e606fd2af77c4d76c70330308214`. Contract gecontroleerd tegen CC `d7022f659dac52dce7743e4887265c24a9c80de2`.

Bij afronding is opnieuw gecontroleerd tegen CC-main `739d72a58eb1662a0e03d6fc81e1e9cc60cca831` (PR #100). De vergelijking met PR #99 bevat geen wijziging aan slotroutes, contract, fixtures of migratie. De bestaande worker blijft passend; geen tweede implementatie of runtimewijziging toegevoegd.

| Controle | Resultaat |
| --- | --- |
| TypeScript (`npm run check`) | Geslaagd |
| Gehele testsuite (`npm test`) | **124 geslaagd**, 0 mislukt, 0 overgeslagen |
| Productiebuild (`npm run build`) | Geslaagd |
| Patchopmaak (`git diff --check`) | Geslaagd |
| Gedeelde release-99 fixture | JSON-inhoud ongewijzigd; SHA-256 van het lokale bronbestand `80e661cfe3bba16a71a0fc1771010de42c4d7ea3fb5cd1c3270f56073257319a`. Git kan regeleinden normaliseren. |
| Docker/Compose en Linux-volume | Geslaagd in beide CI-runs op runtimecommit `0c5c749`: [push](https://github.com/missrinam80-besc/besc-discordbot/actions/runs/38690558735), [PR](https://github.com/missrinam80-besc/besc-discordbot/actions/runs/38690606955). Geen lokale Docker-runtime beschikbaar. Raadpleeg de PR-check voor de laatste documentatiecommit. |

De 56 nieuwe tests controleren exacte contractrequests/fixtures, foutcodes/authheaders/guild, input- en antwoordvalidatie, echte lokale HTTP en afgebroken responsebody, dispatch vóór send, foutgevallen zonder tweede DM, duurzame resultaten en stabiele worker over heropenen, verloren `sent` en `fail`, verlopen leases, gesloten DM/e-mailfallbacksignaal, onbekende uitkomst, serialisatie, afsluiten, schrijffouten, lock/corruptie, origin/client/app/guildbinding, geen PII in journal, mentions/reference, geen Discordretries en de aparte opt-in. De 68 bestaande tests voor commands, account/eventrechten en tickets blijven slagen.

Dit is lokale/gesimuleerde verificatie. Geen echte Discord-DM, Gmailfallback, migratie, DEV-deploy, huidige clientscope of CC-featureflag is live gecontroleerd of geactiveerd. Een succesvolle CI bewijst de image en volume, geen live acceptatie. Voor die laatste stap geldt `docs/SLOT-DEV-ACCEPTANCE.md`.

De gebruiker heeft de CC-migratie, deploy van PR #99/#100 en volledige e-mailacceptatie inmiddels bevestigd. Dat is afzonderlijk live bewijs vanuit de CC-kant, geen Discordacceptatie vanuit deze botchat. De nieuwe scope en CC-flag staan volgens diezelfde overdracht nog uit. De actuele clientconfiguratie blijft voor de latere gecontroleerde activering veilig terug te lezen; [exacte minimale wijzigingen](SLOT-CONFIGURATION.md) zijn voorbereid zonder geheimen.

Bekende contractgrens: eerste `sent` na verlopen lease kan door CC worden geweigerd. Het journal bewaart het bewijs en voorkomt herhaling; CC-reconciliatie blijft nodig. Een harde crash laat bewust een proceslock achter die na controle door een operator wordt vrijgegeven. Onopgeloste poging blokkeert alleen deze worker; deze runtime blijft conservatief totdat de uitkomst is onderzocht.
