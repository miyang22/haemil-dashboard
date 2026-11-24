/* ==========================================================================
   해밀홈케어 · 매출·비용 관리 대시보드
   - 모든 기록은 localStorage 에 자동 저장
   - 기종별 대수 × 단가 = 매출 자동 계산
   - 월간 / 분기 / 반기 / 연간 요약, CSV·JSON 내보내기
   ========================================================================== */
'use strict';

/* ------------------------------ 상수 ------------------------------ */
const LS_KEY = 'haemil.dashboard.v1';

const DEFAULT_TYPES = [
  { id: 'wall',      name: '벽걸이',        price: 110000, active: true },
  { id: 'stand',     name: '스탠드',        price: 150000, active: true },
  { id: 'twoinone',  name: '투인원',        price: 190000, active: true },
  { id: 'ceil1',     name: '천장형 1way',   price: 140000, active: true },
  { id: 'ceil4',     name: '천장형 4way',   price: 110000, active: true },
  { id: 'biz',       name: '업소용·기타',   price: 220000, active: true }
];

/* 기본 비용 분류 — 앞의 5개 순서는 예시 기록(seedSample)에서 위치로 참조하므로 바꾸지 않습니다. */
const DEFAULT_CATS = ['약품·자재비', '유류·주차·통행비', '광고·마케팅비', '식대·기타경비', '장비유지비', '커피', '담배'];

/* 이미 앱을 써 오던 기기에 '커피'·'담배' 를 한 번만 더해 주는 마이그레이션 (v2)
   - 한 번 실행한 뒤 표시를 남기므로, 사용자가 나중에 직접 지운 분류는 다시 생기지 않습니다.
   - 기존 기록·직접 만든 분류는 건드리지 않고 이름이 없을 때만 목록 끝에 붙입니다. */
const CAT_MIGRATION_KEY = 'haemil.dashboard.catMigrationV2';
const CAT_MIGRATION_V2_ADD = ['커피', '담배'];

const DEFAULT_MEMOS = ['서울 마포 · 아파트', '경기 성남 · 오피스텔', '서울 송파 · 상가', '인천 연수 · 빌라'];

const PALETTE = ['#0a94b8', '#2fc0ad', '#7cc9e3', '#ef9a54', '#8d7bea', '#e2727f', '#4bb3a5', '#c9a227', '#5b8def', '#b0895f'];

const PERIOD_STEP = { month: 1, quarter: 3, half: 6, year: 12 };
const PERIOD_NAME = { month: '월간', quarter: '분기', half: '반기', year: '연간' };
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const nf = new Intl.NumberFormat('ko-KR');

/* ------------------------------ 유틸 ------------------------------ */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function uid() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function pad2(n) { return String(n).padStart(2, '0'); }
function toStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function makeDateStr(y, m, d) { return y + '-' + pad2(m + 1) + '-' + pad2(d); }
function todayStr() { return toStr(new Date()); }
function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function won(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + nf.format(Math.abs(v)) + '원';
}
function wonPlain(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + nf.format(Math.abs(v));
}
function compactWon(v) {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 100000000) return sign + (a / 100000000).toFixed(1).replace(/\.0$/, '') + '억';
  if (a >= 10000) return sign + Math.round(a / 10000) + '만';
  return sign + String(Math.round(a));
}
function toNum(v, allowNeg) {
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : 0;
  let s = String(v == null ? '' : v).replace(/[^\d-]/g, '');
  if (allowNeg) {
    const neg = s.startsWith('-');
    s = s.replace(/-/g, '');
    return (neg ? -1 : 1) * (parseInt(s, 10) || 0);
  }
  return parseInt(s.replace(/-/g, ''), 10) || 0;
}
function debounce(fn, ms) {
  let t;
  return function () { clearTimeout(t); t = setTimeout(fn, ms); };
}
function monthDays(y, m) { return new Date(y, m + 1, 0).getDate(); }

/* ------------------------------ 데이터 ------------------------------ */
let state = {
  data: null,
  view: { tab: 'summary', type: 'month', y: 0, m: 0 },
  editSale: null,
  editExpense: null
};

function defaultView() {
  const now = new Date();
  return { tab: 'summary', type: 'month', y: now.getFullYear(), m: now.getMonth() };
}

function defaultTypes() { return DEFAULT_TYPES.map(t => ({ ...t })); }
function defaultCats() {
  return DEFAULT_CATS.map(name => ({ id: uid(), name }));
}

/** 예시(샘플) 기록 — 지우기 버튼으로 한 번에 정리할 수 있도록 sample:true 로 표시 */
function seedSample() {
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth();
  const sales = [];
  const expenses = [];

  const pool = [
    { wall: 2, stand: 1 },
    { wall: 3, ceil4: 1 },
    { stand: 2, twoinone: 1 },
    { wall: 1, ceil1: 2 },
    { wall: 2, biz: 1 },
    { stand: 1, twoinone: 1, ceil4: 1 },
    { wall: 4 },
    { ceil4: 3, ceil1: 1 }
  ];
  const memos = ['서울 마포 · 아파트', '경기 성남 · 오피스텔', '서울 송파 · 상가', '인천 연수 · 빌라', '경기 수원 · 주택', '서울 강서 · 아파트'];

  for (let mm = 0; mm <= cm; mm++) {
    const lastDay = mm === cm ? Math.min(now.getDate(), 28) : 28;
    const days = [3, 8, 13, 18, 23, 27].filter(d => d <= lastDay);
    days.forEach((d, i) => {
      const counts = { ...pool[(mm * 2 + i) % pool.length] };
      sales.push({
        id: uid(),
        date: makeDateStr(cy, mm, d),
        counts,
        extra: i === 1 && mm % 2 === 0 ? 30000 : 0,
        adjust: i === 3 ? -20000 : 0,
        memo: memos[(mm + i) % memos.length],
        sample: true,
        updatedAt: Date.now()
      });
    });
  }

  for (let mm = 0; mm <= cm; mm++) {
    const lastDay = mm === cm ? Math.min(now.getDate(), 28) : 28;
    const plan = [
      { cat: 0, day: 4,  amount: 84000 + (mm % 3) * 12000, memo: '세정제·필터 소모품' },
      { cat: 1, day: 11, amount: 62000 + (mm % 4) * 9000,  memo: '주유 및 주차' },
      { cat: 3, day: 19, amount: 28000 + (mm % 2) * 6000,  memo: '현장 식대' }
    ];
    if (mm % 3 === 0) plan.push({ cat: 2, day: 22, amount: 150000, memo: '블로그·플레이스 광고' });
    if (mm % 4 === 1) plan.push({ cat: 4, day: 25, amount: 45000, memo: '호스·노즐 교체' });
    plan.forEach(p => {
      if (p.day > lastDay) return;
      expenses.push({
        id: uid(),
        date: makeDateStr(cy, mm, p.day),
        categoryId: null,
        categoryName: DEFAULT_CATS[p.cat],
        amount: p.amount,
        memo: p.memo,
        sample: true,
        updatedAt: Date.now()
      });
    });
  }

  return { sales, expenses };
}

