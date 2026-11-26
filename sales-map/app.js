/* ==========================================================================
   해밀 영업지도 — app.js
   워킨맵 스타일 방문 영업용 지도 PWA
   - 데이터: 기기 localStorage  (공개 저장소에는 학원 명단을 두지 않습니다)
     · 구글 시트(Apps Script 웹앱) 실시간 연동  · 엑셀/CSV 파일 불러오기
   - 지도: Leaflet + MarkerCluster, 상태별 색깔 핀
   ========================================================================== */
'use strict';

/* ------------------------------- 상수 ------------------------------- */
const APP_VER = 'v1.0';
const STORE_KEY = 'haemil-sales-map-v1';
const SHEET_ID = '1XQNuOVuynd_5AewFeoTtvV51zp8bNlK6BH5L0Vt9lvg';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit';

const STATUSES = [
  { key: '미방문', color: '#3d7cc0' },
  { key: '명함전달', color: '#e07b24' },
  { key: '관심', color: '#0b7a62' },
  { key: '재방문', color: '#7c4dff' },
  { key: '계약완료', color: '#1e3a5f' },
  { key: '제외/거절', color: '#7a8a9c' }
];
const STATUS_ALIAS = {
  '미방문': '미방문', '방문전': '미방문', '신규': '미방문', '': '미방문',
  '명함': '명함전달', '명함전달': '명함전달', '명함 전달': '명함전달',
  '관심': '관심', '관심있음': '관심',
  '재방문': '재방문', '재방문예정': '재방문',
  '계약': '계약완료', '계약완료': '계약완료', '완료': '계약완료',
  '거절': '제외/거절', '제외': '제외/거절', '제외/거절': '제외/거절', '탈락': '제외/거절'
};
const COLUMNS = ['번호', '학원명', '구분', '동', '주소', '우편번호', '전화번호', '분야', '교습계열', '교습과정',
  '정원', '개설일자', '학원지정번호', '영업상태', '방문메모', '위도', '경도'];

const SM_HEAD = {
  no: ['번호'], name: ['학원명', '학원 명', 'name'],
  kind: ['구분'], dong: ['동', '행정동', '법정동'],
  addr: ['주소', '도로명주소', '도로명 주소', '소재지'],
  zip: ['우편번호'], phone: ['전화번호', '전화', '연락처'],
  field: ['분야'], track: ['교습계열'], course: ['교습과정'],
  cap: ['정원'], opened: ['개설일자', '개설 일자', '인가일자'],
  regno: ['학원지정번호', '지정번호', '학원지정 번호'],
  status: ['영업상태', '상태'], memo: ['방문메모', '메모', '비고'],
  lat: ['위도', 'lat', 'latitude'], lng: ['경도', 'lng', 'longitude']
};

const NOWON_CENTER = [37.6542, 127.0769];

/* ------------------------------- 도우미 ------------------------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function toStr(v) { return v == null ? '' : String(v).trim(); }
function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}
function normStatus(v) {
  const s = toStr(v).replace(/\s+/g, '');
  if (STATUS_ALIAS[s]) return STATUS_ALIAS[s];
  for (const k in STATUS_ALIAS) { if (k && s.indexOf(k) >= 0) return STATUS_ALIAS[k]; }
  return '미방문';
}
function statusColor(key) {
  const f = STATUSES.find(s => s.key === key);
  return f ? f.color : '#3d7cc0';
}
function normText(v) { return toStr(v).replace(/\s+/g, '').toLowerCase(); }
function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function fmtInt(n) {
  if (n == null || !isFinite(n) || n === 0) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}
function fmtN(n) {
  if (n == null || !isFinite(n)) return '0';
  return Math.round(n).toLocaleString('ko-KR');
}
function fmtDist(m) {
  if (m == null || !isFinite(m)) return '';
  if (m < 1000) return Math.round(m / 10) * 10 + 'm';
  return (m / 1000).toFixed(m < 10000 ? 1 : 0) + 'km';
}
function haversine(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function agoText(ts) {
  if (!ts) return '';
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return '방금 전';
  const min = Math.round(sec / 60);
  if (min < 60) return min + '분 전';
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + '시간 전';
  const d = new Date(ts);
  return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
}
function toast(msg, ms) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms || 2400);
}
function isRemoteOrLibrary(it) {
  const blob = toStr(it.name) + ' ' + toStr(it.field) + ' ' + toStr(it.course);
  // 독서실·원격교육학원은 방문 영업 대상이 아님 (독서논술 교습소는 그대로 둡니다)
  return blob.indexOf('원격') >= 0 || blob.indexOf('독서실') >= 0;
}

/* ------------------------------- 저장소 ------------------------------- */
const S = {
  items: [],
  cfg: { url: '', token: '', lastSyncAt: 0, lastError: '' },
  prefs: {
    view: 'map', dong: 'all', status: 'all', kind: 'all', sort: 'cap',
    q: '', exRemote: false, lat: null, lng: null, acc: null
  },
  me: null,
  seeded: false,
  syncing: false,
  pickMode: false,
  pickPoint: null
};

function save() {
  const data = {
    v: 1,
    savedAt: Date.now(),
    items: S.items,
    cfg: S.cfg,
    prefs: Object.assign({}, S.prefs, { q: S.prefs.q }),
    seeded: S.seeded
  };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    toast('저장 공간이 부족합니다. 목록을 줄이거나 CSV로 내보내 주세요.', 3600);
    return false;
  }
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch (err) { raw = null; }
  if (raw) {
    try {
      const d = JSON.parse(raw);
      S.items = Array.isArray(d.items) ? d.items.map(normalize).filter(Boolean) : [];
      S.cfg = Object.assign({ url: '', token: '', lastSyncAt: 0, lastError: '' }, d.cfg || {});
      S.prefs = Object.assign(S.prefs, d.prefs || {});
      S.seeded = !!d.seeded;
    } catch (err) { /* 깨진 저장값은 무시하고 새로 시작 */ }
  }
  if (S.prefs.lat != null && S.prefs.lng != null) {
    S.me = { lat: S.prefs.lat, lng: S.prefs.lng, acc: S.prefs.acc };
  }
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = toStr(raw.name);
  if (!name) return null;
  const lat = toNum(raw.lat);
  const lng = toNum(raw.lng);
  const regno = toStr(raw.regno);
  const addr = toStr(raw.addr);
  const rowNum = toNum(raw.row);
  const item = {
    id: toStr(raw.id) || (regno ? 'r' + regno : 'n' + Math.abs(hashCode(normText(name) + '|' + normText(addr)))),
    row: rowNum && rowNum >= 2 ? rowNum : null,
    no: toNum(raw.no),
    name: name,
    kind: toStr(raw.kind) || '학원',
    dong: toStr(raw.dong),
    addr: addr,
    zip: toStr(raw.zip),
    phone: toStr(raw.phone),
    field: toStr(raw.field),
    track: toStr(raw.track),
    course: toStr(raw.course),
    cap: toNum(raw.cap),
    opened: toStr(raw.opened),
    regno: regno,
    status: normStatus(raw.status),
    memo: toStr(raw.memo),
    lat: lat != null ? lat : null,
    lng: lng != null ? lng : null,
    source: toStr(raw.source) || (raw.sample ? 'sample' : 'sheet'),
    sample: !!raw.sample,
    pending: !!raw.pending,
    updatedAt: Number(raw.updatedAt) || 0
  };
  if (item.lat != null && (item.lat < 33 || item.lat > 39.5)) item.lat = null;
  if (item.lng != null && (item.lng < 124 || item.lng > 132)) item.lng = null;
  return item;
}
function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return h;
}
function keyOf(it) {
  const reg = normText(it.regno);
  if (reg) return 'reg:' + reg;
  return 'na:' + normText(it.name) + '|' + normText(it.addr);
}

