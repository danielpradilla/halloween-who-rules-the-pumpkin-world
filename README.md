# Who Rules the Pumpkin World?

A one-page data story comparing the countries that grow the most pumpkins, squash and gourds with the countries that export the most. Production comes from FAOSTAT (tonnes) and exports from UN Comtrade (US dollars). Reference year: 2024.

The figures cover pumpkins, squash and gourds of all varieties, including zucchini and butternut squash, not just Halloween pumpkins. The numbers cover the whole year, not just Halloween.

- Published: <https://www.danielpradilla.info/projects/halloween-who-rules-the-pumpkin-world/>
- Source: <https://github.com/danielpradilla/halloween-who-rules-the-pumpkin-world>

## Results for 2024

| Measure | India and China (mainland) | Spain and Mexico |
| --- | --- | --- |
| Share of world production (tonnes) | 49.1% | 3.9% |
| Share of reported world exports (US$) | 1.7% | 65.3% |

India ranks 1st for production and 15th for export value. Spain ranks 8th for production and 1st for exports; Mexico ranks 11th and 2nd.

## Data sources

| Measure | Source | Selection |
| --- | --- | --- |
| Production | [FAOSTAT Crops and livestock products (QCL)](https://www.fao.org/faostat/en/#data/QCL), bulk file updated 31 December 2025 | Item 394 “Pumpkins, squash and gourds” (CPC 01235), element 5510 Production, tonnes |
| Exports | [UN Comtrade](https://comtradeplus.un.org/), public preview API | HS 070993 “Pumpkins, squash and gourds (*Cucurbita* spp.), fresh or chilled”, flow X, partner World, `primaryValue` (FOB US$) |

Retrieved 1 November 2026. The page loads only `data/pumpkins-2024.json` and makes no external requests at runtime.

## Method

- Production share is country tonnes divided by FAO's World total (34,584,405 t). Country rows sum to 34,553,854 t.
- Export share is country exports divided by the sum declared by all 114 reporters (US$1.74 billion). Only exporter-declared values are used in rankings.
- FAO's regional aggregates and its "China" total are excluded. China (mainland) is ranked on its own.
- A country with no value has no rank and is shown as "not reported". No missing value is replaced with zero.
- Partner-declared imports are used only to check coverage and to list each exporter's main buyers. For the largest non-reporter, Bangladesh, partners declared $5.2M of imports, against $28.7M for the 10th-ranked exporter, so partner data do not suggest that any non-reporter belongs in the top 10.
- FAO M49 codes are joined to Comtrade reporter codes. Six differ: United States 840/842, France 250/251, India 356/699, Switzerland 756/757, Norway 578/579, and Taiwan 158/490 (Comtrade's "Other Asia, nes").

The two classifications differ in scope. FAOSTAT's item includes *Lagenaria* bottle gourds; HS 070993 does not. HS 070993 covers fresh or chilled produce only. The page therefore compares ranks and shares and never puts tonnes and dollars on one axis.

## Files

| Path | Contents |
| --- | --- |
| `index.html` | Page, metadata, methodology text |
| `styles.css` | House style (`danielpradilla-app-style`) plus the pumpkin and charcoal palette |
| `js/app.js` | Loads the JSON and draws every chart, table and data-dependent sentence |
| `data/pumpkins-2024.json` | Processed data: one record per country with production, exports, ranks, shares and FAO flags |
| `og.jpg` | 1200 × 630 social preview |
| `scripts/build_data.py` | Downloads the sources and builds the JSON (Python 3 standard library only) |
| `sources/raw/` | Raw Comtrade API responses, the FAOSTAT item 394 extract and `retrieved.json` with download dates |

The 32 MB FAOSTAT bulk zip is not committed; the build script downloads it to `sources/faostat-qcl.zip` when needed.

## Preview

```sh
python3 -m http.server 8791
```

Open <http://127.0.0.1:8791/>. The page uses an ES module and `fetch`, so it must be served over HTTP.

## Updating for a new year

FAOSTAT usually adds a year in December. UN Comtrade fills in over the following year as countries report. Use the latest year that both sources cover well.

1. Check FAOSTAT. The `DateUpdate` of the QCL entry in <https://bulks-faostat.fao.org/production/datasets_E.json> shows when the bulk file last changed. After building (step 3), the script prints how many countries FAOSTAT has for the year; 2024 had 126.

2. Check Comtrade coverage. Count the export reporters for the candidate year:

   ```sh
   curl -s "https://comtradeapi.un.org/public/v1/preview/C/A/HS?period=2025&cmdCode=070993&flowCode=X&partnerCode=0" \
     | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['count'], 'reporters')"
   ```

   2024 had 114 reporters. Wait until the new year is close to that and the large exporters (Spain, Mexico, Netherlands, Türkiye, United States) have reported.

3. Build the data:

   ```sh
   python3 scripts/build_data.py --year 2025 --refresh
   ```

   `--refresh` downloads everything again. The anonymous Comtrade preview API rate-limits requests; the script waits and retries, and a full run takes about three minutes. The script stops if a self-check fails (duplicate rows, gaps in ranks, aggregates in the rankings, shares that do not add up). Read its output:

   - the top 10 lists;
   - "Joined with different names": every pair must be the same place. Add a code to `M49_TO_COMTRADE` if FAO and Comtrade use different codes for a country, and a short name to `SHORT_NAMES` if a name is too long for the charts;
   - "Largest non-reporters by partner imports": if any value exceeds the 10th exporter, a non-reporting country probably belongs in the top 10. The page states this automatically, but mention it in the text.

4. Point the page at the new file. In `index.html`, replace every `pumpkins-2024.json` reference (the `data-src` on `<main>`, the `<noscript>` link and the methodology link), and change `period=2024` in the Comtrade API link. Find them with `grep -n 2024 index.html`. Also update:

   - the year and percentages in the `description`, `og:description` and `twitter:description` meta tags;
   - the `© 2026` footer year if needed.

   The lede, chapter text, charts, tables, country card, "Shown by the data" list and most of the methodology fill in from the JSON.

5. Re-read the fixed prose. The title of the opening share chart ("China and India grew almost half… Spain and Mexico sold about two-thirds…") and "Possible reasons (not tested)" name India, China, Mexico and Spain. If the top two growers or exporters change, or their shares move away from half and two-thirds, rewrite them. Update the "Results" table and "Method" figures in this README.

6. Check the page locally at desktop and phone widths, and that the browser console has no errors.

7. Replace `og.jpg` with a 1200 × 630 screenshot of the title and share bars, then bump `og.jpg?v=` in the two image meta tags.

8. Bump the `?v=` query on `styles.css`, `js/app.js` and the data file in `index.html` whenever those files change. Cloudflare caches static files for 31 days, including 404s, and the version query is the only way to force a refresh.

9. Commit, push and deploy (below). Keep old `data/pumpkins-<year>.json` files; they are the previous editions.

## Deployment

The site is static. Upload `index.html`, `styles.css`, `og.jpg`, `js/` and `data/` to `projects/halloween-who-rules-the-pumpkin-world/` in the `danielpradilla.info` document root, using the DreamHost deployment workflow. `scripts/` and `sources/` are not published.

- Upload assets first and `index.html` last.
- Do not use `rsync --delete`.
- Directories must be `755` and files `644`; fix them over SSH after uploading.
- After deploying, compare the size of each live asset (with its `?v=` query) with the local file, then load the page in a browser.
- Keep `data-cfasync="false"` on the `<script type="module">` tag. Without it, Cloudflare Rocket Loader rewrites the module script's type.

## Attribution

Data: FAO, FAOSTAT; United Nations, UN Comtrade database. Follow each source's terms when reusing the data in `data/` and `sources/raw/`.
