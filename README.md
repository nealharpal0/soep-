# Kippensoep & tomatensoep 🍲

Een interactieve animatie van iemand die een kom soep vasthoudt, de kom dichter naar zich toe haalt en erin blaast. Daarna stroomt de soep in een vast patroon door de kom. Je kunt schakelen tussen **kippensoep** en **tomatensoep**.

**Live:** https://nealharpal0.github.io/soep-/  
Direct tomatensoep: https://nealharpal0.github.io/soep-/#tomaat

## Bedienen

- **Kippensoep / Tomatensoep** – bovenin schakel je tussen de twee soepen. De stroming is bij beide hetzelfde.
- **Dichterbij houden** – de kom komt vloeiend naar je toe en kantelt, zodat je er bijna van bovenaf in kijkt. Dezelfde knop heet dan **Terug**.
- **Blazen** (alleen als de kom dichtbij is) – één klik is één keer blazen (±2,6 s), ingedrukt houden is blijven blazen. De ademwolk gaat van onderen naar de blaasplek, duwt de stoom weg en maakt rimpelingen. Na het blazen loopt de stroming in een paar seconden uit.
- **Toon stroming** – tekent rode stroomlijnen met pijlen over de soep en het blauwe punt waar geblazen wordt.

## De soepen

- **Kippensoep:** heldere gouden bouillon met vermicelli, kip, wortel, prei, selderij, peterselie en vetoogjes.
- **Tomatensoep:** rode tomatensoep met roomstrepen, tomatenstukjes, croutons, basilicum, peper en olie-oogjes.

## Stromingspatroon

Van bovenaf gezien (x naar rechts, y van de kijker af, in een eenheidscirkel) gebruikt de soep de stroomfunctie

```
ψ = −x · (1 − x² − y²)      →      u = 2xy,   v = 1 − 3x² − y²
```

- In het midden stroomt de soep van de blaasplek naar de verre rand.
- Daar splitst de stroom: links langs de linkerwand terug, rechts langs de rechterwand terug.
- Aan de kant van de kijker komen beide stromen samen bij de blaasplek en worden weer naar voren geduwd.
- Twee tegengesteld draaiende wervels (links tegen de klok in, rechts met de klok mee), met de centra op (±0,58; 0).

Dit veld wordt op de perspectiefellips van het soepoppervlak geprojecteerd. Alle ingrediënten en vetoogjes bewegen ermee mee (stukjes en strepen draaien mee met de wervelsterkte) en blijven binnen de kom. Een beetje ruis voorkomt dat iets blijft hangen bij de stilstandspunten voor en achter.

## Techniek

Alleen HTML, CSS en JavaScript (Canvas 2D), zonder build-stap:

- `index.html` – pagina en knoppen
- `style.css` – opmaak, responsief voor mobiel (staand) en desktop
- `app.js` – scène, simulatie en interactie

Lokaal bekijken: open `index.html` in een browser, of draai `python3 -m http.server` in deze map.

## Publiceren

GitHub Pages staat op branch `main`, map `/` (Settings → Pages).
