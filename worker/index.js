const PAGE = __PAGE__;

const cityKeys = ["Taipei", "NewTaipei", "Taoyuan", "Taichung"];
const cityLabels = { Taipei: "台北市", NewTaipei: "新北市", Taoyuan: "桃園市", Taichung: "台中市" };
const cache = new Map();

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function count(value) {
  const result = number(value);
  return result === null || result < 0 ? null : result;
}

function feeAmounts(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, " ");
  const hourly = text.match(/(?:每\s*小時|每小時)[^0-9]{0,16}(\d[\d,]*)\s*元?/i)
    || text.match(/(\d[\d,]*)\s*元?\s*\/\s*(?:小時|時)/i);
  const monthly = text.match(/月租(?:金|費|票)?[^0-9]{0,16}(\d[\d,]*)\s*元?/i)
    || text.match(/(\d[\d,]*)\s*元?\s*\/\s*月/i);
  const amount = (match) => match ? number(match[1].replace(/,/g, "")) : null;
  return { hourlyFee: amount(hourly), monthlyFee: amount(monthly) };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xmlRows(xml, tag) {
  const pattern = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, "gi");
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

function xmlValue(block, tag) {
  const pattern = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, "i");
  const value = block.match(pattern)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() || "";
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

async function readText(url) {
  const response = await fetch(url, { headers: { Accept: "application/xml,text/xml,*/*" } });
  if (!response.ok) throw new Error(`來源回應 ${response.status}`);
  return response.text();
}

async function readJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`來源回應 ${response.status}`);
  return response.json();
}

function taipeiLots(descXml, availXml) {
  const availability = new Map(xmlRows(availXml, "PARK").map((row) => [xmlValue(row, "ID"), row]));
  const update = xmlValue(availXml, "UPDATETIME");
  return xmlRows(descXml, "PARK").map((row) => {
    const id = xmlValue(row, "ID");
    const live = availability.get(id) || "";
    const fees = feeAmounts(xmlValue(row, "PAYEX"));
    return {
      id: `tp-${id}`, city: "Taipei", name: xmlValue(row, "NAME"), area: xmlValue(row, "AREA"),
      address: xmlValue(row, "ADDRESS"), ...fees,
      lat: number(xmlValue(row, "Xcod")), lon: number(xmlValue(row, "Ycod")),
      car: count(xmlValue(live, "AVAILABLECAR")), motor: count(xmlValue(live, "AVAILABLEMOTOR")),
      carStatus: number(xmlValue(live, "AVAILABLECAR")) < 0 ? "無即時資料" : "",
      motorStatus: number(xmlValue(live, "AVAILABLEMOTOR")) < 0 ? "無即時資料" : "",
      totalCar: count(xmlValue(row, "TOTALCAR")), totalMotor: count(xmlValue(row, "TOTALMOTOR")), updated: update,
    };
  }).filter((lot) => lot.name && lot.lat && lot.lon);
}

async function fetchTaipei() {
  const base = "https://tcgbusfs.blob.core.windows.net/blobtcmsv";
  const [desc, avail] = await Promise.all([
    readText(`${base}/TCMSV_alldesc.xml`), readText(`${base}/TCMSV_allavailable.xml`),
  ]);
  return taipeiLots(desc, avail);
}

async function pagedDataset(id) {
  const root = `https://data.ntpc.gov.tw/api/datasets/${id}/json`;
  const pages = await Promise.all([0, 1].map((page) => readJson(`${root}?page=${page}&size=1000`)));
  return pages.flat();
}

async function fetchNewTaipei() {
  const [details, live] = await Promise.all([
    pagedDataset("B1464EF0-9C7C-4A6F-ABF7-6BDF32847E68"),
    pagedDataset("e09b35a5-a738-48cc-b0f5-570b67ad9c78"),
  ]);
  const available = new Map(live.map((row) => [String(row.ID), row.AVAILABLECAR]));
  return details.map((row) => {
    const raw = available.get(String(row.ID));
    const remaining = count(raw);
    const fees = feeAmounts(row.PAYEX);
    return {
      id: `nt-${row.ID}`, city: "NewTaipei", name: row.NAME, area: row.AREA, address: row.ADDRESS,
      ...fees, tw97x: number(row.TW97X), tw97y: number(row.TW97Y), lat: null, lon: null,
      car: remaining, carStatus: raw === undefined || number(raw) < 0 ? "無即時資料" : "",
      motor: null, motorStatus: "無即時資料", totalCar: count(row.TOTALCAR), totalMotor: count(row.TOTALMOTOR),
      updated: "新北市政府交通局公開資料",
    };
  }).filter((lot) => lot.name && lot.tw97x && lot.tw97y);
}