/* ------------------------------- 예시 핀 ------------------------------- */
function sampleItems() {
  const base = [
    { name: '예시·중계영어학원', kind: '학원', dong: '중계동', addr: '서울특별시 노원구 노원로 100 (중계동)', phone: '02-000-0001', field: '입시.검정 및 보습', course: '보습', cap: 120, lat: 37.6498, lng: 127.0745 },
    { name: '예시·상계수학학원', kind: '학원', dong: '상계동', addr: '서울특별시 노원구 상계로 200 (상계동)', phone: '02-000-0002', field: '입시.검정 및 보습', course: '보습', cap: 240, lat: 37.6605, lng: 127.0662 },
    { name: '예시·공릉예술학원', kind: '학원', dong: '공릉동', addr: '서울특별시 노원구 공릉로 300 (공릉동)', phone: '02-000-0003', field: '예능(대)', course: '음악', cap: 80, lat: 37.6262, lng: 127.0726 },
    { name: '예시·월계보습교습소', kind: '교습소', dong: '월계동', addr: '서울특별시 노원구 월계로 400 (월계동)', phone: '02-000-0004', field: '입시.검정 및 보습', course: '보습', cap: 30, lat: 37.6325, lng: 127.0585 },
    { name: '예시·하계독서실', kind: '교습소', dong: '하계동', addr: '서울특별시 노원구 노원로 500 (하계동)', phone: '', field: '독서실', course: '', cap: 60, lat: 37.6395, lng: 127.0705 }
  ];
  return base.map((b, i) => normalize(Object.assign({}, b, {
    id: 'sample' + (i + 1), source: 'sample', sample: true, status: '미방문', memo: ''
  })));
}

/* ------------------------------- 지도 ------------------------------- */
let map = null;
let cluster = null;
let meMarker = null;
let meCircle = null;
let tempMarker = null;
const markerById = new Map();
const shownIds = new Set();

function pinIcon(item, selected) {
  const color = statusColor(item.status);
  const svg =
    '<svg width="22" height="29" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 .8C5.6.8.5 5.9.5 12.3c0 8.6 11.5 18.9 11.5 18.9s11.5-10.3 11.5-18.9C23.5 5.9 18.4.8 12 .8z" fill="' + color + '" stroke="#ffffff" stroke-width="1.6"/>' +
    '<circle cx="12" cy="12.2" r="4.2" fill="#ffffff"/>' +
    '</svg>';
  return L.divIcon({
    html: svg,
    className: 'pin' + (selected ? ' sel' : ''),
    iconSize: [22, 29],
    iconAnchor: [11, 29],
    popupAnchor: [0, -26]
  });
}

function clusterIcon(c) {
  const n = c.getChildCount();
  const size = n < 10 ? 34 : n < 100 ? 40 : n < 1000 ? 46 : 52;
  const label = n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  return L.divIcon({
    html: '<div class="cluster' + (n < 10 ? ' sm' : '') + '" style="width:' + size + 'px;height:' + size + 'px"><span>' + label + '</span></div>',
    className: '',
    iconSize: [size, size]
  });
}

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true })
    .setView(S.me ? [S.me.lat, S.me.lng] : NOWON_CENTER, S.me ? 15 : 13);

  const attribution = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 기여자';
  const roadLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: attribution
  });
  roadLayer.addTo(map);

  // 한 곳이 막히면 다른 OSM 미러로 자동 전환
  let tileErrors = 0;
  let switched = false;
  roadLayer.on('tileerror', () => {
    tileErrors += 1;
    if (switched || tileErrors < 8) return;
    switched = true;
    map.removeLayer(roadLayer);
    L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', { maxZoom: 19, attribution: attribution }).addTo(map);
  });

  cluster = L.markerClusterGroup({
    chunkedLoading: true,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    removeOutsideVisibleBounds: true,
    maxClusterRadius: 36,
    disableClusteringAtZoom: 16,
    iconCreateFunction: clusterIcon
  });
  map.addLayer(cluster);

  map.on('click', (e) => {
    if (S.pickMode) {
      S.pickPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (tempMarker) map.removeLayer(tempMarker);
      tempMarker = L.marker([S.pickPoint.lat, S.pickPoint.lng], { icon: pinIcon({ status: '관심' }, true) }).addTo(map);
      stopPick();
      openAdd();
      addLocState();
      return;
    }
    closeSheets();
  });

  if (S.me) drawMe();
}

function getMarker(item) {
  if (item.lat == null || item.lng == null) return null;
  let m = markerById.get(item.id);
  if (!m) {
    m = L.marker([item.lat, item.lng], { icon: pinIcon(item, false), title: item.name, keyboard: false });
    m.on('click', () => openDetail(item, true));
    markerById.set(item.id, m);
    m._itemId = item.id;
  }
  return m;
}

function syncMarkers(visible) {
  if (!cluster) return;
  const nextIds = new Set();
  visible.forEach(it => { if (it.lat != null && it.lng != null) nextIds.add(it.id); });
  const toRemove = [];
  const toAdd = [];
  shownIds.forEach(id => { if (!nextIds.has(id)) toRemove.push(id); });
  nextIds.forEach(id => { if (!shownIds.has(id)) toAdd.push(id); });

  if (toRemove.length) {
    const layers = toRemove.map(id => markerById.get(id)).filter(Boolean);
    cluster.removeLayers(layers);
    toRemove.forEach(id => shownIds.delete(id));
  }
  if (toAdd.length) {
    const layers = toAdd.map(id => getMarker(itemById(id))).filter(Boolean);
    cluster.addLayers(layers);
    toAdd.forEach(id => shownIds.add(id));
  }
}