function freshData() {
  const cats = defaultCats();
  const seed = seedSample();
  // 비용 분류 id 연결
  seed.expenses.forEach(e => {
    const found = cats.find(c => c.name === e.categoryName);
    e.categoryId = found ? found.id : (cats[0] && cats[0].id);
  });
  return {
    version: 1,
    createdAt: Date.now(),
    unitTypes: defaultTypes(),
    expenseCategories: cats,
    memoPresets: DEFAULT_MEMOS.slice(),
    sales: seed.sales,
    expenses: seed.expenses,
    settings: { samplePrices: true },
    ui: defaultView()
  };
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.sales) || !Array.isArray(raw.expenses)) return null;
  const data = {
    version: 1,
    createdAt: raw.createdAt || Date.now(),
    unitTypes: Array.isArray(raw.unitTypes) && raw.unitTypes.length
      ? raw.unitTypes.map(t => ({
          id: String(t.id || uid()),
          name: String(t.name || '기종'),
          price: Math.max(0, toNum(t.price)),
          active: t.active !== false
        }))
      : defaultTypes(),
    expenseCategories: Array.isArray(raw.expenseCategories) && raw.expenseCategories.length
      ? raw.expenseCategories.map(c => ({ id: String(c.id || uid()), name: String(c.name || '분류') }))
      : defaultCats(),
    memoPresets: Array.isArray(raw.memoPresets) ? raw.memoPresets.slice(0, 30).map(String) : [],
    sales: raw.sales.filter(s => s && s.date).map(s => ({
      id: String(s.id || uid()),
      date: String(s.date).slice(0, 10),
      counts: (s.counts && typeof s.counts === 'object') ? s.counts : {},
      extra: toNum(s.extra, true),
      adjust: toNum(s.adjust, true),
      memo: String(s.memo || ''),
      sample: !!s.sample,
      updatedAt: s.updatedAt || Date.now()
    })),
    expenses: raw.expenses.filter(e => e && e.date).map(e => ({
      id: String(e.id || uid()),
      date: String(e.date).slice(0, 10),
      categoryId: e.categoryId == null ? null : String(e.categoryId),
      categoryName: String(e.categoryName || ''),
      amount: Math.max(0, toNum(e.amount)),
      memo: String(e.memo || ''),
      sample: !!e.sample,
      updatedAt: e.updatedAt || Date.now()
    })),
    settings: Object.assign({ samplePrices: false }, raw.settings || {}),
    ui: Object.assign(defaultView(), raw.ui || {})
  };
  return data;
}

/* v2 비용 분류 마이그레이션: 저장된 데이터에 '커피'·'담배' 가 없으면 더한다. */
function migrateCategoriesV2(data) {
  if (!data) return data;
  let done = false;
  try { done = localStorage.getItem(CAT_MIGRATION_KEY) === '1'; } catch (err) { done = false; }
  if (done) return data;

  const names = new Set((data.expenseCategories || []).map(c => c.name));
  let added = 0;
  CAT_MIGRATION_V2_ADD.forEach(name => {
    if (names.has(name)) return;
    data.expenseCategories.push({ id: uid(), name });
    names.add(name);
    added += 1;
  });
  // 분류 목록과 마이그레이션 표시를 바로 함께 저장해, 앱을 곧 닫아도 결과가 남게 합니다.
  try {
    if (added) localStorage.setItem(LS_KEY, JSON.stringify(data));
    localStorage.setItem(CAT_MIGRATION_KEY, '1');
  } catch (err) { /* 저장 불가 환경은 다음 실행에서 다시 시도 */ }
  return data;
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(LS_KEY); } catch (err) { raw = null; }
  if (raw) {
    try {
      const data = normalize(JSON.parse(raw));
      if (data) return migrateCategoriesV2(data);
    } catch (err) {
      console.warn('저장된 데이터를 읽지 못했습니다.', err);
    }
  }
  return migrateCategoriesV2(freshData());
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state.data));
    } catch (err) {
      toast('저장 공간이 부족합니다. JSON 백업 후 오래된 기록을 정리해 주세요.');
    }
  }, 60);
}

function typeById(id) { return state.data.unitTypes.find(t => t.id === id); }
function catById(id) { return state.data.expenseCategories.find(c => c.id === id); }
function catName(exp) {
  const c = exp.categoryId ? catById(exp.categoryId) : null;
  if (c) return c.name;
  return exp.categoryName || '기타';
}
function hasSampleRecords() {
  return state.data.sales.some(s => s.sample) || state.data.expenses.some(e => e.sample);
}

/* ------------------------------ 금액 계산 ------------------------------ */
function saleAmount(sale) {
  let sum = (sale.extra || 0) + (sale.adjust || 0);
  for (const id in (sale.counts || {})) {
    const t = typeById(id);
    const q = toNum(sale.counts[id]);
    if (t) sum += q * t.price;
  }
  return sum;
}
function saleUnits(sale) {
  let n = 0;
  for (const id in (sale.counts || {})) n += toNum(sale.counts[id]);
  return n;
}

/* ------------------------------ 기간 ------------------------------ */
function periodMeta(view) {
  const { type, y, m } = view;
  if (type === 'quarter') {
    const q = Math.floor(m / 3);
    return {
      label: y + '년 ' + (q + 1) + '분기',
      sub: (q * 3 + 1) + '월 ~ ' + (q * 3 + 3) + '월',
      start: new Date(y, q * 3, 1),
      end: new Date(y, q * 3 + 3, 1)
    };
  }
  if (type === 'half') {
    const h = m < 6 ? 0 : 1;
    return {
      label: y + '년 ' + (h ? '하' : '상') + '반기',
      sub: (h * 6 + 1) + '월 ~ ' + (h * 6 + 6) + '월',
      start: new Date(y, h * 6, 1),
      end: new Date(y, h * 6 + 6, 1)
    };
  }
  if (type === 'year') {
    return { label: y + '년', sub: '1월 ~ 12월', start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
  }
  return {
    label: y + '년 ' + (m + 1) + '월',
    sub: (m + 1) + '.1 ~ ' + (m + 1) + '.' + monthDays(y, m),
    start: new Date(y, m, 1),
    end: new Date(y, m + 1, 1)
  };
}

function shiftView(view, dir) {
  const v = { tab: view.tab, type: view.type, y: view.y, m: view.m };
  let m = v.m + dir * PERIOD_STEP[v.type];
  while (m < 0) { m += 12; v.y -= 1; }
  while (m > 11) { m -= 12; v.y += 1; }
  v.m = m;
  return v;
}

function inRange(dateStr, meta) {
  return dateStr >= toStr(meta.start) && dateStr < toStr(meta.end);
}

function periodTotals(view) {
  const meta = periodMeta(view);
  const sales = state.data.sales.filter(s => inRange(s.date, meta));
  const expenses = state.data.expenses.filter(e => inRange(e.date, meta));

  let revenue = 0, units = 0;
  const typeMap = {};
  sales.forEach(s => {
    revenue += saleAmount(s);
    for (const id in (s.counts || {})) {
      const q = toNum(s.counts[id]);
      if (!q) continue;
      units += q;
      if (!typeMap[id]) typeMap[id] = { qty: 0, revenue: 0 };
      typeMap[id].qty += q;
      const t = typeById(id);
      if (t) typeMap[id].revenue += q * t.price;
    }
  });

  let cost = 0;
  const catMap = {};
  expenses.forEach(e => {
    cost += e.amount;
    const name = catName(e);
    catMap[name] = (catMap[name] || 0) + e.amount;
  });

  const profit = revenue - cost;
  return {
    meta, sales, expenses, revenue, cost, profit, units,
    margin: revenue > 0 ? (profit / revenue) * 100 : null,
    typeMap, catMap
  };
}

/* ------------------------------ 토스트 ------------------------------ */
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
}

/* ------------------------------ 탭 ------------------------------ */
function switchTab(tab) {
  state.view.tab = tab;
  state.data.ui = Object.assign({}, state.data.ui, state.view);
  save();
  $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === 'tab-' + tab));
  $$('[data-tab]').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('is-active', on);
    if (b.classList.contains('nav-btn')) b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (tab === 'summary') renderSummary();
  if (tab === 'entry') renderEntry();
  if (tab === 'expense') renderExpense();
  if (tab === 'manage') renderManage();
  window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
}

/* ------------------------------ 요약 렌더 ------------------------------ */
function renderBanner() {
  const el = $('#sampleBanner');
  const sampleData = hasSampleRecords();
  const samplePrices = !!state.data.settings.samplePrices;
  if (!sampleData && !samplePrices) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const parts = [];
  if (sampleData) {
    parts.push('<div><strong>예시 데이터로 시작했습니다.</strong> 앱을 바로 써볼 수 있도록 넣어둔 샘플 기록이에요. 실제 기록으로 시작하려면 지워 주세요.</div>');
  }
  if (samplePrices) {
    parts.push('<div><strong>단가는 초기 예시값입니다.</strong> 관리 탭에서 실제 단가로 바꾸면 금액이 모두 다시 계산됩니다.</div>');
  }
  const actions = [];
  if (sampleData) actions.push('<button type="button" class="btn btn-sm" data-banner="wipe">예시 데이터 지우기</button>');
  if (samplePrices) actions.push('<button type="button" class="btn btn-sm btn-secondary" data-banner="prices">단가 수정하기</button>');
  el.hidden = false;
  el.innerHTML = '<div class="banner-text">' + parts.join('') + '</div><div class="banner-actions">' + actions.join('') + '</div>';
}

