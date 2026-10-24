# Eigen campagnes — F5.1

24 oktober 2026. De bot kan optioneel `/besc campagne mijn` aanbieden. Het privéantwoord bevat maximaal vijf eigen actuele campagnes per pagina en vaste links naar Command Center. Toestemming en beoordelen blijven in CC. Geen metingen, andere deelnemers of saldi worden getoond.

## Afzonderlijk optionele kandidaat-invoer

`BESC_CAMPAIGN_SUBMISSIONS_ENABLED=false` blijft standaard uit. Inschakelen vereist daarnaast de campagnemodule en afzonderlijke scope `campaigns:own:write`, zowel voor runtime als voor commandregistratie. `/besc campagne indienen` gebruikt de campagnelink uit CC en een Twitch-/YouTube-postlink; de bot mag geen andere gebruiker, organisatie, bedrag of goedkeuring opgeven.

De echte Discord-interactie-ID blijft de idempotencysleutel. CC zoekt precies één eigen actuele geaccepteerde deelname en controleert die opnieuw onder de bestaande campagnegate. Identieke herhaling blijft dezelfde ontvangst; gewijzigde inhoud conflicteert. De bijdrage wordt kandidaat in de bestaande onafhankelijke reviewketen. Een al bestaande bijdrage wordt niet automatisch opnieuw goedgekeurd en levert geen beloning op.

Bij een onzekere ontvangst verwijst de bot naar de actuele CC-gegevens voordat opnieuw wordt ingediend. Er is geen achtergrondretry met nieuwe sleutels, nieuwe worker of tweede gegevensopslag. De verdere F5-uitbreidingen staan in de aparte CC-PR #123; de bot krijgt geen directe toegang tot Twitchcredentials, Streamer.bot-bronkeys of saldosnapshots.

## Veilige standaard

`BESC_CAMPAIGN_COMMANDS_ENABLED=false` blijft de standaard. Wanneer ingeschakeld, moet de bestaande botclient afzonderlijk `campaigns:own:read` krijgen. CC vereist daarnaast `BESC_CAMPAIGNS_BOT_ENABLED=true` en de passende bestaande F3-proef-/campagneflag. De botstartup gebruikt bestaande identitycontrole; bij ontbrekende scope blijft het campagnecommando gesloten. De API controleert iedere aanvraag opnieuw.

`src/register.ts` toont zonder `--apply` uitsluitend de commanddefinitie. Registratie met campagne-opt-in controleert eerst de scope bij CC. Een live registratie is een afzonderlijke vrijgave en vervangt alleen de bestaande `/besc`-definitie; geen andere application commands. Bestaande tickets en Bucks blijven behouden.

## Contract en toegang

`GET /api/v1/bot/campaigns` gebruikt uitsluitend `guild_id`, de Discord-ID van de echte interactiongebruiker en een paginaoffset. De bot laat geen willekeurige acteur, organisatie of URL kiezen. CC bepaalt actuele accountbinding en eigen geldige geaccepteerde deelname; bestuursrechten geven niet automatisch inzage in campagnes van anderen.

De client valideert de exacte responsevelden en het vaste campagnepad. Antwoorden zijn ephemeral, zonder toegestane mentions; titels worden ontdaan van actieve links en opmaak. Links gaan uitsluitend naar de geconfigureerde CC-origin. Er is geen campagnecache, nieuwe worker, gatewayintent, lokale database of directe Supabase-verbinding.

Intrekking werkt op volgende aanvragen en tijdens de gecontroleerde CC-leesgrens. Een al afgeleverd privéantwoord wordt niet automatisch verwijderd na een latere intrekking.

## Bouwen en beperkte verificatie

Gericht: `node --test tests/campaigns.test.ts tests/combined-runtime.test.ts`, `npm run check` en `npm run build`. Bestaande algemene CI blijft behouden. De CC-migratie en native SQL-proef horen bij de aparte CC-repository. Er zijn nu geen live testaccounts, scopes, registraties of deployments toegevoegd.

## Uitrolgrens

Eerst de beoordeelde CC-route/migratie beschikbaar maken met de CC-flag uit. Bot en CC hebben aparte images, credentials, repositories en uitrolpakketten. Daarna expliciet scopes, beide flags en `/besc`-registratie vrijgeven. Geen automatische beloningen, Streamer.bot-bron, websitewijziging of productieovername in deze oplevering. Sluiten/terugval gebeurt door de nieuwe flags uit te zetten en de beoordeelde vorige image te gebruiken; bestaande saldi en dossiers blijven behouden.