function drawMe() {
  if (!map || !S.me) return;
  const ll = [S.me.lat, S.me.lng];
  if (meMarker) map.removeLayer(meMarker);
  if (meCircle) map.removeLayer(meCircle);
  if (S.me.acc) {
    meCircle = L.circle(ll, {
      radius: Math.min(S.me.acc, 200), color: '#1a7fbf', weight: 1, opacity: .5,
      fillColor: '#1a7fbf', fillOpacity: .12, interactive: false
    }).addTo(map);
  }
  meMarker = L.marker(ll, {
    icon: L.divIcon({ html: '<div class="locdot"></div>', className: '', iconSize: [16, 16], iconAnchor: [8, 8] }),
    interactive: false, zIndexOffset: 800
  }).addTo(map);
}

/* ------------------------------- 필터 ------------------------------- */
function itemById(id) { return S.items.find(it => it.id === id) || null; }

function dongCounts() {
  const m = new Map();
  S.items.forEach(it => {
    const d = it.dong || '미상';
    m.set(d, (m.get(d) || 0) + 1);
  });
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

function statusCounts() {
  const m = new Map(STATUSES.map(s => [s.key, 0]));
  S.items.forEach(it => m.set(it.status, (m.get(it.status) || 0) + 1));
  return m;
}

function filtered() {
  const q = normText(S.prefs.q);
  const dong = S.prefs.dong;
  const status = S.prefs.status;
  const kind = S.prefs.kind;
  const ex = !!S.prefs.exRemote;
  let out = S.items.filter(it => {
    if (ex && isRemoteOrLibrary(it)) return false;
    if (dong !== 'all' && it.dong !== dong) return false;
    if (status !== 'all' && it.status !== status) return false;
    if (kind !== 'all' && it.kind !== kind) return false;
    if (q) {
      const blob = normText(it.name + it.addr + it.course + it.field + it.memo + it.phone + it.dong);
      if (blob.indexOf(q) < 0) return false;
    }
    return true;
  });

  const sort = S.prefs.sort;
  out.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'ko');
    if (sort === 'dist' && S.me) {
      const da = haversine(S.me, a), db = haversine(S.me, b);
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    }
    const ca = a.cap == null ? -1 : a.cap;
    const cb = b.cap == null ? -1 : b.cap;
    if (cb !== ca) return cb - ca;
    return a.name.localeCompare(b.name, 'ko');
  });
  return out;
}

/* ------------------------------- 렌더 ------------------------------- */
function renderChips() {
  const dongs = dongCounts();
  const total = S.items.length;
  let html = '<button class="chip' + (S.prefs.dong === 'all' ? ' on' : '') + '" data-dong="all">전체 <span class="n">' + fmtN(total) + '</span></button>';
  dongs.forEach(([d, n]) => {
    html += '<button class="chip' + (S.prefs.dong === d ? ' on' : '') + '" data-dong="' + esc(d) + '">' + esc(d) + ' <span class="n">' + fmtN(n) + '</span></button>';
  });
  const dongEl = $('#dongChips');
  if (dongEl.dataset.sig !== html) { dongEl.innerHTML = html; dongEl.dataset.sig = html; }

  const sc = statusCounts();
  let shtml = '<button class="chip' + (S.prefs.status === 'all' ? ' on' : '') + '" data-status="all">상태 전체</button>';
  STATUSES.forEach(st => {
    shtml += '<button class="chip' + (S.prefs.status === st.key ? ' on' : '') + '" data-status="' + esc(st.key) + '">' +
      '<span class="sd" style="background:' + st.color + '"></span>' + esc(st.key) +
      ' <span class="n">' + fmtN(sc.get(st.key) || 0) + '</span></button>';
  });
  const stEl = $('#statusChips');
  if (stEl.dataset.sig !== shtml) { stEl.innerHTML = shtml; stEl.dataset.sig = shtml; }

  // 데이터리스트
  const dl = $('#dongList');
  dl.innerHTML = dongs.map(([d]) => '<option value="' + esc(d) + '"></option>').join('');
  const fields = new Set();
  S.items.forEach(it => { if (it.field) fields.add(it.field); });
  $('#fieldList').innerHTML = Array.from(fields).slice(0, 40).map(f => '<option value="' + esc(f) + '"></option>').join('');
}

function renderAll(opts) {
  opts = opts || {};
  const list = filtered();
  $('#countLabel').textContent = fmtN(list.length) + '곳';
  const status = S.cfg.url ? (S.cfg.lastError ? '시트 연결 오류' : '시트 연결됨') : '기기 저장';
  $('#hdrSub').innerHTML = '<span class="' + (S.cfg.url && !S.cfg.lastError ? 'dot-live' : 'dot-off') + '"></span>' +
    esc(status) + ' · ' + fmtN(S.items.length) + '곳';

  renderChips();
  syncMarkers(list);
  renderList(list, opts.resetList !== false);
  renderLegend();
  renderSettingsBadges();
}

let listShown = 60;
function renderList(list, reset) {
  if (reset) listShown = 60;
  const pane = $('#listView');
  if (!list.length) {
    pane.innerHTML = '<div class="list-empty">조건에 맞는 영업처가 없습니다.<br>필터나 검색어를 바꿔 보세요.</div>';
    return;
  }
  const show = list.slice(0, listShown);
  let html = '<div class="list-head"><b>' + fmtN(list.length) + '곳</b><span class="lh-right">' +
    (S.prefs.sort === 'dist' ? '가까운 순' : S.prefs.sort === 'name' ? '이름 순' : '정원 큰 순') +
    (S.me ? ' · 현위치 기준' : '') +
    '<button class="list-add" id="listAdd" type="button">+ 영업처</button></span></div>';

  show.forEach(it => {
    const dist = S.me ? haversine(S.me, it) : null;
    const col = statusColor(it.status);
    html += '<button class="card-item" data-id="' + esc(it.id) + '">' +
      '<span class="ci-bar" style="background:' + col + '"></span>' +
      '<span class="ci-main">' +
        '<span class="ci-top"><span class="ci-name">' + esc(it.name) + '</span>' +
          (dist != null ? '<span class="ci-dist">' + fmtDist(dist) + '</span>' : '') + '</span>' +
        '<span class="ci-meta">' + esc(it.dong || '') + ' · ' + esc(it.kind) + (it.field ? ' · ' + esc(it.field) : '') + '</span>' +
        '<span class="ci-row2">' +
          '<span class="ci-tag" style="background:' + col + '">' + esc(it.status) + '</span>' +
          '<span class="ci-sub">정원 ' + (it.cap ? fmtInt(it.cap) + '명' : '미상') + '</span>' +
          (it.phone ? '<span class="ci-phone">' + esc(it.phone) + '</span>' : '<span class="ci-sub">전화번호 없음</span>') +
        '</span>' +
        (it.memo ? '<span class="ci-memo">' + esc(it.memo) + '</span>' : '') +
      '</span>' +
    '</button>';
  });
  if (list.length > show.length) {
    html += '<button class="list-more" id="listMore">더 보기 (' + fmtN(list.length - show.length) + '곳)</button>';
  }
  pane.innerHTML = html;
}