function renderPeriodUI() {
  const meta = periodMeta(state.view);
  $('#periodLabel').textContent = meta.label;
  $('#periodSub').textContent = meta.sub;
  $$('#periodType button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.period === state.view.type)));
}

function deltaHtml(cur, prev, kind) {
  if (!prev) return '<span class="delta">이전 기간 기록 없음</span>';
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (!isFinite(pct)) return '<span class="delta">이전 기간 기록 없음</span>';
  const up = pct >= 0;
  let cls = up ? 'up' : 'down';
  if (kind === 'profit') cls = cur < 0 ? 'neg' : (up ? 'up' : 'down');
  const arrow = Math.abs(pct) < 0.05 ? '–' : (up ? '▲' : '▼');
  const prevLabel = { month: '지난달', quarter: '지난 분기', half: '지난 반기', year: '작년' }[state.view.type];
  return '<span class="delta ' + cls + '">' + arrow + ' ' + Math.abs(pct).toFixed(1) + '%</span> <span style="font-weight:600">' + prevLabel + ' 대비</span>';
}

function renderKpis(t) {
  const prev = periodTotals(shiftView(state.view, -1));
  const grid = $('#kpiGrid');
  grid.innerHTML = [
    kpiCard('총 매출', wonPlain(t.revenue), '원', deltaHtml(t.revenue, prev.revenue, 'revenue')),
    kpiCard('총 비용', wonPlain(t.cost), '원', deltaHtml(t.cost, prev.cost, 'expense')),
    kpiCard('순이익', wonPlain(t.profit), '원', deltaHtml(t.profit, prev.profit, 'profit'), t.profit < 0),
    kpiCard('총 작업 대수', wonPlain(t.units), '대',
      t.margin === null
        ? '<span class="delta">기록 없음</span>'
        : '<span class="delta ' + (t.margin >= 0 ? 'up' : 'neg') + '">마진율 ' + t.margin.toFixed(1) + '%</span>')
  ].join('');
}

function kpiCard(label, value, unit, foot, negative) {
  return '<div class="kpi">' +
    '<span class="kpi-label">' + label + '</span>' +
    '<div class="kpi-value' + (negative ? ' is-negative' : '') + '">' + value + '<span class="unit">' + unit + '</span></div>' +
    '<div class="kpi-foot">' + foot + '</div>' +
    '</div>';
}

/* ---- 추이 차트 ---- */
function bucketize() {
  const view = state.view;
  const buckets = [];
  if (view.type === 'month') {
    const days = monthDays(view.y, view.m);
    for (let d = 1; d <= days; d++) {
      buckets.push({ label: String(d), xlabel: (d === 1 || d % 5 === 0) ? String(d) : '', sales: 0, expense: 0 });
    }
    const prefix = view.y + '-' + pad2(view.m + 1) + '-';
    state.data.sales.forEach(s => {
      if (!s.date.startsWith(prefix)) return;
      const d = Number(s.date.slice(8, 10));
      if (buckets[d - 1]) buckets[d - 1].sales += saleAmount(s);
    });
    state.data.expenses.forEach(e => {
      if (!e.date.startsWith(prefix)) return;
      const d = Number(e.date.slice(8, 10));
      if (buckets[d - 1]) buckets[d - 1].expense += e.amount;
    });
  } else {
    const meta = periodMeta(view);
    const from = meta.start.getMonth();
    const to = meta.end.getMonth() === 0 ? 11 : meta.end.getMonth() - 1;
    for (let m = from; m <= to; m++) {
      buckets.push({ label: (m + 1) + '월', xlabel: (m + 1) + '월', month: m, sales: 0, expense: 0 });
    }
    state.data.sales.forEach(s => {
      const [y, m] = s.date.split('-').map(Number);
      if (y !== view.y) return;
      const b = buckets[m - 1 - from];
      if (b) b.sales += saleAmount(s);
    });
    state.data.expenses.forEach(e => {
      const [y, m] = e.date.split('-').map(Number);
      if (y !== view.y) return;
      const b = buckets[m - 1 - from];
      if (b) b.expense += e.amount;
    });
  }
  return buckets;
}

function niceScale(min, max, count) {
  if (min === 0 && max === 0) { max = 10000; }
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const nmin = Math.floor(min / step) * step;
  let nmax = Math.ceil(max / step) * step;
  if (nmax === nmin) nmax = nmin + step;
  return { min: nmin, max: nmax, step };
}

function renderTrend() {
  const el = $('#trendChart');
  const buckets = bucketize();
  const hasData = buckets.some(b => b.sales || b.expense);
  if (!hasData) {
    el.innerHTML = '<div class="chart-empty">이 기간에는 아직 기록이 없습니다.<br>‘매출 입력’에서 첫 기록을 추가해 보세요.</div>';
    return;
  }

  const W = Math.max(300, Math.round(el.clientWidth || 640));
  const narrow = W < 560;
  const H = narrow ? 196 : 258;
  const pad = { t: 16, r: 6, b: narrow ? 24 : 28, l: narrow ? 36 : 46 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const values = [];
  buckets.forEach(b => { values.push(b.sales, b.expense, b.sales - b.expense); });
  const maxV = Math.max(0, ...values);
  const minV = Math.min(0, ...values);
  const scale = niceScale(minV, maxV, narrow ? 3 : 4);
  const y = v => pad.t + ((scale.max - v) / (scale.max - scale.min)) * ih;

  // 가로 눈금
  let grid = '';
  for (let v = scale.min; v <= scale.max + 1; v += scale.step) {
    const yy = y(v);
    grid += '<line x1="' + pad.l + '" y1="' + yy.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + yy.toFixed(1) +
      '" stroke="' + (v === 0 ? '#c8dfe7' : '#eef4f6') + '" stroke-width="1"/>';
    grid += '<text x="' + (pad.l - 6) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end" font-size="' +
      (narrow ? 9.5 : 10.5) + '" fill="#8aa4ae" font-weight="600">' + compactWon(v) + '</text>';
  }

  // 막대 + 순이익 선
  const n = buckets.length;
  const slot = iw / n;
  const barW = Math.max(2.5, Math.min(narrow ? 12 : 18, slot * 0.36));
  const gap = Math.max(0.9, barW * 0.18);
  const zeroY = y(0);

  let bars = '';
  const pts = [];
  buckets.forEach((b, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const gx = cx - (barW * 2 + gap) / 2;
    const net = b.sales - b.expense;
    pts.push([cx, y(net)]);

    // 매출
    const sh = Math.max(b.sales > 0 ? 1.5 : 0, zeroY - y(b.sales));
    if (b.sales > 0) {
      bars += '<rect x="' + gx.toFixed(2) + '" y="' + (zeroY - sh).toFixed(2) + '" width="' + barW.toFixed(2) +
        '" height="' + sh.toFixed(2) + '" rx="1.6" fill="#0a94b8" opacity="0.92"/>';
    }
    // 비용
    const eh = Math.max(b.expense > 0 ? 1.5 : 0, zeroY - y(b.expense));
    if (b.expense > 0) {
      bars += '<rect x="' + (gx + barW + gap).toFixed(2) + '" y="' + (zeroY - eh).toFixed(2) + '" width="' + barW.toFixed(2) +
        '" height="' + eh.toFixed(2) + '" rx="1.6" fill="#ef9a54" opacity="0.92"/>';
    }
    // 툴팁(접근성)
    const tip = b.label + ' · 매출 ' + won(b.sales) + ' · 비용 ' + won(b.expense) + ' · 순이익 ' + won(net);
    bars += '<g><title>' + esc(tip) + '</title><rect x="' + (pad.l + slot * i).toFixed(2) + '" y="' + pad.t +
      '" width="' + slot.toFixed(2) + '" height="' + ih + '" fill="transparent"/></g>';
  });

  // 순이익 선 (막대 뒤쪽에 그려 막대와 겹치지 않게)
  const line = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  let netSvg = '<polyline points="' + line + '" fill="none" stroke="#17a992" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>';
  const dotIdx = n <= 14 ? buckets.map((b, i) => i) : [];
  const dots = dotIdx.map(i => '<circle cx="' + pts[i][0].toFixed(1) + '" cy="' + pts[i][1].toFixed(1) + '" r="3" fill="#fff" stroke="#17a992" stroke-width="2"/>').join('');

  // x축 라벨
  let xlabels = '';
  buckets.forEach((b, i) => {
    if (!b.xlabel && state.view.type === 'month') return;
    const cx = pad.l + slot * i + slot / 2;
    xlabels += '<text x="' + cx.toFixed(1) + '" y="' + (H - (narrow ? 8 : 9)) + '" text-anchor="middle" font-size="' +
      (narrow ? 9 : 10.5) + '" fill="#8aa4ae" font-weight="600">' + esc(b.xlabel || b.label) + '</text>';
  });

  el.innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="presentation">' +
    grid + netSvg + bars + dots + xlabels +
    '</svg>';
}

/* ---- 기종별 ---- */
function renderTypeBreakdown(t) {
  const donutEl = $('#donut');
  const listEl = $('#typeList');
  const entries = Object.keys(t.typeMap)
    .map(id => {
      const type = typeById(id);
      return {
        id,
        name: type ? type.name : '(삭제된 기종)',
        qty: t.typeMap[id].qty,
        revenue: t.typeMap[id].revenue
      };
    })
    .filter(e => e.qty > 0)
    .sort((a, b) => b.qty - a.qty);

  $('#donutNote').textContent = t.units ? '총 ' + nf.format(t.units) + '대' : '';

  if (!entries.length) {
    donutEl.innerHTML = '';
    listEl.innerHTML = '<li class="empty">이 기간 작업 기록이 없습니다.</li>';
    return;
  }

  const size = 176;
  const r = 78;
  const C = 2 * Math.PI * r;
  let offset = 0;
  let circles = '';
  entries.forEach((e, i) => {
    const frac = e.qty / t.units;
    const len = Math.max(0, frac * C - 1.5);
    circles += '<circle cx="100" cy="100" r="' + r + '" fill="none" stroke="' + PALETTE[i % PALETTE.length] +
      '" stroke-width="22" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' +
      (-offset).toFixed(2) + '" transform="rotate(-90 100 100)"/>';
    offset += frac * C;
  });

  donutEl.innerHTML =
    '<svg viewBox="0 0 200 200" width="' + size + '" height="' + size + '" role="img" aria-label="기종별 작업 대수 비중">' +
    '<circle cx="100" cy="100" r="' + r + '" fill="none" stroke="#eef4f6" stroke-width="22"/>' +
    circles +
    '<text x="100" y="96" text-anchor="middle" font-size="30" font-weight="800" fill="#072b35">' + nf.format(t.units) + '</text>' +
    '<text x="100" y="120" text-anchor="middle" font-size="12" font-weight="700" fill="#6b8792">대</text>' +
    '</svg>';

  listEl.innerHTML = entries.map((e, i) => {
    const share = Math.round((e.qty / t.units) * 100);
    return '<li>' +
      '<span class="swatch" style="background:' + PALETTE[i % PALETTE.length] + '"></span>' +
      '<span class="bl-name">' + esc(e.name) + '<span class="bl-sub">' + won(e.revenue) + ' · ' + share + '%</span></span>' +
      '<span class="bl-val">' + e.qty + '대</span>' +
      '</li>';
  }).join('');
}

/* ---- 비용 구성 ---- */
function renderCatBreakdown(t) {
  const el = $('#catList');
  const rows = Object.keys(t.catMap)
    .map(name => ({ name, amount: t.catMap[name] }))
    .sort((a, b) => b.amount - a.amount);
  $('#catNote').textContent = t.cost ? won(t.cost) : '';
  if (!rows.length) {
    el.innerHTML = '<li class="empty">이 기간 비용 기록이 없습니다.</li>';
    return;
  }
  const max = Math.max(...rows.map(r => r.amount));
  el.innerHTML = rows.map(r => {
    const pct = max ? Math.max(4, (r.amount / max) * 100) : 0;
    const share = t.cost ? Math.round((r.amount / t.cost) * 100) : 0;
    return '<li>' +
      '<div class="bl-row"><span class="name">' + esc(r.name) + ' <span class="muted">' + share + '%</span></span>' +
      '<span class="amount">' + won(r.amount) + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill expense" style="width:' + pct + '%"></div></div>' +
      '</li>';
  }).join('');
}

/* ---- 기록 목록 ---- */
function countsText(sale) {
  const parts = [];
  state.data.unitTypes.forEach(t => {
    const q = toNum((sale.counts || {})[t.id]);
    if (q) parts.push(t.name + ' ' + q);
  });
  Object.keys(sale.counts || {}).forEach(id => {
    if (!typeById(id) && toNum(sale.counts[id])) parts.push('기타 ' + toNum(sale.counts[id]));
  });
  return parts.length ? parts.join(' · ') : '대수 없음';
}

function renderSalesLedger(t) {
  const el = $('#salesList');
  const rows = t.sales.slice().sort((a, b) => (a.date === b.date ? (b.updatedAt || 0) - (a.updatedAt || 0) : a.date < b.date ? 1 : -1));
  $('#salesNote').textContent = rows.length ? rows.length + '건 · ' + won(t.revenue) : '';
  if (!rows.length) {
    el.innerHTML = '<li class="empty">이 기간 매출 기록이 없습니다.</li>';
    return;
  }
  el.innerHTML = rows.map(s => {
    const d = parseDate(s.date);
    const extras = [];
    if (s.extra) extras.push('기타 +' + wonPlain(s.extra) + '원');
    if (s.adjust) extras.push('조정 ' + (s.adjust > 0 ? '+' : '') + wonPlain(s.adjust) + '원');
    const sub = [countsText(s)].concat(extras).join(' · ') + (s.memo ? ' · ' + esc(s.memo) : '');
    return '<li>' +
      '<span class="li-date">' + (d.getMonth() + 1) + '.' + d.getDate() + ' (' + WEEKDAY[d.getDay()] + ')'
        + (s.sample ? ' <span class="muted">예시</span>' : '') + '</span>' +
      '<span class="li-amount">' + won(saleAmount(s)) + '</span>' +
      '<span class="li-sub">' + sub + '</span>' +
      '<span class="li-actions">' +
        '<button type="button" data-act="edit-sale" data-id="' + s.id + '">수정</button>' +
        '<button type="button" class="del" data-act="del-sale" data-id="' + s.id + '">삭제</button>' +
      '</span>' +
      '</li>';
  }).join('');
}

function renderExpenseLedger(t) {
  const el = $('#expenseList');
  const rows = t.expenses.slice().sort((a, b) => (a.date === b.date ? (b.updatedAt || 0) - (a.updatedAt || 0) : a.date < b.date ? 1 : -1));
  $('#expenseNote').textContent = rows.length ? rows.length + '건 · ' + won(t.cost) : '';
  if (!rows.length) {
    el.innerHTML = '<li class="empty">이 기간 비용 기록이 없습니다.</li>';
    return;
  }
  el.innerHTML = rows.map(e => {
    const d = parseDate(e.date);
    return '<li>' +
      '<span class="li-date">' + (d.getMonth() + 1) + '.' + d.getDate() + ' (' + WEEKDAY[d.getDay()] + ')'
        + (e.sample ? ' <span class="muted">예시</span>' : '') + '</span>' +
      '<span class="li-amount is-expense">' + won(e.amount) + '</span>' +
      '<span class="li-sub">' + esc(catName(e)) + (e.memo ? ' · ' + esc(e.memo) : '') + '</span>' +
      '<span class="li-actions">' +
        '<button type="button" data-act="edit-expense" data-id="' + e.id + '">수정</button>' +
        '<button type="button" class="del" data-act="del-expense" data-id="' + e.id + '">삭제</button>' +
      '</span>' +
      '</li>';
  }).join('');
}

function renderSummary() {
  renderBanner();
  renderPeriodUI();
  const t = periodTotals(state.view);
  renderKpis(t);
  renderTrend();
  renderTypeBreakdown(t);
  renderCatBreakdown(t);
  renderSalesLedger(t);
  renderExpenseLedger(t);
}

/* ------------------------------ 매출 입력 ------------------------------ */
function renderCountList(values) {
  const list = $('#countList');
  const active = state.data.unitTypes.filter(t => t.active);
  if (!active.length) {
    list.innerHTML = '<li class="empty">사용 중인 기종이 없습니다. 관리 탭에서 기종을 추가해 주세요.</li>';
    return;
  }
  values = values || {};
  list.innerHTML = active.map(t => {
    const q = toNum(values[t.id]);
    return '<li class="count-row" data-type="' + t.id + '">' +
      '<div class="cr-main">' +
        '<span class="cr-name">' + esc(t.name) + '<em class="cr-unit">' + won(t.price) + '</em></span>' +
        '<span class="cr-amount' + (q ? '' : ' is-zero') + '">' + (q ? won(q * t.price) : '0원') + '</span>' +
      '</div>' +
      '<div class="stepper">' +
        '<button type="button" class="step" data-step="-1" aria-label="' + esc(t.name) + ' 1대 줄이기">−</button>' +
        '<input type="text" class="count-input" inputmode="numeric" value="' + q + '" aria-label="' + esc(t.name) + ' 대수">' +
        '<button type="button" class="step" data-step="1" aria-label="' + esc(t.name) + ' 1대 늘리기">+</button>' +
      '</div>' +
      '</li>';
  }).join('');
  updateEntryTotal();
}

function readCounts() {
  const counts = {};
  $$('#countList .count-row').forEach(row => {
    const q = toNum($('.count-input', row).value);
    if (q > 0) counts[row.dataset.type] = q;
  });
  return counts;
}

function updateEntryTotal() {
  let total = 0;
  $$('#countList .count-row').forEach(row => {
    const t = typeById(row.dataset.type);
    const q = toNum($('.count-input', row).value);
    const amount = t ? q * t.price : 0;
    total += amount;
    const el = $('.cr-amount', row);
    if (el) {
      el.textContent = q ? won(amount) : '0원';
      el.classList.toggle('is-zero', !q);
    }
  });
  total += toNum($('#extraSales').value, true) + toNum($('#adjustSales').value, true);
  $('#entryTotal').textContent = won(total);
  return total;
}

function updateEntryPrices() {
  $$('#countList .count-row').forEach(row => {
    const t = typeById(row.dataset.type);
    if (!t) return;
    const unit = $('.cr-unit', row);
    if (unit) unit.textContent = won(t.price);
  });
  updateEntryTotal();
}

function fillSaleForm(sale) {
  state.editSale = sale ? sale.id : null;
  $('#salesDate').value = sale ? sale.date : ($('#salesDate').value || todayStr());
  renderCountList(sale ? sale.counts : {});
  $('#extraSales').value = sale && sale.extra ? wonPlain(sale.extra) : '';
  $('#adjustSales').value = sale && sale.adjust ? wonPlain(sale.adjust) : '';
  $('#salesMemo').value = sale ? sale.memo || '' : '';
  $('#entryTitle').textContent = sale ? '매출 수정' : '매출 입력';
  $('#entrySubmit').textContent = sale ? '수정 저장' : '저장';
  $('#entryMode').textContent = sale ? '기존 기록을 고치는 중' : '';
  $('#entryCancel').hidden = !sale;
  const presetList = $('#memoPresets');
  presetList.innerHTML = state.data.memoPresets.map(m => '<option value="' + esc(m) + '"></option>').join('');
  updateEntryTotal();
}

function renderEntry() {
  if (!state.editSale) fillSaleForm(null);
  else {
    const sale = state.data.sales.find(s => s.id === state.editSale);
    if (sale) fillSaleForm(sale); else fillSaleForm(null);
  }
}

function saveSale(e) {
  if (e) e.preventDefault();
  const date = $('#salesDate').value || todayStr();
  const counts = readCounts();
  const extra = toNum($('#extraSales').value, true);
  const adjust = toNum($('#adjustSales').value, true);
  const memo = $('#salesMemo').value.trim();
  const units = Object.values(counts).reduce((a, b) => a + b, 0);

  if (!units && !extra && !adjust) {
    toast('기종별 대수나 추가 매출을 입력해 주세요.');
    return;
  }

  if (state.editSale) {
    const sale = state.data.sales.find(s => s.id === state.editSale);
    if (sale) {
      Object.assign(sale, { date, counts, extra, adjust, memo, updatedAt: Date.now(), sample: false });
    }
    state.editSale = null;
    save();
    fillSaleForm(null);
    renderSummary();
    toast('수정했습니다 · ' + won(saleAmount({ counts, extra, adjust })));
    return;
  }

  state.data.sales.push({
    id: uid(), date, counts, extra, adjust, memo,
    sample: false, updatedAt: Date.now()
  });
  save();
  const amount = saleAmount({ counts, extra, adjust });
  fillSaleForm(null);
  $('#salesDate').value = date;
  renderSummary();
  toast('저장했습니다 · ' + won(amount));
}

/* ------------------------------ 비용 ------------------------------ */
/** 분류 추가 — 비용 탭 ‘+ 항목 추가’ 와 관리 탭 입력이 함께 씁니다. */
function addExpenseCategory(name) {
  const clean = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: false, reason: 'empty' };
  const dup = state.data.expenseCategories.find(c => c.name.toLowerCase() === clean.toLowerCase());
  if (dup) return { ok: false, reason: 'dup', id: dup.id, name: dup.name };
  const cat = { id: uid(), name: clean };
  state.data.expenseCategories.push(cat);
  save();
  return { ok: true, id: cat.id, name: clean };
}

function setQuickCatOpen(open) {
  const box = $('#catQuickAdd');
  const btn = $('#catQuickToggle');
  if (!box || !btn) return;
  box.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    $('#quickCatName').focus();
  } else {
    $('#quickCatName').value = '';
  }
}

