# HealthMap Twin Cities — API-Based Web GIS Application

**Assignment No. 2 (Theory)** · Department of Remote Sensing & GIS, COMSATS University Islamabad
**Theme:** 2 — Healthcare facilities
**Study area:** Islamabad & Rawalpindi, Pakistan
**Student:** _[Hafia Binte Habib / Reg. FA23-BRG-026]_
**Live demo:** _[GitHub Pages link]_ · **Source code:** _[GitHub repo link]_

---

## 1. Objective

A browser-based Web GIS that retrieves healthcare facilities (hospitals, clinics, pharmacies, doctors, dentists and laboratories) from a public API, processes the JSON response with JavaScript, and displays the features on an interactive Leaflet map with search, filters and pop-ups. No database or backend server is used.

## 2. Study Area

The twin cities of **Islamabad** (Islamabad Capital Territory) and **Rawalpindi** (Punjab) — bounding box **33.45°–33.80° N, 72.80°–73.30° E**. The area is home to over 5 million people and hosts the region's major public and private hospitals (e.g. PIMS, Polyclinic, Shifa International, Holy Family, Benazir Bhutto Hospital). The study-area extent is drawn on the map as a dashed red rectangle.

## 3. API Used

| Item | Detail |
|---|---|
| API | **Overpass API** (read-only query API for OpenStreetMap data) |
| Endpoint (primary) | `https://overpass-api.de/api/interpreter` |
| Endpoint (fallback mirror) | `https://overpass.kumi.systems/api/interpreter` |
| Method | HTTP `POST`, body `data=<Overpass QL query>` |
| Response format | JSON (`[out:json]`) |
| Authentication | None — **no API key**, so nothing secret is exposed in the public code |
| Licence | Data © OpenStreetMap contributors, **ODbL 1.0**; attribution required |
| Usage policy | Free, fair-use: keep requests reasonable (roughly < 10,000 queries/day, < 1 GB/day); heavy users should host their own instance |

**Why this API:** it is free, keyless, covers all of Pakistan, returns standard JSON, and exposes the full set of OSM health tags. Coverage was verified for the study area — the query returns several hundred health facilities in Islamabad–Rawalpindi.

### 3.1 Query (Overpass QL)

```
[out:json][timeout:60];
(
  nwr["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](33.45,72.80,33.80,73.30);
  nwr["healthcare"~"^(hospital|clinic|pharmacy|doctor|dentist|laboratory)$"](33.45,72.80,33.80,73.30);
);
out center tags;
```

- `nwr` = nodes, ways and relations (a hospital may be mapped as a point or as a building outline).
- Two tagging schemes are combined (`amenity=*` and the newer `healthcare=*`) for better coverage.
- `out center tags` returns a single centre coordinate for polygons, plus all attribute tags.

### 3.2 Sample response

```json
{
  "version": 0.6,
  "osm3s": { "timestamp_osm_base": "2026-10-25T08:10:02Z" },
  "elements": [
    {
      "type": "way",
      "id": 123456789,
      "center": { "lat": 33.7046, "lon": 73.0502 },
      "tags": {
        "amenity": "hospital",
        "name": "Pakistan Institute of Medical Sciences",
        "name:ur": "پاکستان انسٹی ٹیوٹ آف میڈیکل سائنسز",
        "emergency": "yes",
        "operator:type": "government",
        "addr:city": "Islamabad"
      }
    }
  ]
}
```
_(Illustrative structure; IDs and values vary.)_

### 3.3 Data fields used

| Field | Meaning | Used for |
|---|---|---|
| `type`, `id` | OSM element type and ID | Unique key, "View on OSM" link |
| `lat` / `lon` | Coordinates of a node | Marker position |
| `center.lat` / `center.lon` | Centre of a way/relation | Marker position for polygons |
| `tags.amenity` / `tags.healthcare` | Facility type | Category, colour, filter |
| `tags.name`, `tags["name:en"]`, `tags["name:ur"]` | Names (English/Urdu) | Popup title, search, list |
| `tags.operator`, `tags["operator:type"]` | Who runs it (e.g. government/private) | Popup, search |
| `tags["healthcare:speciality"]` | Medical speciality | Popup, search |
| `tags.emergency` | Emergency service available | Popup, "emergency only" filter |
| `tags.beds` | Number of beds | Popup |
| `tags.opening_hours` | Opening hours | Popup |
| `tags.phone` / `tags["contact:phone"]` | Phone | Popup |
| `tags.website` / `tags["contact:website"]` | Website | Popup link |
| `tags["addr:*"]` | Street, suburb/sector, city | Popup, search, list |
| `osm3s.timestamp_osm_base` | Date of the OSM data snapshot | "Data as of" note |