function renderLegend() {
  const sc = statusCounts();
  $('#legendList').innerHTML = STATUSES.map(s =>
    '<li><span class="sw" style="background:' + s.color + '"></span>' + esc(s.key) +
    '<span class="cnt">' + fmtN(sc.get(s.key) || 0) + '</span></li>').join('');
}

function renderSettingsBadges() {
  const b = $('#syncBadge');
  if (S.cfg.url) {
    b.textContent = S.cfg.lastError ? '오류' : '연결됨';
    b.className = 'badge ' + (S.cfg.lastError ? 'off' : 'on');
  } else {
    b.textContent = '미연동';
    b.className = 'badge';
  }
  const fb = $('#fileBadge');
  const nonSample = S.items.filter(it => !it.sample).length;
  fb.textContent = fmtN(nonSample) + '건';
  const ls = $('#lastSync');
  if (!S.cfg.url) {
    ls.textContent = '엑셀·CSV 파일로도 바로 쓸 수 있습니다.';
  } else if (S.cfg.lastSyncAt) {
    ls.textContent = '마지막 동기화 ' + agoText(S.cfg.lastSyncAt) + ' · ' + fmtN(S.items.filter(i => !i.sample).length) + '곳' +
      (S.cfg.lastError ? ' · ' + S.cfg.lastError : '');
  } else {
    ls.textContent = '연결됨 · 아직 동기화 전입니다.';
  }
  const se = $('#setUrl');
  if (se && document.activeElement !== se) se.value = S.cfg.url || '';
  const st = $('#setToken');
  if (st && document.activeElement !== st) st.value = S.cfg.token || '';
}

/* ------------------------------- 시트 ------------------------------- */
function jsonp(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const name = '__smCb' + Date.now() + Math.floor(Math.random() * 1e5);
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[name]; } catch (e) { window[name] = undefined; }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true; cleanup();
      reject(new Error('응답 시간이 초과됐습니다.'));
    }, timeoutMs || 25000);
    window[name] = (data) => {
      if (settled) return;
      settled = true; cleanup(); resolve(data);
    };
    script.onerror = () => {
      if (settled) return;
      settled = true; cleanup();
      reject(new Error('웹 앱에 연결하지 못했습니다. 배포(액세스: 모든 사용자)와 주소를 확인해 주세요.'));
    };
    script.async = true;
    script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + name;
    document.body.appendChild(script);
  });
}

function api(action, payload) {
  if (!S.cfg.url) return Promise.reject(new Error('시트 연동 주소가 없습니다.'));
  const p = new URLSearchParams();
  p.set('action', action);
  if (S.cfg.token) p.set('t', S.cfg.token);
  if (payload) p.set('data', JSON.stringify(payload));
  p.set('_', String(Date.now()));
  const url = S.cfg.url + (S.cfg.url.indexOf('?') >= 0 ? '&' : '?') + p.toString();
  return jsonp(url).then(res => {
    if (!res || res.ok !== true) throw new Error((res && res.error) || '시트가 오류를 돌려보냈습니다.');
    return res;
  });
}

function remoteToItem(r) {
  return normalize({
    row: r.row, no: r.no, name: r.name, kind: r.kind, dong: r.dong, addr: r.addr, zip: r.zip,
    phone: r.phone, field: r.field, track: r.track, course: r.course, cap: r.cap, opened: r.opened,
    regno: r.regno, status: r.status, memo: r.memo, lat: r.lat, lng: r.lng, source: 'sheet'
  });
}

function applyRemote(it, rem) {
  it.no = rem.no; it.name = rem.name; it.kind = rem.kind; it.dong = rem.dong;
  it.addr = rem.addr; it.zip = rem.zip; it.phone = rem.phone; it.field = rem.field;
  it.track = rem.track; it.course = rem.course; it.cap = rem.cap; it.opened = rem.opened;
  it.regno = rem.regno; it.status = rem.status; it.memo = rem.memo;
  if (rem.lat != null) it.lat = rem.lat;
  if (rem.lng != null) it.lng = rem.lng;
  it.row = rem.row; it.pending = false; it.sample = false; it.source = 'sheet';
}

function mergeRemote(rows) {
  const remotes = (rows || []).map(remoteToItem).filter(Boolean).filter(r => r.row && r.row >= 2);
  const byRow = new Map(remotes.map(r => [r.row, r]));
  const byKey = new Map();
  remotes.forEach(r => { if (!byKey.has(keyOf(r))) byKey.set(keyOf(r), r); });

  const claimed = new Set();
  const next = [];

  S.items.forEach(it => {
    if (it.sample) { if (!remotes.length) next.push(it); return; }

    let rem = it.row ? byRow.get(it.row) : null;
    if (rem && claimed.has(rem.row)) rem = null;
    if (!rem) rem = byKey.get(keyOf(it)) || null;
    if (rem && claimed.has(rem.row)) rem = null;

    if (rem) {
      claimed.add(rem.row);
      if (it.pending) {
        it.row = rem.row;          // 행 번호만 맞춰 두고, 앱에서 고친 값은 그대로 둡니다(아래에서 push)
        next.push(it);
      } else {
        applyRemote(it, rem);
        next.push(it);
      }
      return;
    }

    // 시트에 없는 항목
    if (it.pending) { it.row = null; next.push(it); return; }
    if (it.source === 'file' || it.source === 'local') return;   // 파일로만 불러온 목록은 시트 기준으로 정리
    if (it.row) return;                                           // 시트에서 지워진 행
    next.push(it);
  });

  remotes.forEach(r => { if (!claimed.has(r.row)) next.push(r); });

  S.items = next;
}

function pushPending() {
  let ops = 0;
  return (async () => {
    const list = S.items.slice();
    for (const it of list) {
      if (it.sample) continue;
      if (!it.pending) continue;
      const payload = {
        name: it.name, kind: it.kind, dong: it.dong, addr: it.addr, zip: it.zip,
        phone: it.phone, field: it.field, track: it.track, course: it.course,
        cap: it.cap, opened: it.opened, regno: it.regno,
        status: it.status, memo: it.memo, lat: it.lat, lng: it.lng
      };
      if (it.row) {
        try {
          await api('update', { row: it.row, item: payload });
        } catch (err) {
          it.row = null;
        }
      }
      if (!it.row) {
        const res = await api('append', { item: payload });
        it.row = Number(res.row) || null;
      }
      it.pending = false;
      it.source = 'sheet';
      ops += 1;
      save();
    }
    return ops;
  })();
}

let syncBusy = false;
let syncAgain = false;