function saveQuickCategory() {
  const input = $('#quickCatName');
  const res = addExpenseCategory(input.value);

  if (!res.ok && res.reason === 'empty') {
    toast('분류 이름을 입력해 주세요.');
    input.focus();
    return;
  }
  if (!res.ok && res.reason === 'dup') {
    buildExpenseCats(res.id);
    setQuickCatOpen(false);
    toast('이미 있는 분류입니다 · ‘' + res.name + '’을(를) 선택했습니다.');
    return;
  }

  buildExpenseCats(res.id);   // 새 분류를 비용 폼에서 바로 선택
  renderManage();            // 관리 탭 목록과 개수도 같이 갱신
  setQuickCatOpen(false);
  $('#expenseCategory').focus();
  toast('‘' + res.name + '’ 분류를 추가했습니다.');
}

function buildExpenseCats(selectedId) {
  const sel = $('#expenseCategory');
  sel.innerHTML = state.data.expenseCategories.map(c =>
    '<option value="' + c.id + '"' + (c.id === selectedId ? ' selected' : '') + '>' + esc(c.name) + '</option>'
  ).join('');
}

function fillExpenseForm(expense) {
  state.editExpense = expense ? expense.id : null;
  $('#expenseDate').value = expense ? expense.date : ($('#expenseDate').value || todayStr());
  buildExpenseCats(expense ? expense.categoryId : (state.data.expenseCategories[0] && state.data.expenseCategories[0].id));
  $('#expenseAmount').value = expense ? wonPlain(expense.amount) : '';
  $('#expenseMemo').value = expense ? expense.memo || '' : '';
  $('#expenseFormTitle').textContent = expense ? '비용 수정' : '비용 입력';
  $('#expenseMode').textContent = expense ? '기존 기록을 고치는 중' : '';
  $('#expenseCancel').hidden = !expense;
}

