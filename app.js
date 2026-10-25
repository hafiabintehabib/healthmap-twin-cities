/* =========================================================
   HealthMap Twin Cities — API-based Web GIS
   Data: OpenStreetMap via Overpass API (no API key required)
   ========================================================= */

// ---------- Configuration ----------
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",          // main instance
  "https://overpass.kumi.systems/api/interpreter",    // mirror (fallback)
];

// Islamabad + Rawalpindi bounding box: [south, west, north, east]
const STUDY_BBOX = [33.45, 72.80, 33.80, 73.30];

const VIEWS = {
  islamabad:  { center: [33.6938, 73.0652], zoom: 12 },
  rawalpindi: { center: [33.5973, 73.0479], zoom: 13 },
  both:       { center: [33.6300, 73.0600], zoom: 11 },
};

const CATEGORIES = {
  hospital:   { label: "Hospitals", one: "Hospital",  color: "#d64545", icon: "H"  },
  clinic:     { label: "Clinics", one: "Clinic",    color: "#2f80ed", icon: "C"  },
  pharmacy:   { label: "Pharmacies", one: "Pharmacy", color: "#27ae60", icon: "Rx" },
  doctors:    { label: "Doctors", one: "Doctor",    color: "#9b51e0", icon: "Dr" },
  dentist:    { label: "Dentists", one: "Dentist",   color: "#f2994a", icon: "De" },
  laboratory: { label: "Labs", one: "Laboratory",       color: "#0e9f9f", icon: "L"  },
};

const REQUEST_TIMEOUT_MS = 60000;
const MAX_LIST_ITEMS = 200;

// ---------- State ----------
const state = {
  features: [],                                   // parsed facilities
  activeCats: new Set(Object.keys(CATEGORIES)),   // category filter
  query: "",                                      // search text
  inViewOnly: false,                              // location filter
  emergencyOnly: false,
  lastBBox: STUDY_BBOX,
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  search: $("search"),
  chips: $("categoryFilters"),
  inView: $("inView"),
  emergencyOnly: $("emergencyOnly"),
  list: $("resultList"),
  count: $("resultCount"),
  reset: $("resetBtn"),
  loader: $("loader"),
  loaderText: $("loaderText"),
  errorBox: $("errorBox"),
  errorText: $("errorText"),
  retry: $("retryBtn"),
  searchArea: $("searchAreaBtn"),
  legend: $("legend"),
  lastUpdated: $("lastUpdated"),
};

// ---------- Map setup ----------
const map = L.map("map", { zoomControl: true }).setView(VIEWS.both.center, VIEWS.both.zoom);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Data: Overpass API',
}).addTo(map);

L.control.scale({ imperial: false }).addTo(map);

// Study-area outline
L.rectangle(
  [[STUDY_BBOX[0], STUDY_BBOX[1]], [STUDY_BBOX[2], STUDY_BBOX[3]]],
  { color: "#d64545", weight: 1, dashArray: "6 6", fill: false, interactive: false }
).addTo(map);

const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 });
map.addLayer(cluster);

// ---------- 1. Build the Overpass QL query ----------
function buildQuery([s, w, n, e]) {
  const bbox = `${s},${w},${n},${e}`;
  return `
[out:json][timeout:60];
(
  nwr["amenity"~"^(hospital|clinic|pharmacy|doctors|dentist)$"](${bbox});
  nwr["healthcare"~"^(hospital|clinic|pharmacy|doctor|dentist|laboratory)$"](${bbox});
);
out center tags;`;
}