async function fetchTaoyuan() {
  const xml = await readText("https://opendata.tycg.gov.tw/api/dataset/f4cc0b12-86ac-40f9-8745-885bddc18f79/resource/0daad6e6-0632-44f5-bd25-5e1de1e9146f/download");
  return xmlRows(xml, "parkingLot").map((row) => {
    const fees = feeAmounts(xmlValue(row, "payGuide"));
    return {
      id: `ty-${xmlValue(row, "parkId")}`, city: "Taoyuan", name: xmlValue(row, "parkName"),
      area: xmlValue(row, "areaName"), address: xmlValue(row, "address"), ...fees,
      lat: number(xmlValue(row, "wgsX")), lon: number(xmlValue(row, "wgsY")),
      car: count(xmlValue(row, "surplusSpace")), motor: null, motorStatus: "無即時資料",
      totalCar: count(xmlValue(row, "totalSpace")), totalMotor: null, updated: "桃園市政府交通局公開資料",
    };
  }).filter((lot) => lot.name && lot.lat && lot.lon);
}

async function fetchTaichung() {
  const rows = await readJson("https://motoretag.taichung.gov.tw/DataAPI/api/ParkingAPIV2/Opendata");
  const status = (value) => ({ G: "有空位", Y: "車位有限", R: "已滿", N: "無資料" }[value] || "無資料");
  const level = (value) => ({ G: "good", Y: "limited", R: "full" }[value] || "");
  return rows.map((row) => ({
    id: `tc-${row.ID}`, city: "Taichung", name: row.Position || "停車場", area: "",
    address: row.KeyWord || "台中市", lat: number(row.Lat), lon: number(row.Lng),
    car: null, motor: null, carStatus: status(row.AvailableCarRGB), carLevel: level(row.AvailableCarRGB),
    motorStatus: status(row.AvailableMotorRGB), motorLevel: level(row.AvailableMotorRGB),
    totalCar: count(row.TotalCar), totalMotor: count(row.TotalMotor), updated: "台中市政府交通局公開資料",
  })).filter((lot) => lot.lat && lot.lon);
}

const fetchers = { Taipei: fetchTaipei, NewTaipei: fetchNewTaipei, Taoyuan: fetchTaoyuan, Taichung: fetchTaichung };
const ttl = { Taipei: 30000, NewTaipei: 120000, Taoyuan: 30000, Taichung: 60000 };
const cityBounds = {
  Taipei: { south: 24.95, west: 121.43, north: 25.22, east: 121.68 },
  NewTaipei: { south: 24.65, west: 121.20, north: 25.33, east: 122.05 },
  Taoyuan: { south: 24.63, west: 120.98, north: 25.13, east: 121.50 },
  Taichung: { south: 23.98, west: 120.42, north: 24.43, east: 120.98 },
};

function intersects(a, b) {
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

function parseBounds(value) {
  const values = (value || "").split(",").map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [south, west, north, east] = values;
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) return null;
  return { south, west, north, east };
}

async function cityLots(city) {
  const cached = cache.get(city);
  if (cached && cached.until > Date.now()) return cached.lots;
  const lots = await fetchers[city]();
  cache.set(city, { lots, until: Date.now() + ttl[city] });
  return lots;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const page = PAGE.replaceAll('"__GOOGLE_MAPS_API_KEY__"', JSON.stringify(env?.GOOGLE_MAPS_API_KEY || ""));
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname !== "/api/parking") return new Response("Not found", { status: 404 });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const boundsParam = url.searchParams.get("bounds");
    const bounds = boundsParam ? parseBounds(boundsParam) : null;
    if (boundsParam && !bounds) return json({ error: "地圖範圍格式錯誤" }, 400);
    const requested = url.searchParams.get("city") || "all";
    const selected = bounds
      ? cityKeys.filter((city) => intersects(bounds, cityBounds[city]))
      : requested === "all" ? cityKeys : [requested];
    if (selected.some((city) => !fetchers[city])) return json({ error: "不支援的縣市" }, 400);
    if (!selected.length) return json({ lots: [], errors: [], updated: new Date().toISOString() });
    const results = await Promise.all(selected.map(async (city) => {
      try { return { city, lots: await cityLots(city) }; }
      catch { return { city, lots: [], error: "官方停車資料暫時無法取得" }; }
    }));
    const errors = results.filter((result) => result.error).map(({ city, error }) => ({ city, error }));
    const lots = results.flatMap((result) => result.lots).filter((lot) => !bounds || lot.lat === null || lot.lat === undefined || (lot.lat >= bounds.south && lot.lat <= bounds.north && lot.lon >= bounds.west && lot.lon <= bounds.east));
    return json({ lots, errors, updated: new Date().toISOString() }, lots.length ? 200 : 502);
  },
};
