# DEV: formulier opent niet

> Historische diagnostiek. De onderzochte fout na formulierinzending is daarna herleid tot ontbrekend service_role-USAGE op het private schema in CC en hersteld; hertest slaagde. Veilige foutcodes hieronder blijven bruikbaar. Zie [status en oplossingen](HUIDIGE-DEV-STATUS.md).

Bij de eerste live acceptatie verschijnt de privé-uitleg, maar de knop Formulier invullen geeft een algemene fout. De oorzaak is nog niet vastgesteld. De opbouw van hetzelfde formulier serialiseert lokaal succesvol met discord.js 14.27.0; dit bewijst geen acceptatie door de live Discord-API.

Deze wijziging verandert geen modal, intake, rechten of API-contract. Zij maakt alleen de bestaande afgevangen fout zichtbaar als veilige codes in de bestaande botlog. Er is geen automatische herhaling en er wordt geen leeg ticket aangemaakt.

- `typed_show_modal_discord_50035`: Discord weigert het formulier. Eventuele volgende `typed_show_modal_field_...` regels noemen alleen toegestane structurele veldpaden, bijvoorbeeld `data.components.0.component.label`.
- `typed_show_modal_discord_10062`: interaction niet meer beschikbaar; onderzoek de antwoorddeadline.
- `typed_show_modal_discord_40060`: interaction al beantwoord.
- `typed_show_modal_discord_50001` / `50013`: Discord weigert toegang/rechten; geen automatische verruiming.
- `typed_interaction_api_...`: fout vóór het tonen van het formulier, bijvoorbeeld tijdens ophalen of valideren van de editie.
- `typed_show_modal_unexpected`: andere lokale fout; geen onbekende exceptiongegevens loggen.

Alleen vaste foutcategorieën en maximaal tien veldpaden worden opgenomen. Geen fouttekst, requestbody, URL, stack, antwoorden, persoonsgegevens of tokens. Ook onbekende foutcodes en veldnamen worden niet overgenomen.

Na afzonderlijk goedgekeurde merge en botdeploy: één nieuwe test starten vanaf het gepubliceerde paneel. Deel uitsluitend deze diagnostische coderegels. Voer geen nieuwe publicatie uit en reset geen configuratie, wachtrij of journal. CC en database hoeven voor deze diagnostiek niet te wijzigen; slotberichten blijven uit.

Lokaal gecontroleerd: 202 tests geslaagd, TypeScript en build geslaagd. De nieuwe tests bewijzen redactie, begrensde metadata en foutafhandeling zonder intake of automatische retry. De live oorzaak en de oplossing zijn hiermee nog niet bewezen.