## 4. Steps Used to Display the Data

1. **Build the query** — `buildQuery(bbox)` inserts the study-area (or current map-view) bounding box into the Overpass QL template.
2. **Retrieve with `fetch()`** — `fetchOverpass()` sends a `POST` request. An `AbortController` cancels it after 60 s. If the main server fails, the code automatically retries on the mirror.
3. **Parse JSON** — `res.json()` converts the response to a JavaScript object.
4. **Process** — `parseElements()` loops over `elements`, reads coordinates from `lat/lon` or `center`, classifies each feature into one of six categories, removes duplicates, builds a readable name (or "Unnamed Pharmacy" etc.) and a lowercase search string.
5. **Display on Leaflet** — each facility becomes an `L.marker` with a colour-coded `divIcon`; markers are grouped with **Leaflet.markercluster** so hundreds of points stay readable. An OpenStreetMap basemap, scale bar and legend are added.
6. **Popup / info panel** — clicking a marker (or a list item) opens a popup showing all available attributes plus *Directions* (Google Maps), *View on OSM* and *Website* links.
7. **User interaction** — `render()` re-applies filters whenever the user interacts and updates markers, the result list and counts.
8. **Loading & errors** — a spinner overlay shows during requests; errors (timeout, HTTP 429 rate-limit, 504, offline, empty result) appear in a banner with a **Retry** button.

## 5. Features (mapped to requirements)

| # | Requirement | Implementation |
|---|---|---|
| 1 | HTML, CSS, JS website | `index.html`, `style.css`, `app.js` |
| 2 | Documented API | Overpass API — Section 3 |
| 3 | `fetch()` | `fetchOverpass()` |
| 4 | Parse JSON | `res.json()` + `parseElements()` |
| 5 | Leaflet map | Leaflet 1.9.4 + MarkerCluster |
| 6 | Popup on select | `popupHtml()` — attributes + links |
| 7 | User interaction | **Search** (name, sector, speciality, operator), **category filter** chips with live counts, **location filter** (Islamabad / Rawalpindi / Both, "only in current view"), **emergency-only** filter, **"Search this area"** re-queries the API for any map extent, clickable result list |
| 8 | Title, study area, source, attribution | Sidebar header, "Study area" panel, footer + map attribution |
| 9 | Loading & errors | Spinner overlay, error banner, Retry, fallback server, timeout |
| 10 | Published code + demo | GitHub repository + GitHub Pages |

## 6. How to Run / Publish

**Run locally:** open `index.html` in a browser (an internet connection is needed for the API, map tiles and CDN libraries). If your browser blocks local files, run `python -m http.server` in the folder and visit `http://localhost:8000`.

**Publish on GitHub Pages:**
1. Create a public repo (e.g. `healthmap-twin-cities`) and upload `index.html`, `style.css`, `app.js`, `README.md`.
2. Repo **Settings → Pages → Source: Deploy from branch → `main` / root → Save**.
3. After ~1 minute the site is live at `https://<username>.github.io/healthmap-twin-cities/`.

## 7. Limitations

- OpenStreetMap is volunteer-mapped, so some facilities are missing, unnamed or lack attributes (phone, beds, hours).
- Public Overpass servers can be slow or rate-limited at busy times; the app handles this with a fallback server and a Retry button.
- Data shows *mapped* facilities only; it is not an official government register and should not be used for emergencies.

## 8. Data Source & Attribution

Facility data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License (ODbL), retrieved via the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API). Basemap tiles © OpenStreetMap. Mapping library: [Leaflet](https://leafletjs.com) and [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster).