function syncNow(opts) {
  opts = opts || {};
  if (!S.cfg.url) { openSettings(); return Promise.resolve(false); }
  if (syncBusy) { syncAgain = true; return Promise.resolve(false); }
  syncBusy = true;
  const btn = $('#btnSync');
  if (btn) btn.classList.add('busy');
  if (opts.verbose) setState('#setState', '시트에서 목록을 받는 중…', '');

  return api('list')
    .then(res => {
      const rows = res.items || [];
      mergeRemote(rows);
      save();
      renderAll();
      if (!opts.verbose) toast(fmtN(rows.length) + '곳을 시트에서 받았습니다.');
      return pushPending().then(ops => {
        S.cfg.lastSyncAt = Date.now();
        S.cfg.lastError = '';
        if (ops) return api('list').then(r2 => { mergeRemote(r2.items || []); return rows.length; });
        return rows.length;
      });
    })
    .then(count => {
      S.cfg.lastSyncAt = Date.now();
      S.cfg.lastError = '';
      save(); renderAll();
      if (opts.verbose) setState('#setState', '연결됐습니다 · ' + fmtN(count) + '곳', 'ok');
      return true;
    })
    .catch(err => {
      S.cfg.lastError = String((err && err.message) || err);
      save(); renderSettingsBadges();
      if (opts.verbose) setState('#setState', S.cfg.lastError, 'err');
      else toast('동기화 실패: ' + S.cfg.lastError, 3600);
      return false;
    })
    .then(v => {
      syncBusy = false;
      if (btn) btn.classList.remove('busy');
      if (syncAgain) { syncAgain = false; return syncNow(opts); }
      return v;
    });
}

let pushTimer = null;
function schedulePush() {
  if (!S.cfg.url || S.cfg.demo) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushPending().then(ops => {
      if (ops) {
        S.cfg.lastSyncAt = Date.now();
        S.cfg.lastError = '';
        save(); renderSettingsBadges();
        toast(ops + '건을 시트에 저장했습니다.');
      }
    }).catch(err => {
      S.cfg.lastError = String((err && err.message) || err);
      save(); renderSettingsBadges();
      toast('시트 저장 실패: ' + S.cfg.lastError, 3600);
    });
  }, 900);
}

function markEdited(it) {
  it.pending = true;
  it.updatedAt = Date.now();
  save();
  schedulePush();
}

/* ------------------------------- 상세 시트 ------------------------------- */
let detailId = null;

function openDetail(item, pan) {
  if (!item) return;
  detailId = item.id;
  const dist = S.me ? haversine(S.me, item) : null;
  const col = statusColor(item.status);
  const phone = toStr(item.phone);
  const tel = phone.replace(/[^0-9+]/g, '');
  const smsBody = encodeURIComponent('안녕하세요, 해밀홈케어 문병철입니다. 학원 에어컨 청소 관련해 연락드렸습니다.');
  const nmap = 'nmap://search?query=' + encodeURIComponent(item.name) + '&appname=com.haemil.salesmap';
  const kmap = 'kakaomap://look?p=' + (item.lat != null ? item.lat + ',' + item.lng : '') ;
  const tmap = 'tmap://route?goalname=' + encodeURIComponent(item.name) +
    (item.lat != null ? '&goalx=' + item.lng + '&goaly=' + item.lat : '');

  let h = '';
  h += '<div class="d-top"><h2>' + esc(item.name) + '</h2>' +
    '<button class="xbtn" type="button" data-close aria-label="닫기">×</button></div>';
  h += '<div class="d-badges">' +
    '<span class="badge-p status" style="background:' + col + '">' + esc(item.status) + '</span>' +
    '<span class="badge-p">' + esc(item.kind) + '</span>' +
    (item.dong ? '<span class="badge-p">' + esc(item.dong) + '</span>' : '') +
    '<span class="badge-p">정원 ' + (item.cap ? fmtInt(item.cap) + '명' : '미상') + '</span>' +
    (item.sample ? '<span class="badge-p">예시</span>' : '') +
    (dist != null ? '<span class="badge-p">' + fmtDist(dist) + '</span>' : '') +
    '</div>';

  h += '<div class="d-actions">' +
    (phone
      ? '<a class="btn primary" href="tel:' + esc(tel) + '">전화 걸기</a>' +
        '<a class="btn ghost" href="sms:' + esc(tel) + '?body=' + smsBody + '">문자</a>'
      : '<button class="btn ghost" type="button" disabled>전화번호 없음</button>') +
    '</div>';
  h += '<div class="nav-row">' +
    '<a class="btn ghost" href="' + esc(nmap) + '">네이버지도</a>' +
    '<a class="btn ghost" href="' + esc(kmap) + '">카카오맵</a>' +
    '<a class="btn ghost" href="' + esc(tmap) + '">티맵</a>' +
    '</div>';

  h += '<div class="d-info">';
  h += '<div class="d-line"><span class="k">주소</span><span class="v">' + esc(item.addr || '—') + '</span></div>';
  if (item.field || item.track || item.course) {
    h += '<div class="d-line"><span class="k">분야</span><span class="v">' +
      esc([item.field, item.track, item.course].filter(Boolean).join(' · ')) + '</span></div>';
  }
  if (item.opened || item.regno) {
    h += '<div class="d-line"><span class="k">개설</span><span class="v">' +
      esc([item.opened, item.regno ? '지정번호 ' + item.regno : ''].filter(Boolean).join(' · ')) + '</span></div>';
  }
  h += '</div>';

  h += '<div class="d-sec"><h3>영업상태 <span>한 번 누르면 바로 저장</span></h3><div class="status-chips">';
  STATUSES.forEach(st => {
    const on = st.key === item.status;
    h += '<button class="status-chip' + (on ? ' on' : '') + '" type="button" data-status="' + esc(st.key) + '"' +
      (on ? ' style="background:' + st.color + '"' : '') + '>' +
      '<span class="sd" style="background:' + st.color + '"></span>' + esc(st.key) + '</button>';
  });
  h += '</div></div>';

  h += '<div class="d-sec"><h3>전화번호 · 방문메모</h3>' +
    '<label class="field"><span>전화번호</span><input id="dPhone" type="tel" inputmode="tel" value="' + esc(phone) + '"></label>' +
    '<label class="field"><span>방문메모</span><textarea id="dMemo" rows="3" placeholder="예) 원장님 부재 · 수요일 오전 재방문">' + esc(item.memo || '') + '</textarea></label>' +
    '<button class="btn primary wide" type="button" id="dSave">저장</button>' +
    '<p class="state" id="dState">' + (S.cfg.url ? '저장하면 시트에도 반영됩니다.' : '기기에만 저장됩니다. 시트를 연결하면 시트에도 반영됩니다.') + '</p>' +
    '</div>';

  $('#detailBody').innerHTML = h;
  openSheet('detailSheet');

  if (pan && map && item.lat != null) {
    map.setView([item.lat, item.lng], Math.max(map.getZoom(), 16), { animate: true });
  }
  highlightMarker(item.id);
}

