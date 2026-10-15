# Testresultaten slotworker

Uitgevoerd op 15 oktober 2026 met Node.js 24.14.0, vanaf bot-main `14b8e0890ef8e606fd2af77c4d76c70330308214`. Contract gecontroleerd tegen CC `d7022f659dac52dce7743e4887265c24a9c80de2`.

| Controle | Resultaat |
| --- | --- |
| TypeScript (`npm run check`) | Geslaagd |
| Gehele testsuite (`npm test`) | **124 geslaagd**, 0 mislukt, 0 overgeslagen |
| Productiebuild (`npm run build`) | Geslaagd |
| Patchopmaak (`git diff --check`) | Geslaagd |
| Gedeelde release-99 fixture | Exacte kopie; SHA-256 `80e661cfe3bba16a71a0fc1771010de42c4d7ea3fb5cd1c3270f56073257319a` |
| Docker/Compose en Linux-volume | In CI opgenomen; geen lokale Docker-runtime beschikbaar. Raadpleeg de PR-check voor de actuele uitvoeringsstatus. |

De 56 nieuwe tests controleren exacte contractrequests/fixtures, foutcodes/authheaders/guild, input- en antwoordvalidatie, echte lokale HTTP en afgebroken responsebody, dispatch vóór send, foutgevallen zonder tweede DM, duurzame resultaten en stabiele worker over heropenen, verloren `sent` en `fail`, verlopen leases, gesloten DM/e-mailfallbacksignaal, onbekende uitkomst, serialisatie, afsluiten, schrijffouten, lock/corruptie, origin/client/app/guildbinding, geen PII in journal, mentions/reference, geen Discordretries en de aparte opt-in. De 68 bestaande tests voor commands, account/eventrechten en tickets blijven slagen.

Dit is lokale/gesimuleerde verificatie. Geen echte Discord-DM, Gmailfallback, migratie, DEV-deploy, huidige clientscope of CC-featureflag is live gecontroleerd of geactiveerd. Een succesvolle CI bewijst de image en volume, geen live acceptatie. Voor die laatste stap geldt `docs/SLOT-DEV-ACCEPTANCE.md`.

Bekende contractgrens: eerste `sent` na verlopen lease kan door CC worden geweigerd. Het journal bewaart het bewijs en voorkomt herhaling; CC-reconciliatie blijft nodig. Een harde crash laat bewust een proceslock achter die na controle door een operator wordt vrijgegeven. Onopgeloste poging blokkeert alleen deze worker; deze runtime blijft conservatief totdat de uitkomst is onderzocht.