function renderExpense() {
  if (state.editExpense) {
    const exp = state.data.expenses.find(e => e.id === state.editExpense);
    if (exp) fillExpenseForm(exp); else fillExpenseForm(null);
  } else if (!$('#expenseCategory').options.length) {
    fillExpenseForm(null);
  } else {
    $('#expenseDate').value = $('#expenseDate').value || todayStr();
  }

  const el = $('#expenseAll');
  const rows = state.data.expenses.slice()
    .sort((a, b) => (a.date === b.date ? (b.updatedAt || 0) - (a.updatedAt || 0) : a.date < b.date ? 1 : -1))
    .slice(0, 20);
  const sum = rows.reduce((a, b) => a + b.amount, 0);
  $('#expenseRecentNote').textContent = rows.length ? '최근 ' + rows.length + '건 · ' + won(sum) : '';
  if (!rows.length) {
    el.innerHTML = '<li class="empty">아직 비용 기록이 없습니다.</li>';
    return;
  }
  el.innerHTML = rows.map(e => {
    const d = parseDate(e.date);
    return '<li>' +
      '<span class="li-date">' + e.date.slice(0, 4) + '.' + (d.getMonth() + 1) + '.' + d.getDate() + ' (' + WEEKDAY[d.getDay()] + ')</span>' +
      '<span class="li-amount is-expense">' + won(e.amount) + '</span>' +
      '<span class="li-sub">' + esc(catName(e)) + (e.memo ? ' · ' + esc(e.memo) : '') + (e.sample ? ' · <span class="muted">예시</span>' : '') + '</span>' +
      '<span class="li-actions">' +
        '<button type="button" data-act="edit-expense" data-id="' + e.id + '">수정</button>' +
        '<button type="button" class="del" data-act="del-expense" data-id="' + e.id + '">삭제</button>' +
      '</span>' +
      '</li>';
  }).join('');
}