function highlightMarker(id) {
  markerById.forEach((m, mid) => {
    const it = itemById(mid);
    if (!it) return;
    const shouldSel = mid === id;
    if (m._sel === shouldSel) return;
    m._sel = shouldSel;
    if (shownIds.has(mid)) m.setIcon(pinIcon(it, shouldSel));
  });
}

function closeDetail() {
  $('#detailSheet').classList.remove('open');
  $('#detailSheet').setAttribute('aria-hidden', 'true');
  hideBackdropIfNone();
  detailId = null;
  highlightMarker(null);
}

/* ------------------------------- 새 영업처 ------------------------------- */
function openAdd() {
  $('#addState').textContent = '';
  openSheet('addSheet');
  setTimeout(() => { const el = $('#addName'); if (el) el.focus(); }, 260);
}

function addLocState() {
  const p = S.pickPoint;
  $('#addLoc').textContent = p
    ? '위치: ' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5)
    : (S.me ? '현위치를 쓰려면 [현위치로]를 누르세요. (' + S.me.lat.toFixed(5) + ', ' + S.me.lng.toFixed(5) + ')' : '위치를 정해 주세요.');
  $('#addLoc').className = 'muted small' + (p ? ' ok' : '');
}

function startPick() {
  closeSheets();
  S.pickMode = true;
  S.pickPoint = null;
  $('#mapHint').hidden = false;
  $('#mapHint').innerHTML = '<b>지도에서 위치를 탭하세요</b> · 취소는 다시 한 번 탭';
  setView('map');
}

function stopPick() {
  S.pickMode = false;
  $('#mapHint').hidden = true;
}

function resetAddForm() {
  ['addName', 'addDong', 'addCap', 'addAddr', 'addPhone', 'addField', 'addCourse', 'addMemo'].forEach(id => {
    const el = $('#' + id);
    if (el) el.value = '';
  });
  $('#addKind').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === 0));
  S.pickPoint = null;
  addLocState();
}

function saveNewItem() {
  const name = toStr($('#addName').value);
  if (!name) { $('#addState').textContent = '학원명을 입력해 주세요.'; $('#addState').className = 'state err'; return; }
  const p = S.pickPoint;
  if (!p) { $('#addState').textContent = '핀 위치를 정해 주세요. [현위치로] 또는 [지도에서 찍기]'; $('#addState').className = 'state err'; return; }

  const kindBtn = $('#addKind').querySelector('button.on');
  const item = normalize({
    id: uid(),
    name: name,
    kind: kindBtn ? kindBtn.dataset.v : '학원',
    dong: toStr($('#addDong').value),
    addr: toStr($('#addAddr').value),
    phone: toStr($('#addPhone').value),
    field: toStr($('#addField').value),
    course: toStr($('#addCourse').value),
    cap: toNum($('#addCap').value),
    memo: toStr($('#addMemo').value),
    status: '미방문',
    lat: p.lat, lng: p.lng,
    source: S.cfg.url ? 'sheet' : 'local',
    pending: true
  });
  if (!item) return;

  S.items.unshift(item);
  save();
  resetAddForm();
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  closeSheets();
  S.prefs.dong = 'all';
  S.prefs.status = 'all';
  renderAll();
  if (map) map.setView([item.lat, item.lng], 17);
  toast(S.cfg.url ? '추가하고 시트에 저장합니다.' : '추가했습니다. (기기 저장)');
  if (S.cfg.url) schedulePush();
  setTimeout(() => openDetail(item, false), 260);
}

/* ------------------------------- 시트/모달 ------------------------------- */
const SHEETS = ['detailSheet', 'settingsSheet', 'addSheet'];

function openSheet(id) {
  SHEETS.forEach(s => {
    const el = $('#' + s);
    if (el) {
      el.classList.toggle('open', s === id);
      el.setAttribute('aria-hidden', s === id ? 'false' : 'true');
    }
  });
  $('#backdrop').hidden = false;
  const t = $('#toast');
  if (t) t.hidden = true;
  document.body.dataset.sheet = id;
}
function closeSheets() {
  SHEETS.forEach(s => {
    const el = $('#' + s);
    if (el) { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); }
  });
  $('#backdrop').hidden = true;
  delete document.body.dataset.sheet;
  if (detailId) { detailId = null; highlightMarker(null); }
  if (S.pickMode) stopPick();
}
function hideBackdropIfNone() {
  if (!$('.sheet.open')) $('#backdrop').hidden = true;
}

function openSettings() {
  setState('#setState', '', '');
  renderSettingsBadges();
  const ss = $('#storeState');
  if (ss) ss.textContent = '';
  openSheet('settingsSheet');
}

function setState(sel, msg, cls) {
  const el = $(sel);
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'state ' + (cls || '');
}

/* ------------------------------- 글자 크기/화면 ------------------------------- */
function setView(view) {
  S.prefs.view = view;
  document.body.dataset.view = view;
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === view));
  if (view === 'map' && map) setTimeout(() => map.invalidateSize(), 60);
  save();
}

/* ------------------------------- 엑셀/CSV ------------------------------- */
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error('불러오지 못했습니다: ' + src));
    document.head.appendChild(s);
  });
}

async function ensureXLSX() {
  if (window.XLSX) return window.XLSX;
  const urls = [
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'
  ];
  for (const u of urls) {
    try { await loadScriptOnce(u); if (window.XLSX) return window.XLSX; } catch (e) { /* 다음 CDN */ }
  }
  throw new Error('엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인하거나 CSV로 저장해 불러와 주세요.');
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { q = false; }
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* skip */ }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function headerMap(header) {
  const idx = {};
  const norm = header.map(h => normText(h));
  Object.keys(SM_HEAD).forEach(k => {
    const cands = SM_HEAD[k].map(normText);
    let found = -1;
    for (let i = 0; i < norm.length && found < 0; i++) {
      if (!norm[i]) continue;
      if (cands.indexOf(norm[i]) >= 0) found = i;
    }
    if (found < 0) {
      for (let i = 0; i < norm.length && found < 0; i++) {
        if (!norm[i]) continue;
        if (cands.some(c => c.length > 1 && norm[i].indexOf(c) >= 0)) found = i;
      }
    }
    idx[k] = found;
  });
  return idx;
}