// ---------- 2. Retrieve data with fetch() ----------
async function fetchOverpass(query) {
  let lastError;
  for (const url of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      if (res.status === 429) throw new Error("Too many requests (HTTP 429) — the API is rate-limiting. Wait a minute and retry.");
      if (res.status === 504) throw new Error("The API server timed out (HTTP 504). Try a smaller area.");
      if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
      return await res.json();                       // 3. parse JSON
    } catch (err) {
      lastError = err.name === "AbortError"
        ? new Error("Request timed out after 60 seconds.")
        : err;
      console.warn(`Overpass endpoint failed (${url}):`, lastError.message);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

// ---------- 3. Parse / process the response ----------
function categorize(tags) {
  if (CATEGORIES[tags.amenity]) return tags.amenity;
  const h = tags.healthcare;
  if (h === "doctor") return "doctors";
  if (CATEGORIES[h]) return h;
  return null;
}

function parseElements(json) {
  const seen = new Set();
  const out = [];
  for (const el of json.elements || []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const tags = el.tags || {};
    const cat = categorize(tags);
    const key = `${el.type}/${el.id}`;
    if (lat == null || lon == null || !cat || seen.has(key)) continue;
    seen.add(key);

    const area = [tags["addr:suburb"], tags["addr:district"], tags["addr:city"]].filter(Boolean).join(", ");
    out.push({
      id: key,
      osmType: el.type,
      osmId: el.id,
      lat, lon, cat, tags,
      name: tags.name || tags["name:en"] || `Unnamed ${CATEGORIES[cat].one}`,
      nameUr: tags["name:ur"] || "",
      area,
      emergency: tags.emergency === "yes",
      searchText: [
        tags.name, tags["name:en"], tags["name:ur"], tags.operator,
        tags["healthcare:speciality"], area, tags["addr:street"], CATEGORIES[cat].label,
      ].filter(Boolean).join(" ").toLowerCase(),
    });
  }
  return out;
}

// ---------- 4. Display on Leaflet map ----------
function makeIcon(cat) {
  const c = CATEGORIES[cat];
  return L.divIcon({
    className: "",
    html: `<div class="fac-marker" style="background:${c.color}"><span>${c.icon}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function safeUrl(u) {
  if (!u) return "";
  const url = /^https?:\/\//i.test(u) ? u : "https://" + u;
  return url.replace(/"/g, "%22");
}

// 5. Popup with available attributes
function popupHtml(f) {
  const t = f.tags;
  const c = CATEGORIES[f.cat];
  const addr = [t["addr:housenumber"], t["addr:street"], t["addr:suburb"], t["addr:city"]].filter(Boolean).join(", ");
  const rows = [
    ["Operator", t.operator],
    ["Operator type", t["operator:type"]],
    ["Speciality", t["healthcare:speciality"]],
    ["Emergency", t.emergency],
    ["Beds", t.beds],
    ["Opening hours", t.opening_hours],
    ["Phone", t.phone || t["contact:phone"]],
    ["Address", addr],
  ].filter(([, v]) => v);

  const website = t.website || t["contact:website"];
  return `
    <div class="popup">
      <h3>${esc(f.name)}</h3>
      ${f.nameUr ? `<div class="ur">${esc(f.nameUr)}</div>` : ""}
      <span class="badge" style="background:${c.color}">${c.one}</span>
      ${rows.length ? `<table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join("")}</table>`
                    : `<p style="margin:0;font-size:12px;color:#5f6b7a">No further attributes mapped in OSM.</p>`}
      <div class="links">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lon}" target="_blank" rel="noopener">Directions</a>
        <a href="https://www.openstreetmap.org/${f.osmType}/${f.osmId}" target="_blank" rel="noopener">View on OSM</a>
        ${website ? `<a href="${esc(safeUrl(website))}" target="_blank" rel="noopener">Website</a>` : ""}
      </div>
    </div>`;
}

const markers = new Map(); // id -> L.Marker

function buildMarkers() {
  markers.clear();
  for (const f of state.features) {
    const m = L.marker([f.lat, f.lon], { icon: makeIcon(f.cat), title: f.name });
    m.bindPopup(() => popupHtml(f), { maxWidth: 300 });
    markers.set(f.id, m);
  }
}

// ---------- 6. Filtering (search + category + location) ----------
function getFiltered({ ignoreView = false } = {}) {
  const q = state.query.trim().toLowerCase();
  const bounds = map.getBounds();
  return state.features.filter((f) =>
    state.activeCats.has(f.cat) &&
    (!state.emergencyOnly || f.emergency) &&
    (!q || f.searchText.includes(q)) &&
    (ignoreView || !state.inViewOnly || bounds.contains([f.lat, f.lon]))
  );
}

function render() {
  // Map shows everything that passes search + category filters
  const onMap = getFiltered({ ignoreView: true });
  cluster.clearLayers();
  cluster.addLayers(onMap.map((f) => markers.get(f.id)));

  // List additionally respects the "in current view" filter
  const listed = state.inViewOnly ? getFiltered() : onMap;
  els.count.textContent = `${listed.length.toLocaleString()} ${listed.length === 1 ? "facility" : "facilities"}`;
  renderList(listed);
  renderChips();
}

function renderList(items) {
  els.list.innerHTML = "";
  if (!items.length) {
    els.list.innerHTML = `<li class="empty">No facilities match your filters.</li>`;
    return;
  }
  const sorted = [...items].sort((a, b) =>
    (a.name.startsWith("Unnamed") - b.name.startsWith("Unnamed")) || a.name.localeCompare(b.name)
  );
  const frag = document.createDocumentFragment();
  for (const f of sorted.slice(0, MAX_LIST_ITEMS)) {
    const li = document.createElement("li");
    li.tabIndex = 0;
    li.innerHTML = `
      <span class="dot" style="background:${CATEGORIES[f.cat].color}"></span>
      <div>
        <div class="name">${esc(f.name)}</div>
        <div class="meta">${CATEGORIES[f.cat].label}${f.area ? " · " + esc(f.area) : ""}${f.emergency ? " · Emergency" : ""}</div>
      </div>`;
    const open = () => focusFeature(f);
    li.addEventListener("click", open);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    frag.appendChild(li);
  }
  if (sorted.length > MAX_LIST_ITEMS) {
    const more = document.createElement("li");
    more.className = "more";
    more.textContent = `+ ${sorted.length - MAX_LIST_ITEMS} more — refine your search to see them.`;
    frag.appendChild(more);
  }
  els.list.appendChild(frag);
}

function focusFeature(f) {
  const m = markers.get(f.id);
  cluster.zoomToShowLayer(m, () => m.openPopup());
  if (window.innerWidth <= 760) document.getElementById("map").scrollIntoView({ behavior: "smooth" });
}

function renderChips() {
  const q = state.query.trim().toLowerCase();
  const counts = {};
  for (const f of state.features) {
    if ((!q || f.searchText.includes(q)) && (!state.emergencyOnly || f.emergency)) {
      counts[f.cat] = (counts[f.cat] || 0) + 1;
    }
  }
  els.chips.innerHTML = "";
  for (const [key, c] of Object.entries(CATEGORIES)) {
    const b = document.createElement("button");
    b.className = "chip";
    b.setAttribute("aria-pressed", state.activeCats.has(key));
    b.innerHTML = `<span class="dot" style="background:${c.color}"></span>${c.label}<span class="count">${counts[key] || 0}</span>`;
    b.addEventListener("click", () => {
      state.activeCats.has(key) ? state.activeCats.delete(key) : state.activeCats.add(key);
      render();
    });
    els.chips.appendChild(b);
  }
}

function renderLegend() {
  els.legend.innerHTML =
    "<strong>Legend</strong>" +
    Object.values(CATEGORIES).map((c) => `<div><span class="dot" style="background:${c.color}"></span>${c.label}</div>`).join("");
}

// ---------- 7. Loading & error handling ----------
function setLoading(on, text) {
  els.loader.hidden = !on;
  if (text) els.loaderText.textContent = text;
}
function showError(msg) {
  els.errorText.textContent = msg;
  els.errorBox.hidden = false;
}
function hideError() { els.errorBox.hidden = true; }

async function loadData(bbox = STUDY_BBOX) {
  state.lastBBox = bbox;
  hideError();
  setLoading(true, "Fetching facilities from Overpass API…");
  try {
    const json = await fetchOverpass(buildQuery(bbox));
    setLoading(true, "Processing results…");
    const parsed = parseElements(json);
    if (!parsed.length) {
      showError("The API returned no healthcare facilities for this area. Try another area.");
    }
    state.features = parsed;
    buildMarkers();
    render();
    els.lastUpdated.textContent = ` Retrieved ${new Date().toLocaleString()}` +
      (json.osm3s?.timestamp_osm_base ? ` (OSM data as of ${new Date(json.osm3s.timestamp_osm_base).toLocaleDateString()})` : "") + ".";
  } catch (err) {
    console.error(err);
    const offline = !navigator.onLine ? " You appear to be offline." : "";
    showError(`Could not load data: ${err.message || "network error"}.${offline}`);
  } finally {
    setLoading(false);
  }
}

// ---------- UI events ----------
let debounce;
els.search.addEventListener("input", (e) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { state.query = e.target.value; render(); }, 200);
});

els.inView.addEventListener("change", (e) => { state.inViewOnly = e.target.checked; render(); });
els.emergencyOnly.addEventListener("change", (e) => { state.emergencyOnly = e.target.checked; render(); });

document.querySelectorAll("[data-goto]").forEach((b) =>
  b.addEventListener("click", () => {
    const v = VIEWS[b.dataset.goto];
    map.flyTo(v.center, v.zoom, { duration: 0.8 });
  })
);

els.reset.addEventListener("click", () => {
  state.query = ""; els.search.value = "";
  state.activeCats = new Set(Object.keys(CATEGORIES));
  state.inViewOnly = false; els.inView.checked = false;
  state.emergencyOnly = false; els.emergencyOnly.checked = false;
  render();
});

els.retry.addEventListener("click", () => loadData(state.lastBBox));

// "Search this area" — re-query the API for the current map extent
map.on("moveend", () => {
  els.searchArea.hidden = false;
  const tooFar = map.getZoom() < 11;
  els.searchArea.disabled = tooFar;
  els.searchArea.textContent = tooFar ? "Zoom in to search this area" : "Search this area";
  if (state.inViewOnly) render();
});
els.searchArea.addEventListener("click", () => {
  const b = map.getBounds();
  loadData([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
  els.searchArea.hidden = true;
});

// ---------- Init ----------
renderLegend();
renderChips();
loadData();