function saveExpense(e) {
  if (e) e.preventDefault();
  const date = $('#expenseDate').value || todayStr();
  const categoryId = $('#expenseCategory').value;
  const cat = catById(categoryId);
  const amount = toNum($('#expenseAmount').value);
  const memo = $('#expenseMemo').value.trim();

  if (!amount) {
    toast('금액을 입력해 주세요.');
    $('#expenseAmount').focus();
    return;
  }
  if (!cat) {
    toast('비용 분류를 먼저 만들어 주세요.');
    return;
  }

  if (state.editExpense) {
    const exp = state.data.expenses.find(x => x.id === state.editExpense);
    if (exp) Object.assign(exp, { date, categoryId, categoryName: cat.name, amount, memo, updatedAt: Date.now(), sample: false });
    state.editExpense = null;
    fillExpenseForm(null);
    save();
    renderSummary();
    renderExpense();
    toast('비용을 수정했습니다 · ' + won(amount));
    return;
  }

  state.data.expenses.push({
    id: uid(), date, categoryId, categoryName: cat.name, amount, memo,
    sample: false, updatedAt: Date.now()
  });
  save();
  fillExpenseForm(null);
  $('#expenseDate').value = date;
  $('#expenseAmount').value = '';
  $('#expenseMemo').value = '';
  renderSummary();
  renderExpense();
  toast('비용을 저장했습니다 · ' + won(amount));
}

/* ------------------------------ 관리 ------------------------------ */
function renderManage() {
  // 기종
  $('#typeManageList').innerHTML = state.data.unitTypes.map(t => (
    '<li class="manage-row" data-id="' + t.id + '">' +
      '<input type="text" class="m-name" value="' + esc(t.name) + '" aria-label="기종 이름">' +
      '<input type="text" class="m-price money-input" inputmode="numeric" value="' + wonPlain(t.price) + '" aria-label="' + esc(t.name) + ' 단가">' +
      '<span class="m-row-actions">' +
        '<label class="mini-toggle"><input type="checkbox" class="m-active"' + (t.active ? ' checked' : '') + '>사용</label>' +
        '<button type="button" class="mini-del" data-act="del-type" data-id="' + t.id + '" aria-label="' + esc(t.name) + ' 삭제">✕</button>' +
      '</span>' +
    '</li>'
  )).join('');
  $('#priceNote').textContent = state.data.settings.samplePrices ? '예시 단가' : '';

  // 비용 분류
  $('#catManageList').innerHTML = state.data.expenseCategories.map(c => (
    '<li class="manage-row" data-id="' + c.id + '" style="grid-template-columns:minmax(0,1fr) auto">' +
      '<input type="text" class="m-cat" value="' + esc(c.name) + '" aria-label="비용 분류 이름">' +
      '<span class="m-row-actions"><button type="button" class="mini-del" data-act="del-cat" data-id="' + c.id + '" aria-label="' + esc(c.name) + ' 삭제">✕</button></span>' +
    '</li>'
  )).join('');
  $('#catManageNote').textContent = state.data.expenseCategories.length + '개';

  // 메모
  $('#memoChipList').innerHTML = state.data.memoPresets.length
    ? state.data.memoPresets.map((m, i) =>
        '<li>' + esc(m) + '<button type="button" data-act="del-memo" data-i="' + i + '" aria-label="' + esc(m) + ' 삭제">✕</button></li>'
      ).join('')
    : '<li class="empty" style="border:0;background:none;padding:4px 0">등록된 메모가 없습니다.</li>';

  // 데이터
  const sampleN = state.data.sales.filter(s => s.sample).length + state.data.expenses.filter(e => e.sample).length;
  $('#dataNote').textContent = '매출 ' + state.data.sales.length + '건 · 비용 ' + state.data.expenses.length + '건';
  $('#wipeSample').hidden = sampleN === 0;
}

/* ------------------------------ CSV / JSON ------------------------------ */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(arr) { return arr.map(csvCell).join(','); }

function buildCsv(scope) {
  const view = scope === 'all' ? null : state.view;
  const meta = view ? periodMeta(view) : null;
  const sales = meta ? state.data.sales.filter(s => inRange(s.date, meta)) : state.data.sales.slice();
  const expenses = meta ? state.data.expenses.filter(e => inRange(e.date, meta)) : state.data.expenses.slice();
  const types = state.data.unitTypes;

  sales.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  expenses.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  const lines = [];
  lines.push(csvRow(['해밀홈케어 매출·비용', meta ? meta.label : '전체 기간']));
  lines.push(csvRow(['내보낸 날짜', new Date().toLocaleString('ko-KR')]));
  lines.push('');

  lines.push(csvRow(['[매출]']));
  lines.push(csvRow(['날짜'].concat(types.map(t => t.name + ' 대수')).concat(types.map(t => t.name + ' 금액')).concat(['기타 매출', '조정', '합계', '메모'])));
  let tRevenue = 0, tUnits = 0;
  sales.forEach(s => {
    const unitCols = types.map(t => toNum((s.counts || {})[t.id]));
    const amountCols = types.map((t, i) => unitCols[i] * t.price);
    const sum = saleAmount(s);
    tRevenue += sum;
    tUnits += unitCols.reduce((a, b) => a + b, 0);
    lines.push(csvRow([s.date].concat(unitCols).concat(amountCols).concat([s.extra || 0, s.adjust || 0, sum, s.memo || ''])));
  });
  const totalsRow = ['합계'];
  types.forEach(() => totalsRow.push(''));
  types.forEach(() => totalsRow.push(''));
  totalsRow.push('', '', tRevenue, '');
  lines.push(csvRow(totalsRow));
  lines.push('');

  lines.push(csvRow(['[비용]']));
  lines.push(csvRow(['날짜', '분류', '금액', '메모']));
  let tCost = 0;
  expenses.forEach(e => {
    tCost += e.amount;
    lines.push(csvRow([e.date, catName(e), e.amount, e.memo || '']));
  });
  lines.push(csvRow(['합계', '', tCost, '']));
  lines.push('');

  lines.push(csvRow(['[요약]']));
  lines.push(csvRow(['총 매출', tRevenue]));
  lines.push(csvRow(['총 비용', tCost]));
  lines.push(csvRow(['순이익', tRevenue - tCost]));
  lines.push(csvRow(['작업 대수', tUnits]));
  lines.push(csvRow(['마진율(%)', tRevenue ? ((tRevenue - tCost) / tRevenue * 100).toFixed(1) : '']));

  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function download(filename, content, type) {
  const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportCsv(scope) {
  const meta = scope === 'all' ? null : periodMeta(state.view);
  const tag = meta ? meta.label.replace(/\s/g, '') : '전체';
  download('해밀홈케어_매출비용_' + tag + '.csv', buildCsv(scope), 'text/csv;charset=utf-8');
  toast('CSV를 내보냈습니다 · ' + tag);
}

function exportJson() {
  const payload = {
    app: 'haemil-dashboard',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state.data
  };
  const d = new Date();
  download('해밀홈케어_백업_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '.json',
    JSON.stringify(payload, null, 2), 'application/json');
  toast('JSON 백업을 내보냈습니다.');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const raw = parsed && parsed.data ? parsed.data : parsed;
      const data = normalize(raw);
      if (!data) throw new Error('형식이 맞지 않습니다.');
      if (!confirm('지금 기록(' + state.data.sales.length + '건 매출 / ' + state.data.expenses.length + '건 비용)을 불러온 파일로 바꿀까요?\n지금 기록은 사라집니다.')) return;
      state.data = data;
      state.editSale = null;
      state.editExpense = null;
      Object.assign(state.view, {
        type: data.ui.type || 'month',
        y: data.ui.y || new Date().getFullYear(),
        m: typeof data.ui.m === 'number' ? data.ui.m : new Date().getMonth()
      });
      save();
      renderAll();
      toast('불러왔습니다 · 매출 ' + data.sales.length + '건');
    } catch (err) {
      console.error(err);
      toast('불러오지 못했습니다. 백업 파일인지 확인해 주세요.');
    }
  };
  reader.readAsText(file);
}

