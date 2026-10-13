# AktieAnalysen – instruktioner för Claude

Statisk app som visar Zeddeers bevakade aktier. Den visas som ett claude.ai-Artifact:
**https://claude.ai/artifact/3dgNnXJDuY7TqRW2op9bFR** (GitHub-repot är källan; GitHub Pages
fungerar också om det slås på).
Användaren pratar med Claude i chatten; Claude uppdaterar `data/stocks.json`,
committar och pushar till `main`. Allt innehåll skrivs på svenska.

## Filer
- `data/stocks.json` – analyserna (skrivs av Claude). Källan till allt textinnehåll.
- `data/prices.json` – kurser och 1 års historik. **Skrivs bara av GitHub Action**
  (`.github/workflows/prices.yml` + `scripts/fetch_prices.py`, Avanza → Stooq → Yahoo).
  Redigera inte för hand.
- `index.html`, `style.css`, `app.js` – appen.

## Lägga till en aktie
Lägg till ett objekt i `stocks` med samma fält som befintliga:
`id` (url-slug), `name`, `shareClass`, `ticker`, `yahoo` (Yahoo-symbol, t.ex. `VOLV-B.ST`, `AAPL` – används som nyckel), `avanzaId` (Avanzas orderbok-id; lämnas tomt så letas det upp automatiskt),
`currency`, `market`, `sector`, `stance` (`positiv` | `neutral` | `negativ`), `risk`
(`låg` | `medel` | `hög` | `mycket hög`), `thesis` (1–2 meningar), `summary` (ett stycke),
`keyFigures[]` ({label, value, note}), `latestReport` ({title, date, highlights[]}),
`bull[]`, `bear[]`, `watch[]`, `events[]` ({date, label}),
`analysts` ({consensus, avgTarget, avgTargetNote, targets[{date, bank, rating, target}]}),
`log[]` ({date, text}), `links[]`, `sources[]` ({title, url}).
En push som ändrar `stocks.json` triggar kurshämtningen automatiskt.

## Källor
1. **Börskollen** – `https://www.borskollen.se/aktie/{slug}` (+ `/riktkurs`, `/blankning`,
   `/insynshandel`, `/nyheter`). Nyckeltal, blankning, riktkurser, nästa rapport.
2. **MFN** – `https://mfn.se/all/a/{bolag}` för pressmeddelanden och finansiell kalender.
3. Bolagets IR-sida (står under `links`).
4. allaaktier.se laddar data via JavaScript/inloggning och går oftast inte att läsa –
   försök, men hoppa över utan att stoppa.
5. Kompletterande: Inderes, Quartr, Placera, Affärsvärlden (ofta rate-limitad).

## Daglig uppdatering (rutin)
För varje aktie:
1. Kolla nya pressmeddelanden, rapporter, riktkursändringar, blankning och insynshandel
   sedan senaste loggposten.
2. Uppdatera berörda fält (`keyFigures`, `latestReport`, `analysts`, `events`, `watch`).
   Ta bort passerade händelser ur `events` när de är rapporterade.
3. Lägg till **en** loggpost per aktie bara om något faktiskt hänt (datum + kort vad och
   vad det betyder). Inga "inget nytt"-poster.
4. Ändra `stance`/`risk` bara vid ett tydligt skäl, och skriv skälet i loggen.
5. Lägg till nya källor i `sources` (max ~8, ta bort de äldsta).
6. Sätt `updated` till dagens datum, validera JSON (`python3 -m json.tool data/stocks.json`),
   commit `Analys YYYY-MM-DD: <kort sammanfattning>` och push till `main`.
7. Publicera om artifactet (även om inget nytt hänt, så att kurserna blir färska):
   `git pull` (hämtar senaste `data/prices.json`), kör `python3 scripts/build_artifact.py`,
   och anropa Artifact-verktyget med `action: "publish"`,
   `url: "https://claude.ai/artifact/3dgNnXJDuY7TqRW2op9bFR"`, `file_path: dist/artifact.html`
   och `files: {"data/stocks.json": "data/stocks.json", "data/prices.json": "data/prices.json"}`.
   Läs artifactet först (`action: "read"`) om verktyget kräver det. Skapa aldrig ett nytt artifact.

## Ändra appen
Redigera `index.html`/`style.css`/`app.js`, kör `scripts/build_artifact.py` och publicera om
enligt steg 7 ovan. Länkar inne i appen använder enkla hash-tokens (`#tobii`, `#kalender`).

## Regler
- Siffror ska komma från källor, aldrig gissas. Osäkert datum → lämna `""`.
- Citera inte långa stycken; skriv med egna ord.
- Ingen finansiell rådgivning i form av köp/sälj-order – `stance` är en analytisk hållning.