function rowsToItems(rows) {
  if (!rows || !rows.length) return [];
  let headRow = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if (rows[i].some(c => normText(c) === '학원명')) { headRow = i; break; }
  }
  if (headRow < 0) headRow = 0;
  const map = headerMap(rows[headRow]);
  if (map.name < 0) return [];

  const out = [];
  for (let r = headRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = toStr(row[map.name]);
    if (!name) continue;
    const pick = k => (map[k] >= 0 ? row[map[k]] : '');
    const item = normalize({
      name: name,
      kind: toStr(pick('kind')) || '학원',
      dong: toStr(pick('dong')),
      addr: toStr(pick('addr')),
      zip: toStr(pick('zip')),
      phone: toStr(pick('phone')),
      field: toStr(pick('field')),
      track: toStr(pick('track')),
      course: toStr(pick('course')),
      cap: toNum(pick('cap')),
      opened: toStr(pick('opened')),
      regno: toStr(pick('regno')),
      status: toStr(pick('status')) || '미방문',
      memo: toStr(pick('memo')),
      lat: toNum(pick('lat')),
      lng: toNum(pick('lng')),
      no: toNum(pick('no')),
      source: 'file'
    });
    if (item) out.push(item);
  }
  return out;
}

async function importFile(file) {
  if (!file) return;
  setState('#fileState', '파일을 읽는 중…', '');
  try {
    let rows;
    const isCsv = /\.csv$/i.test(file.name);
    if (isCsv && !window.XLSX) {
      const text = await file.text();
      rows = parseCSV(text.replace(/^\uFEFF/, ''));
    } else {
      const XLSX = await ensureXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetName = wb.SheetNames.indexOf('학원목록') >= 0 ? '학원목록' : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    }
    const items = rowsToItems(rows);
    if (!items.length) {
      setState('#fileState', '학원명 열을 찾지 못했습니다. 머리글에 “학원명”이 있는 파일인지 확인해 주세요.', 'err');
      return;
    }
    const withPos = items.filter(i => i.lat != null && i.lng != null).length;
    S.items = items;
    S.prefs.dong = 'all';
    S.prefs.status = 'all';
    S.prefs.kind = 'all';
    S.prefs.q = '';
    save();
    renderAll();
    fitToItems();
    setState('#fileState', fmtN(items.length) + '곳을 불러왔습니다. (지도 표시 ' + fmtN(withPos) + '곳)', 'ok');
    toast(fmtN(items.length) + '곳을 불러왔습니다.');
    $('#fileInput').value = '';
  } catch (err) {
    setState('#fileState', String((err && err.message) || err), 'err');
  }
}

function fitToItems() {
  if (!map) return;
  const pts = S.items.filter(i => i.lat != null && i.lng != null).map(i => [i.lat, i.lng]);
  if (!pts.length) return;
  try {
    map.fitBounds(L.latLngBounds(pts).pad(0.08), { animate: false });
    // 동네 단위는 너무 멀리 보이므로 최소 13단계까지만 축소합니다.
    if (map.getZoom() < 13) map.setZoom(13, { animate: false });
    if (map.getZoom() > 16) map.setZoom(16, { animate: false });
  } catch (e) { /* ignore */ }
}