/* ------------------------------ 이벤트 ------------------------------ */
function renderAll() {
  renderBanner();
  renderPeriodUI();
  switchTab(state.view.tab || 'summary');
  renderSummary();
  renderEntry();
  renderExpense();
  renderManage();
}

function wireEvents() {
  // 탭
  document.addEventListener('click', ev => {
    const tabBtn = ev.target.closest('[data-tab]');
    if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }

    const bannerBtn = ev.target.closest('[data-banner]');
    if (bannerBtn) {
      if (bannerBtn.dataset.banner === 'wipe') wipeSample();
      else if (bannerBtn.dataset.banner === 'prices') { switchTab('manage'); }
      return;
    }

    const act = ev.target.closest('[data-act]');
    if (!act) return;
    const id = act.dataset.id;

    if (act.dataset.act === 'edit-sale') {
      const sale = state.data.sales.find(s => s.id === id);
      if (sale) {
        state.editSale = id;
        switchTab('entry');
        fillSaleForm(sale);
        window.scrollTo({ top: 0 });
      }
    } else if (act.dataset.act === 'del-sale') {
      const sale = state.data.sales.find(s => s.id === id);
      if (!sale) return;
      if (confirm(sale.date + ' 매출 기록(' + won(saleAmount(sale)) + ')을 삭제할까요?')) {
        state.data.sales = state.data.sales.filter(s => s.id !== id);
        if (state.editSale === id) { state.editSale = null; fillSaleForm(null); }
        save();
        renderSummary();
        renderManage();
        toast('삭제했습니다.');
      }
    } else if (act.dataset.act === 'edit-expense') {
      const exp = state.data.expenses.find(x => x.id === id);
      if (exp) {
        state.editExpense = id;
        switchTab('expense');
        fillExpenseForm(exp);
        window.scrollTo({ top: 0 });
      }
    } else if (act.dataset.act === 'del-expense') {
      const exp = state.data.expenses.find(x => x.id === id);
      if (!exp) return;
      if (confirm(exp.date + ' 비용(' + won(exp.amount) + ')을 삭제할까요?')) {
        state.data.expenses = state.data.expenses.filter(x => x.id !== id);
        if (state.editExpense === id) { state.editExpense = null; fillExpenseForm(null); }
        save();
        renderSummary();
        renderExpense();
        renderManage();
        toast('삭제했습니다.');
      }
    } else if (act.dataset.act === 'del-type') {
      deleteType(id);
    } else if (act.dataset.act === 'del-cat') {
      deleteCat(id);
    } else if (act.dataset.act === 'del-memo') {
      state.data.memoPresets.splice(Number(act.dataset.i), 1);
      save();
      renderManage();
      fillSaleForm(null);
    }
  });

  // 기간 단위
  $('#periodType').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-period]');
    if (!b) return;
    state.view.type = b.dataset.period;
    state.data.ui = Object.assign({}, state.data.ui, state.view);
    save();
    renderPeriodUI();
    renderSummary();
  });
  $('#periodPrev').addEventListener('click', () => movePeriod(-1));
  $('#periodNext').addEventListener('click', () => movePeriod(1));
  $('#periodNow').addEventListener('click', () => {
    const now = new Date();
    state.view.y = now.getFullYear();
    state.view.m = now.getMonth();
    state.data.ui = Object.assign({}, state.data.ui, state.view);
    renderPeriodUI();
    renderSummary();
    save();
  });

  // 빠른 입력
  $('#quickEntry').addEventListener('click', () => {
    state.editSale = null;
    switchTab('entry');
    fillSaleForm(null);
    $('#salesDate').value = todayStr();
  });

  // 매출 폼
  $('#salesForm').addEventListener('submit', saveSale);
  $('#countList').addEventListener('click', ev => {
    const btn = ev.target.closest('.step');
    if (!btn) return;
    const row = btn.closest('.count-row');
    const input = $('.count-input', row);
    const next = Math.max(0, Math.min(999, toNum(input.value) + Number(btn.dataset.step)));
    input.value = next;
    updateEntryTotal();
  });
  $('#countList').addEventListener('input', ev => {
    if (!ev.target.classList.contains('count-input')) return;
    const clean = ev.target.value.replace(/[^\d]/g, '').slice(0, 3);
    ev.target.value = clean;
    updateEntryTotal();
  });
  ['#extraSales', '#adjustSales'].forEach(sel => {
    const el = $(sel);
    el.addEventListener('input', () => {
      const v = toNum(el.value, true);
      el.value = v ? wonPlain(v) : (v === 0 && el.value.trim() === '-' ? '-' : (v ? wonPlain(v) : ''));
      updateEntryTotal();
    });
    el.addEventListener('blur', () => {
      const v = toNum(el.value, true);
      el.value = v ? wonPlain(v) : '';
      updateEntryTotal();
    });
  });
  $('#entryCancel').addEventListener('click', () => {
    state.editSale = null;
    fillSaleForm(null);
    $('#salesDate').value = todayStr();
  });

  // 비용 폼
  $('#expenseForm').addEventListener('submit', saveExpense);
  $('#expenseAmount').addEventListener('input', ev => {
    const v = toNum(ev.target.value);
    ev.target.value = v ? wonPlain(v) : '';
  });
  $('#expenseCancel').addEventListener('click', () => {
    state.editExpense = null;
    fillExpenseForm(null);
  });

  // 관리: 기종
  $('#typeManageList').addEventListener('input', ev => {
    const row = ev.target.closest('.manage-row');
    if (!row) return;
    const t = typeById(row.dataset.id);
    if (!t) return;
    if (ev.target.classList.contains('m-name')) {
      t.name = ev.target.value;
      save();
      renderCountListLabels();
    } else if (ev.target.classList.contains('m-price')) {
      const raw = ev.target.value;
      const caretEnd = ev.target.selectionStart === raw.length;
      const v = toNum(raw);
      t.price = v;
      if (caretEnd) ev.target.value = v ? wonPlain(v) : '';
      state.data.settings.samplePrices = false;
      save();
      updateEntryPrices();
    }
  });
  $('#typeManageList').addEventListener('change', ev => {
    const row = ev.target.closest('.manage-row');
    if (!row) return;
    const t = typeById(row.dataset.id);
    if (!t) return;
    if (ev.target.classList.contains('m-active')) {
      t.active = ev.target.checked;
      save();
      renderCountList({});
      renderSummary();
    } else {
      renderSummary();
      renderManage();
    }
  });

  $('#addTypeForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const name = $('#newTypeName').value.trim();
    const price = toNum($('#newTypePrice').value);
    if (!name) { toast('기종 이름을 입력해 주세요.'); return; }
    state.data.unitTypes.push({ id: uid(), name, price, active: true });
    state.data.settings.samplePrices = false;
    $('#newTypeName').value = '';
    $('#newTypePrice').value = '';
    save();
    renderManage();
    renderCountList({});
    toast('기종을 추가했습니다.');
  });

  // 관리: 비용 분류
  $('#catQuickToggle').addEventListener('click', () => {
    setQuickCatOpen($('#catQuickAdd').hidden);
  });
  $('#quickCatSubmit').addEventListener('click', saveQuickCategory);
  $('#quickCatName').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); saveQuickCategory(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); setQuickCatOpen(false); $('#expenseCategory').focus(); }
  });

  $('#catManageList').addEventListener('input', ev => {
    const row = ev.target.closest('.manage-row');
    if (!row) return;
    const c = catById(row.dataset.id);
    if (c) {
      c.name = ev.target.value;
      save();
      buildExpenseCats($('#expenseCategory').value);
    }
  });
  $('#addCatForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const res = addExpenseCategory($('#newCatName').value);
    if (!res.ok && res.reason === 'empty') { toast('분류 이름을 입력해 주세요.'); return; }
    if (!res.ok && res.reason === 'dup') { toast('이미 있는 분류입니다 · ‘' + res.name + '’'); return; }
    $('#newCatName').value = '';
    renderManage();
    buildExpenseCats($('#expenseCategory').value || res.id);
    toast('분류를 추가했습니다.');
  });

  // 관리: 메모
  $('#addMemoForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const v = $('#newMemo').value.trim();
    if (!v) return;
    if (state.data.memoPresets.includes(v)) { toast('이미 등록된 메모입니다.'); return; }
    state.data.memoPresets.push(v);
    $('#newMemo').value = '';
    save();
    renderManage();
    fillSaleForm(state.editSale ? state.data.sales.find(s => s.id === state.editSale) : null);
    toast('메모를 추가했습니다.');
  });

  // 데이터
  $('#exportCsvPeriod').addEventListener('click', () => exportCsv('period'));
  $('#exportCsvAll').addEventListener('click', () => exportCsv('all'));
  $('#exportJson').addEventListener('click', exportJson);
  $('#importJsonBtn').addEventListener('click', () => $('#importJsonFile').click());
  $('#importJsonFile').addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0];
    if (f) importJson(f);
    ev.target.value = '';
  });
  $('#wipeSample').addEventListener('click', wipeSample);
  $('#wipeAll').addEventListener('click', () => {
    if (!confirm('모든 매출·비용 기록을 지울까요? 단가·분류 설정은 그대로 남습니다.')) return;
    if (!confirm('정말 지웁니다. 되돌릴 수 없으니 JSON 백업을 받아 두셨는지 확인해 주세요.')) return;
    state.data.sales = [];
    state.data.expenses = [];
    state.editSale = null;
    state.editExpense = null;
    save();
    renderAll();
    toast('모든 기록을 지웠습니다.');
  });

  // 창 크기 변경 → 차트 다시
  window.addEventListener('resize', debounce(() => {
    if (state.view.tab === 'summary') renderTrend();
  }, 160));
}

