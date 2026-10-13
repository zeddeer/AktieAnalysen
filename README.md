# AktieAnalysen

Mobilvänlig sida med egna aktieanalyser. Analyserna skrivs och uppdateras av Claude
via chatten och en daglig schemalagd körning; kurserna hämtas automatiskt av en
GitHub Action varje vardag.

Bevakade just nu: Electrolux B, Electrolux Professional B, Tobii, IBM, SkiStar B.

## Så funkar det
- `data/stocks.json` – analyserna (Claude)
- `data/prices.json` – kurser och historik (GitHub Action, Yahoo Finance)
- `index.html` / `style.css` / `app.js` – statisk app, ingen byggsteg

## Kör lokalt
```
python3 -m http.server 8000
```
och öppna `http://localhost:8000`.

## Publicera
Repo → Settings → Pages → Deploy from branch → `main` / root.

Inte finansiell rådgivning.
