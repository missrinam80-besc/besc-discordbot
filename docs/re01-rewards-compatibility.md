# RE01 — terugbetaalde beloningen

De bot kan de CC-status `refunded` als **Terugbetaald** tonen en boekingen van type `refund` lezen. De bestaande schemaVersion blijft 1; bestaande velden en routes zijn behouden. Alleen CC-beheer kan een terugbetaling uitvoeren. Er is geen botterugbetaalcommando en geen extra scope.

Deze compatibiliteitsimage moet vóór de eerste RE01-terugbetaling actief zijn. Een oudere botparser weigert deze nieuwe enumwaarden; na de eerste terugbetaling niet zelfstandig naar de oude botimage terugvallen. Bestaande eventworkers, ticketing, Bucks-sleutels, state-volume en commando's blijven behouden. Geen commandoregistratie, activering of configuratiewijziging nodig voor deze codeaanpassing.

Gerichte API- en handlergevallen plus typecontrole en botbuild zijn lokaal uitgevoerd. Dit is geen bewijs van een DEV-uitrol of brede preproductieacceptatie.