function renderCountListLabels() {
  $$('#countList .count-row').forEach(row => {
    const t = typeById(row.dataset.type);
    if (!t) return;
    const nameEl = $('.cr-name', row);
    if (nameEl) nameEl.innerHTML = esc(t.name) + '<em class="cr-unit">' + won(t.price) + '</em>';
  });
}

function movePeriod(dir) {
  const v = shiftView(state.view, dir);
  state.view.y = v.y;
  state.view.m = v.m;
  state.data.ui = Object.assign({}, state.data.ui, state.view);
  save();
  renderPeriodUI();
  renderSummary();
}

function deleteType(id) {
  const t = typeById(id);
  if (!t) return;
  const used = state.data.sales.filter(s => toNum((s.counts || {})[id]) > 0).length;
  if (used) {
    toast('이 기종을 쓴 기록이 ' + used + '건 있어 삭제할 수 없습니다. ‘사용’을 끄면 입력 화면에서 숨길 수 있어요.');
    return;
  }
  if (state.data.unitTypes.length <= 1) {
    toast('기종은 최소 한 개가 필요합니다.');
    return;
  }
  if (!confirm('‘' + t.name + '’ 기종을 삭제할까요?')) return;
  state.data.unitTypes = state.data.unitTypes.filter(x => x.id !== id);
  save();
  renderManage();
  renderCountList({});
  toast('기종을 삭제했습니다.');
}

function deleteCat(id) {
  const c = catById(id);
  if (!c) return;
  if (state.data.expenseCategories.length <= 1) {
    toast('비용 분류는 최소 한 개가 필요합니다.');
    return;
  }
  const used = state.data.expenses.filter(e => e.categoryId === id).length;
  const msg = used
    ? '‘' + c.name + '’ 분류를 삭제할까요?\n이 분류로 기록한 ' + used + '건은 ‘' + c.name + '’ 이름으로 그대로 남습니다.'
    : '‘' + c.name + '’ 분류를 삭제할까요?';
  if (!confirm(msg)) return;
  state.data.expenses.forEach(e => {
    if (e.categoryId === id) { e.categoryName = c.name; e.categoryId = null; }
  });
  state.data.expenseCategories = state.data.expenseCategories.filter(x => x.id !== id);
  save();
  renderManage();
  buildExpenseCats();
  renderSummary();
  toast('분류를 삭제했습니다.');
}

function wipeSample() {
  const n = state.data.sales.filter(s => s.sample).length + state.data.expenses.filter(e => e.sample).length;
  if (!n) { toast('지울 예시 데이터가 없습니다.'); return; }
  if (!confirm('예시 기록 ' + n + '건을 지우고 빈 상태로 시작할까요?\n(단가·분류 설정은 그대로 남습니다.)')) return;
  state.data.sales = state.data.sales.filter(s => !s.sample);
  state.data.expenses = state.data.expenses.filter(e => !e.sample);
  state.editSale = null;
  state.editExpense = null;
  save();
  renderAll();
  toast('예시 데이터를 지웠습니다. 이제 내 기록으로 시작하세요.');
}

/* ------------------------------ 시작 ------------------------------ */
function init() {
  state.data = load();
  const ui = state.data.ui || defaultView();
  state.view = {
    tab: ui.tab || 'summary',
    type: PERIOD_STEP[ui.type] ? ui.type : 'month',
    y: Number.isFinite(ui.y) ? ui.y : new Date().getFullYear(),
    m: Number.isFinite(ui.m) ? Math.min(11, Math.max(0, ui.m)) : new Date().getMonth()
  };

  wireEvents();

  $('#salesDate').value = todayStr();
  $('#expenseDate').value = todayStr();
  buildExpenseCats();
  fillSaleForm(null);
  fillExpenseForm(null);
  renderManage();

  $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === 'tab-' + state.view.tab));
  $$('[data-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.tab === state.view.tab));

  renderSummary();
  renderEntry();
  renderExpense();
  save();
}

document.addEventListener('DOMContentLoaded', init);

/* --------------------- 홈 화면 설치 · 오프라인 캐시 --------------------- */
/* sw.js 는 앱 폴더 기준 상대 경로라 GitHub Pages 하위 경로(/저장소/)에서도 동작합니다.
   file:// 로 열었을 때는 서비스 워커를 쓸 수 없으므로 조용히 건너뜁니다. */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[해밀홈케어] 오프라인 캐시를 켜지 못했습니다:', err && err.message);
    });
  });
}

/* 테스트·디버그용 (읽기 전용 성격의 도우미) */
window.haemilApp = {
  get data() { return state.data; },
  get view() { return state.view; },
  totals() { return periodTotals(state.view); },
  setView(v) {
    Object.assign(state.view, v);
    renderPeriodUI();
    renderSummary();
    save();
  },
  csv(scope) { return buildCsv(scope || 'period'); },
  resetStorage() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* noop */ }
    state.data = freshData();
    Object.assign(state.view, state.data.ui);
    renderAll();
    fillSaleForm(null);
    fillExpenseForm(null);
  }
};