function exportCSV() {
  const rows = [COLUMNS];
  const list = filtered();
  list.forEach(it => {
    rows.push([it.no == null ? '' : it.no, it.name, it.kind, it.dong, it.addr, it.zip, it.phone,
      it.field, it.track, it.course, it.cap == null ? '' : it.cap, it.opened, it.regno,
      it.status, it.memo, it.lat == null ? '' : it.lat, it.lng == null ? '' : it.lng]);
  });
  const csv = rows.map(r => r.map(c => {
    const s = String(c == null ? '' : c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const d = new Date();
  const name = '해밀_영업지도_' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.csv';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast(fmtN(list.length) + '곳을 CSV로 내보냈습니다.');
}

async function copyCode() {
  try {
    const res = await fetch('./apps-script-code.txt', { cache: 'no-store' });
    const text = await res.text();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      toast('Code.gs를 복사했습니다. 시트의 Apps Script에 붙여넣으세요.', 3200);
      return;
    }
    throw new Error('클립보드를 쓸 수 없습니다.');
  } catch (err) {
    window.open('./apps-script-code.txt', '_blank');
    toast('코드 파일을 새 창으로 열었습니다. 전체 선택해 복사해 주세요.', 3400);
  }
}

/* ------------------------------- 위치 ------------------------------- */
function locate(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    if (!navigator.geolocation) { toast('이 브라우저에서는 위치를 쓸 수 없습니다.'); resolve(false); return; }
    const btn = $('#btnLocate');
    if (btn) btn.classList.add('busy');
    navigator.geolocation.getCurrentPosition(
      pos => {
        S.me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
        S.prefs.lat = S.me.lat; S.prefs.lng = S.me.lng; S.prefs.acc = S.me.acc;
        save();
        drawMe();
        if (map) map.setView([S.me.lat, S.me.lng], Math.max(map.getZoom(), 15));
        if (btn) { btn.classList.remove('busy'); btn.classList.add('locate-on'); }
        if (opts.thenSort || S.prefs.sort === 'dist') { S.prefs.sort = 'dist'; $('#sortSel').value = 'dist'; }
        renderAll();
        toast('현위치를 잡았습니다. 거리순으로 볼 수 있습니다.');
        resolve(true);
      },
      err => {
        if (btn) btn.classList.remove('busy');
        const msg = err && err.code === 1 ? '위치 권한이 꺼져 있습니다. 브라우저 설정에서 허용해 주세요.' : '위치를 가져오지 못했습니다.';
        toast(msg, 3200);
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });
}

/* ------------------------------- 이벤트 ------------------------------- */
function bind() {
  // 검색
  const q = $('#q');
  let qTimer = null;
  q.value = S.prefs.q || '';
  q.addEventListener('input', () => {
    S.prefs.q = q.value;
    $('#qClear').hidden = !q.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { save(); renderAll(); }, 140);
  });
  $('#qClear').addEventListener('click', () => {
    q.value = ''; S.prefs.q = ''; $('#qClear').hidden = true; save(); renderAll();
  });
  $('#qClear').hidden = !q.value;

  // 칩
  $('#dongChips').addEventListener('click', e => {
    const b = e.target.closest('[data-dong]');
    if (!b) return;
    S.prefs.dong = b.dataset.dong;
    save(); renderAll();
  });
  $('#statusChips').addEventListener('click', e => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    S.prefs.status = b.dataset.status;
    save(); renderAll();
  });

  // 툴바
  const ex = $('#exRemote');
  ex.checked = !!S.prefs.exRemote;
  ex.addEventListener('change', () => { S.prefs.exRemote = ex.checked; save(); renderAll(); });

  const kindSel = $('#kindSel');
  kindSel.value = S.prefs.kind;
  kindSel.addEventListener('change', () => { S.prefs.kind = kindSel.value; save(); renderAll(); });

  const sortSel = $('#sortSel');
  sortSel.value = S.prefs.sort;
  sortSel.addEventListener('change', () => {
    S.prefs.sort = sortSel.value;
    if (S.prefs.sort === 'dist' && !S.me) { locate({ thenSort: true }); return; }
    save(); renderAll();
  });

  // 목록 카드
  $('#listView').addEventListener('click', e => {
    if (e.target.closest('#listAdd')) { resetAddForm(); openAdd(); return; }
    const more = e.target.closest('#listMore');
    if (more) { listShown += 60; renderList(filtered(), false); return; }
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const it = itemById(card.dataset.id);
    if (it) openDetail(it, false);
  });
  $('#listView').addEventListener('scroll', () => {
    const el = $('#listView');
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 320) {
      const list = filtered();
      if (listShown < list.length) { listShown += 60; renderList(list, false); }
    }
  }, { passive: true });

  // 탭
  $$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));

  // 헤더
  $('#btnSync').addEventListener('click', () => {
    if (!S.cfg.url) { openSettings(); toast('먼저 시트를 연결하거나 엑셀을 불러와 주세요.', 2600); return; }
    syncNow({ verbose: false });
  });
  $('#btnSettings').addEventListener('click', openSettings);

  // 지도 위 버튼
  $('#btnLocate').addEventListener('click', () => locate({ thenSort: false }));
  $('#btnAdd').addEventListener('click', () => { resetAddForm(); openAdd(); });

  // 백드롭/닫기
  $('#backdrop').addEventListener('click', closeSheets);
  document.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) closeSheets();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

  // 상세 시트 안 클릭
  $('#detailBody').addEventListener('click', e => {
    const st = e.target.closest('.status-chip');
    if (st && detailId) {
      const it = itemById(detailId);
      if (!it) return;
      const key = st.dataset.status;
      if (it.status === key) return;
      it.status = key;
      markEdited(it);
      renderAll();
      openDetail(it, false);
      toast(key + '(으)로 바꿨습니다' + (S.cfg.url ? ' · 시트에 저장 중' : ''));
      return;
    }
    if (e.target.closest('#dSave') && detailId) {
      const it = itemById(detailId);
      if (!it) return;
      it.phone = toStr($('#dPhone').value);
      it.memo = toStr($('#dMemo').value);
      markEdited(it);
      renderAll();
      setState('#dState', '저장했습니다' + (S.cfg.url ? ' · 시트에 반영 중' : ''), 'ok');
      toast('저장했습니다.');
    }
  });

  // 설정: 시트
  $('#btnCopyCode').addEventListener('click', copyCode);
  $('#btnSaveSync').addEventListener('click', () => {
    const url = toStr($('#setUrl').value);
    const token = toStr($('#setToken').value);
    if (!url) { setState('#setState', '웹 앱 URL을 입력해 주세요.', 'err'); return; }
    if (!/^https?:\/\//i.test(url) || /\/exec\?/i.test(url)) {
      setState('#setState', '웹 앱 URL은 https://script.google.com/macros/s/…/exec 형태여야 합니다.', 'err');
      return;
    }
    S.cfg.url = url;
    S.cfg.token = token;
    S.cfg.lastError = '';
    save();
    setState('#setState', '시트와 연결을 확인하는 중…', '');
    syncNow({ verbose: true });
  });
  $('#btnDisconnect').addEventListener('click', () => {
    S.cfg.url = ''; S.cfg.token = ''; S.cfg.lastError = ''; S.cfg.lastSyncAt = 0;
    save(); renderAll();
    setState('#setState', '연동을 해제했습니다. 기기에 저장된 목록은 그대로 남습니다.', 'ok');
  });

  // 설정: 파일
  $('#btnPickFile').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => importFile(e.target.files && e.target.files[0]));
  $('#btnExport').addEventListener('click', exportCSV);

  // 설정: 지우기
  $('#btnClearSample').addEventListener('click', () => {
    const n = S.items.filter(i => i.sample).length;
    S.items = S.items.filter(i => !i.sample);
    save(); renderAll();
    setState('#storeState', n ? '예시 핀 ' + n + '개를 지웠습니다.' : '지울 예시가 없습니다.', 'ok');
  });
  $('#btnClearAll').addEventListener('click', () => {
    if (!window.confirm('이 기기에 저장된 영업처 목록을 모두 지울까요? 시트는 그대로 남습니다.')) return;
    S.items = [];
    save(); renderAll();
    setState('#storeState', '목록을 비웠습니다. 엑셀을 불러오거나 시트를 연결하세요.', 'ok');
  });

  // 새 영업처
  $('#addKind').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#addKind button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('#btnAddHere').addEventListener('click', () => {
    if (S.me) {
      S.pickPoint = { lat: S.me.lat, lng: S.me.lng };
      addLocState();
      return;
    }
    $('#addLoc').textContent = '현위치를 잡는 중…';
    locate().then(ok => {
      if (ok && S.me) {
        S.pickPoint = { lat: S.me.lat, lng: S.me.lng };
        addLocState();
      } else {
        addLocState();
      }
    });
  });
  $('#btnAddPick').addEventListener('click', startPick);
  $('#btnAddSave').addEventListener('click', saveNewItem);

  // 창 크기
  window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.cfg.url && Date.now() - S.cfg.lastSyncAt > 60000) syncNow({ verbose: false });
  });
}

/* ------------------------------- 시작 ------------------------------- */
function boot() {
  load();
  $('#verLabel').textContent = APP_VER;

  if (!S.items.length && !S.seeded) {
    S.items = sampleItems();
    S.seeded = true;
    save();
  }
  document.body.dataset.view = S.prefs.view || 'map';
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === (S.prefs.view || 'map')));

  initMap();
  bind();
  renderAll();
  if (S.me) $('#btnLocate').classList.add('locate-on');

  if (S.prefs.sort === 'dist' && !S.me) {
    S.prefs.sort = 'cap';
    $('#sortSel').value = 'cap';
  }

  if (S.items.some(i => i.sample) && !S.cfg.url) {
    setTimeout(() => toast('예시 핀 5개입니다. ⚙ 설정에서 엑셀을 불러오면 1,412곳이 표시됩니다.', 3800), 700);
  }

  if (S.cfg.url) {
    setTimeout(() => syncNow({ verbose: false }), 400);
  }

  // PWA: 서비스워커 등록(오프라인·홈 화면 설치)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* file:// 등 */ });
    });
  }
}

// 검증·디버그용 (읽기 전용)
window.__haemil = {
  version: APP_VER,
  count: () => filtered().length,
  total: () => S.items.length,
  markers: () => shownIds.size,
  status: () => S.items.reduce((acc, it) => { acc[it.status] = (acc[it.status] || 0) + 1; return acc; }, {}),
  state: () => ({ items: S.items.length, cfg: Object.assign({}, S.cfg), prefs: Object.assign({}, S.prefs) })
};

document.addEventListener('DOMContentLoaded', boot);
