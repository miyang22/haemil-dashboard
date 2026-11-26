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

/* ------------------------------ 견적서 기본값 ------------------------------ */
/* 상호·성명·TEL 만 기본값으로 두고, 사업자등록번호·주소·메일·계좌는 이 기기의 localStorage 에만
   저장합니다(공개 저장소 소스에는 남기지 않음). */
const DEFAULT_QUOTE_SUPPLIER = {
  name: '해밀홈케어',
  person: '문병철',
  tel: '1600-1970',
  regno: '',
  addr: '',
  email: '',
  account: ''
};

const DEFAULT_QUOTE_VALID = '작성일로부터 1주일간';

/* 표준 비고 문구 — 사용자가 고치면 그 문구가 기본값으로 저장됩니다. */
const DEFAULT_QUOTE_NOTES = [
  '1. 친환경 에어컨 세척 서비스 개요',
  '',
  '   1) 세척방식 : 에어컨 완전 분해세척',
  '   2) 세척범위 : 부품세척 + 열교환기 (완전 분해 청소)',
  '   3) 세척장비 : 에어컨세척전용 장비',
  '   4) 사용약품 : 환경부 인증 친환경 핀세척제',
  '      - 친환경 인증 시험성적서 제출가능',
  '      - 한국 냉난방기협회 인증 부식방지 핀세척제 사용',
  '',
  '2. 세척 후 사후관리',
  '',
  '   1) 세척 후 3개월간 세척작업으로 인한 기기이상 무상 A/S 관리',
  '   2) 현장작업 전 작동이상 제품 파악 후 내용공유',
  '',
  '3. 결제방법 : 계좌이체, 카드결제'
].join('\n');

const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

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
    quotes: [],
    reservations: resvSampleSeed(),
    resvSync: { url: '', token: '', lastSyncAt: 0, lastError: '', pendingDeletes: [] },
    quoteSupplier: Object.assign({}, DEFAULT_QUOTE_SUPPLIER),
    quoteSettings: {
      vat: true,
      notes: DEFAULT_QUOTE_NOTES,
      myEmail: '',
      emailjs: { serviceId: '', templateId: '', publicKey: '' }
    },
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
    quoteDraft: raw.quoteDraft && typeof raw.quoteDraft === 'object' ? raw.quoteDraft : null,
    quotes: Array.isArray(raw.quotes) ? raw.quotes.filter(q => q && typeof q === 'object').map(normalizeQuote) : [],
    reservations: resvNormalizeList(raw.reservations),
    resvSync: (function (src) {
      const s = src && typeof src === 'object' ? src : {};
      return {
        url: String(s.url || ''),
        token: String(s.token || ''),
        lastSyncAt: Number(s.lastSyncAt) || 0,
        lastError: String(s.lastError || ''),
        pendingDeletes: Array.isArray(s.pendingDeletes)
          ? s.pendingDeletes.filter(d => d && Number(d.row) >= 2)
              .map(d => ({ row: Number(d.row), name: String(d.name || '') }))
          : []
      };
    })(raw.resvSync),
    quoteSupplier: Object.assign({}, DEFAULT_QUOTE_SUPPLIER, raw.quoteSupplier && typeof raw.quoteSupplier === 'object' ? {
      name: String(raw.quoteSupplier.name == null ? DEFAULT_QUOTE_SUPPLIER.name : raw.quoteSupplier.name),
      person: String(raw.quoteSupplier.person == null ? DEFAULT_QUOTE_SUPPLIER.person : raw.quoteSupplier.person),
      tel: String(raw.quoteSupplier.tel == null ? DEFAULT_QUOTE_SUPPLIER.tel : raw.quoteSupplier.tel),
      regno: String(raw.quoteSupplier.regno || ''),
      addr: String(raw.quoteSupplier.addr || ''),
      email: String(raw.quoteSupplier.email || ''),
      account: String(raw.quoteSupplier.account || '')
    } : {}),
    quoteSettings: (function (qs) {
      const src = qs && typeof qs === 'object' ? qs : {};
      const ej = src.emailjs && typeof src.emailjs === 'object' ? src.emailjs : {};
      return {
        vat: src.vat !== false,
        notes: typeof src.notes === 'string' ? src.notes : DEFAULT_QUOTE_NOTES,
        myEmail: String(src.myEmail || ''),
        emailjs: {
          serviceId: String(ej.serviceId || ''),
          templateId: String(ej.templateId || ''),
          publicKey: String(ej.publicKey || '')
        }
      };
    })(raw.quoteSettings),
    ui: Object.assign(defaultView(), raw.ui || {})
  };
  return data;
}

/** 저장된 견적서 한 건을 안전한 모양으로 정리합니다. */
function normalizeQuote(q) {
  const items = Array.isArray(q.items) ? q.items.filter(it => it && typeof it === 'object').map(it => ({
    name: String(it.name || ''),
    spec: String(it.spec == null ? '기본' : it.spec),
    unit: String(it.unit == null ? 'EA' : it.unit),
    qty: Math.max(0, toNum(it.qty)),
    price: Math.max(0, toNum(it.price))
  })) : [];
  return {
    id: String(q.id || uid()),
    no: String(q.no || ''),
    date: String(q.date || todayStr()).slice(0, 10),
    receiver: String(q.receiver || ''),
    receiverEmail: String(q.receiverEmail || ''),
    ref: String(q.ref || ''),
    valid: String(q.valid || DEFAULT_QUOTE_VALID),
    items: items,
    vat: q.vat !== false,
    notes: typeof q.notes === 'string' ? q.notes : DEFAULT_QUOTE_NOTES,
    supplier: Object.assign({}, DEFAULT_QUOTE_SUPPLIER, q.supplier && typeof q.supplier === 'object' ? q.supplier : {}),
    supply: Math.max(0, toNum(q.supply)),
    tax: Math.max(0, toNum(q.tax)),
    total: Math.max(0, toNum(q.total)),
    updatedAt: Number(q.updatedAt) || Date.now()
  };
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
  const siteMap = {};
  sales.forEach(s => {
    const amount = saleAmount(s);
    revenue += amount;
    const site = String(s.memo || '').trim() || '미지정(현장 미입력)';
    if (!siteMap[site]) siteMap[site] = { amount: 0, units: 0, count: 0 };
    siteMap[site].amount += amount;
    siteMap[site].units += saleUnits(s);
    siteMap[site].count += 1;
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
    typeMap, catMap, siteMap
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
  if (tab === 'resv') {
    renderResv();
    const cfg = resvSyncCfg();
    if (cfg.url && !cfg.lastError && Date.now() - resvLastAutoPull > 2 * 60 * 1000) {
      resvSyncNow({ silent: true });
    }
  }
  if (tab === 'entry') renderEntry();
  if (tab === 'quote') renderQuote();
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

/* ---- 현장별 매출 (비용 구성과 같은 막대 카드) ---- */
function renderSiteBreakdown(t) {
  const el = $('#siteList');
  if (!el) return;
  const rows = Object.keys(t.siteMap)
    .map(name => ({ name: name, amount: t.siteMap[name].amount, units: t.siteMap[name].units, count: t.siteMap[name].count }))
    .filter(r => r.amount !== 0 || r.count > 0)
    .sort((a, b) => b.amount - a.amount || b.units - a.units);

  const note = $('#siteNote');
  if (note) note.textContent = rows.length ? rows.length + '곳 · ' + won(t.revenue) : '';

  if (!rows.length) {
    el.innerHTML = '<li class="empty">이 기간 매출 기록이 없습니다.</li>';
    return;
  }

  const max = Math.max.apply(null, rows.map(r => Math.abs(r.amount))) || 1;
  const shown = rows.slice(0, 10);
  const rest = rows.slice(10);

  const rowHtml = (r, label) => {
    const pct = max ? Math.max(3, (Math.abs(r.amount) / max) * 100) : 0;
    const share = t.revenue ? Math.round((r.amount / t.revenue) * 100) : 0;
    return '<li>' +
      '<div class="bl-row"><span class="name">' + esc(label || r.name) +
        ' <span class="muted">' + r.units + '대 · ' + share + '%</span></span>' +
      '<span class="amount">' + won(r.amount) + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '</li>';
  };

  let html = shown.map(r => rowHtml(r)).join('');
  if (rest.length) {
    const sum = rest.reduce((a, b) => ({ amount: a.amount + b.amount, units: a.units + b.units, count: a.count + b.count }), { amount: 0, units: 0, count: 0 });
    html += rowHtml(sum, '그 외 ' + rest.length + '곳');
  }
  el.innerHTML = html;
}

function renderSummary() {
  renderBanner();
  renderPeriodUI();
  const t = periodTotals(state.view);
  renderKpis(t);
  renderTrend();
  renderTypeBreakdown(t);
  renderCatBreakdown(t);
  renderSiteBreakdown(t);
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
  renderResv();
  renderEntry();
  renderQuote();
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
  const n = state.data.sales.filter(s => s.sample).length + state.data.expenses.filter(e => e.sample).length
    + resvList().filter(r => r.sample).length;
  if (!n) { toast('지울 예시 데이터가 없습니다.'); return; }
  if (!confirm('예시 기록 ' + n + '건을 지우고 빈 상태로 시작할까요?\n(단가·분류 설정은 그대로 남습니다.)')) return;
  state.data.sales = state.data.sales.filter(s => !s.sample);
  state.data.expenses = state.data.expenses.filter(e => !e.sample);
  state.data.reservations = resvList().filter(r => !r.sample);
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
  wireQuoteEvents();

  $('#salesDate').value = todayStr();
  $('#expenseDate').value = todayStr();
  buildExpenseCats();
  fillSaleForm(null);
  fillExpenseForm(null);
  renderManage();
  initQuote();
  initResv();

  $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.id === 'tab-' + state.view.tab));
  $$('[data-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.tab === state.view.tab));

  renderSummary();
  renderEntry();
  renderExpense();
  save();
}

document.addEventListener('DOMContentLoaded', init);

/* ==========================================================================
   견적서 (Quotation)
   - 작성 폼 ↔ A4 미리보기 ↔ 인쇄/PNG ↔ 메일 발송 ↔ 발행 내역
   ========================================================================== */

const Q_MIN_ROWS = 10;        // 견적서 표의 최소 줄 수(빈 줄로 채워 견적서다운 모양 유지)
const HANGUL_DIGIT = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const HANGUL_SMALL = ['', '십', '백', '천'];
const HANGUL_BIG = ['', '만', '억', '조', '경'];

let qDraft = null;
let qPreviewTimer = null;
let qLastMailto = '';

/* ------------------------------ 숫자 → 한글 금액 ------------------------------ */
/** 1672000 → '일백육십칠만이천' (금액 표기용, 일·십·백·천을 모두 읽습니다) */
function hangulNumber(value) {
  let n = Math.abs(Math.round(Number(value) || 0));
  if (n === 0) return '영';
  const groups = [];
  while (n > 0) {
    groups.push(n % 10000);
    n = Math.floor(n / 10000);
  }
  let out = '';
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const g = groups[gi];
    if (!g) continue;
    const digits = String(g).padStart(4, '0');
    let part = '';
    for (let i = 0; i < 4; i++) {
      const d = Number(digits[i]);
      if (!d) continue;
      part += HANGUL_DIGIT[d] + HANGUL_SMALL[3 - i];
    }
    out += part + (HANGUL_BIG[gi] || '');
  }
  return out || '영';
}

function korDate(dateStr) {
  const d = parseDate(dateStr || todayStr());
  return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
}

/* ------------------------------ 데이터 접근 ------------------------------ */
function qSupplier() {
  if (!state.data.quoteSupplier || typeof state.data.quoteSupplier !== 'object') {
    state.data.quoteSupplier = Object.assign({}, DEFAULT_QUOTE_SUPPLIER);
  }
  return state.data.quoteSupplier;
}

function qSettings() {
  if (!state.data.quoteSettings || typeof state.data.quoteSettings !== 'object') {
    state.data.quoteSettings = {
      vat: true,
      notes: DEFAULT_QUOTE_NOTES,
      myEmail: '',
      emailjs: { serviceId: '', templateId: '', publicKey: '' }
    };
  }
  if (!state.data.quoteSettings.emailjs) {
    state.data.quoteSettings.emailjs = { serviceId: '', templateId: '', publicKey: '' };
  }
  return state.data.quoteSettings;
}

function quoteList() {
  if (!Array.isArray(state.data.quotes)) state.data.quotes = [];
  return state.data.quotes;
}

function nextQuoteNo(dateStr) {
  const year = String(dateStr || todayStr()).slice(0, 4);
  let max = 0;
  quoteList().forEach(q => {
    const m = /^(\d{4})-(\d{1,5})$/.exec(String(q.no || ''));
    if (m && m[1] === year) max = Math.max(max, Number(m[2]));
  });
  return year + '-' + String(max + 1).padStart(3, '0');
}

function blankQuoteItem(name, spec, unit, qty, price) {
  return {
    k: uid(),
    name: name == null ? '' : String(name),
    spec: spec == null || spec === '' ? '기본' : String(spec),
    unit: unit == null || unit === '' ? 'EA' : String(unit),
    qty: qty == null ? 1 : Math.max(0, toNum(qty)),
    price: price == null ? 0 : Math.max(0, toNum(price))
  };
}

function newQuoteDraft() {
  const s = qSettings();
  const date = todayStr();
  return {
    id: null,
    date: date,
    no: nextQuoteNo(date),
    receiver: '',
    receiverEmail: '',
    ref: '',
    valid: DEFAULT_QUOTE_VALID,
    items: [blankQuoteItem()],
    vat: s.vat !== false,
    notes: s.notes || DEFAULT_QUOTE_NOTES
  };
}

function quoteTotals(draft) {
  const vat = !!draft.vat;
  const lines = draft.items.map(it => {
    const qty = Math.max(0, toNum(it.qty));
    const price = Math.max(0, toNum(it.price));
    const supply = qty * price;
    const tax = vat ? Math.round(supply * 0.1) : 0;
    return { supply: supply, tax: tax };
  });
  const supply = lines.reduce((a, b) => a + b.supply, 0);
  const tax = lines.reduce((a, b) => a + b.tax, 0);
  return { lines: lines, supply: supply, tax: tax, total: supply + tax };
}

/* ------------------------------ 폼 ↔ 모델 ------------------------------ */
const QUOTE_TEXT_FIELDS = [
  ['#qDate', 'date'],
  ['#qNo', 'no'],
  ['#qReceiver', 'receiver'],
  ['#qReceiverEmail', 'receiverEmail'],
  ['#qRef', 'ref'],
  ['#qValid', 'valid'],
  ['#qNotes', 'notes']
];

const QUOTE_SUPPLIER_FIELDS = [
  ['#qSupName', 'name'],
  ['#qSupPerson', 'person'],
  ['#qSupRegno', 'regno'],
  ['#qSupTel', 'tel'],
  ['#qSupEmail', 'email'],
  ['#qSupAccount', 'account'],
  ['#qSupAddr', 'addr']
];

function fillQuoteForm() {
  const d = qDraft;
  QUOTE_TEXT_FIELDS.forEach(([sel, key]) => {
    const el = $(sel);
    if (el) el.value = d[key] == null ? '' : d[key];
  });
  const vat = $('#qVat');
  if (vat) vat.checked = !!d.vat;
  const sup = qSupplier();
  QUOTE_SUPPLIER_FIELDS.forEach(([sel, key]) => {
    const el = $(sel);
    if (el) el.value = sup[key] == null ? '' : sup[key];
  });
  const my = $('#qMyEmail');
  if (my) my.value = qSettings().myEmail || '';
  const ej = qSettings().emailjs;
  if ($('#qEjService')) $('#qEjService').value = ej.serviceId || '';
  if ($('#qEjTemplate')) $('#qEjTemplate').value = ej.templateId || '';
  if ($('#qEjPublic')) $('#qEjPublic').value = ej.publicKey || '';
  $('#quoteMode').textContent = d.id ? '저장됨 · ' + (d.no || '') : '새 견적 작성 중';
  renderQuoteRows();
  renderQuoteChips();
  refreshQuoteTotals();
}

function renderQuoteChips() {
  const box = $('#qTypeChips');
  if (!box) return;
  const types = state.data.unitTypes.filter(t => t.active !== false);
  if (!types.length) {
    box.innerHTML = '<span class="empty-chip">관리 탭에서 기종을 추가하면 여기에 나옵니다.</span>';
    return;
  }
  box.innerHTML = types.map(t =>
    '<button type="button" class="q-chip" data-qtype="' + t.id + '">' + esc(t.name) +
      '<em>' + wonPlain(t.price) + '원</em></button>'
  ).join('');
}

function quoteRowAmountHtml(item) {
  const qty = Math.max(0, toNum(item.qty));
  const price = Math.max(0, toNum(item.price));
  const supply = qty * price;
  const tax = qDraft && qDraft.vat ? Math.round(supply * 0.1) : 0;
  return '<span>공급 ' + wonPlain(supply) + '원</span><b>세액 ' + wonPlain(tax) + '원</b>';
}

function renderQuoteRows() {
  const box = $('#quoteRows');
  if (!box) return;
  if (!qDraft.items.length) {
    box.innerHTML = '<p class="empty">품목이 없습니다. 위에서 기종을 고르거나 ‘+ 품목 줄 추가’를 눌러 주세요.</p>';
    return;
  }
  box.innerHTML = qDraft.items.map((it, i) =>
    '<div class="q-row" data-k="' + it.k + '">' +
      '<input type="text" class="qr-name" value="' + esc(it.name) + '" placeholder="품목 (예: 시스템에어컨_4웨이)" aria-label="' + (i + 1) + '번째 품목" autocomplete="off">' +
      '<input type="text" class="qr-spec" value="' + esc(it.spec) + '" placeholder="기본" aria-label="' + (i + 1) + '번째 규격/사양" autocomplete="off">' +
      '<input type="text" class="qr-qty" inputmode="numeric" value="' + toNum(it.qty) + '" aria-label="' + (i + 1) + '번째 수량">' +
      '<input type="text" class="qr-unit" value="' + esc(it.unit) + '" placeholder="EA" aria-label="' + (i + 1) + '번째 단위" autocomplete="off">' +
      '<input type="text" class="qr-price money-input" inputmode="numeric" value="' + (toNum(it.price) ? wonPlain(it.price) : '') + '" placeholder="단가" aria-label="' + (i + 1) + '번째 단가">' +
      '<div class="qr-amount">' + quoteRowAmountHtml(it) + '</div>' +
      '<button type="button" class="qr-del" data-qdel="' + it.k + '" aria-label="' + (i + 1) + '번째 품목 삭제">✕</button>' +
    '</div>'
  ).join('');
}

function updateQuoteRowAmounts() {
  $$('#quoteRows .q-row').forEach(row => {
    const it = qDraft.items.find(x => x.k === row.dataset.k);
    const box = $('.qr-amount', row);
    if (it && box) box.innerHTML = quoteRowAmountHtml(it);
  });
}

function refreshQuoteTotals() {
  if (!qDraft) return;
  const t = quoteTotals(qDraft);
  if ($('#qSupply')) $('#qSupply').textContent = won(t.supply);
  if ($('#qTax')) $('#qTax').textContent = won(t.tax);
  if ($('#qTotal')) $('#qTotal').textContent = won(t.total);
  if ($('#qHangul')) $('#qHangul').textContent = '일금 ' + hangulNumber(t.total) + ' 원정';
  updateQuoteRowAmounts();
}

/* ------------------------------ 미리보기(A4) ------------------------------ */
/** 작성 중인 견적서를 기기에 임시 저장 — 앱을 닫았다 열어도 이어서 쓸 수 있게 */
function persistQuoteDraft() {
  if (!qDraft) return;
  state.data.quoteDraft = qDraft;
  save();
}

function queueQuotePreview() {
  clearTimeout(qPreviewTimer);
  qPreviewTimer = setTimeout(() => {
    persistQuoteDraft();
    renderQuotePreview();
  }, 110);
}

/** 저장해 둔 임시 견적서를 안전한 모양으로 되살립니다. */
function reviveQuoteDraft(raw) {
  const base = newQuoteDraft();
  if (!raw || typeof raw !== 'object') return base;
  const items = (Array.isArray(raw.items) ? raw.items : []).map(it =>
    blankQuoteItem(it && it.name, it && it.spec, it && it.unit, it && it.qty, it && it.price)
  );
  return {
    id: raw.id ? String(raw.id) : null,
    date: String(raw.date || base.date).slice(0, 10),
    no: String(raw.no || base.no),
    receiver: String(raw.receiver || ''),
    receiverEmail: String(raw.receiverEmail || ''),
    ref: String(raw.ref || ''),
    valid: String(raw.valid || base.valid),
    items: items.length ? items : [blankQuoteItem()],
    vat: raw.vat !== false,
    notes: typeof raw.notes === 'string' ? raw.notes : base.notes
  };
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value == null ? '' : String(value);
}

function renderQuotePreview() {
  if (!qDraft || !$('#quoteSheet')) return;
  const d = qDraft;
  const sup = qSupplier();
  const t = quoteTotals(d);

  setText('#qsDate', korDate(d.date));
  setText('#qsNo', d.no || '');
  setText('#qsReceiver', d.receiver || '');
  setText('#qsRef', d.ref || '');
  setText('#qsValid', d.valid || DEFAULT_QUOTE_VALID);
  setText('#qsSupName', sup.name || '');
  setText('#qsSupRegno', sup.regno || '');
  setText('#qsSupPerson', sup.person || '');
  setText('#qsSupAddr', sup.addr || '');
  setText('#qsSupTel', sup.tel || '');
  setText('#qsSupEmail', sup.email || '');
  setText('#qsTotalEm', d.vat ? '(세액포함)' : '(부가세 별도)');
  setText('#qsHangul', hangulNumber(t.total) + ' 원정');
  setText('#qsWon', '(₩ ' + nf.format(t.total) + ')');
  setText('#qsNotes', d.notes || '');
  setText('#qsAccount', sup.account || '');

  const shown = d.items.filter(it => String(it.name || '').trim() || toNum(it.price) > 0);
  let rows = '';
  shown.forEach(it => {
    const qty = Math.max(0, toNum(it.qty));
    const price = Math.max(0, toNum(it.price));
    const supply = qty * price;
    const tax = d.vat ? Math.round(supply * 0.1) : 0;
    rows += '<tr>' +
      '<td class="qs-name-cell">' + esc(it.name) + '</td>' +
      '<td>' + esc(it.spec) + '</td>' +
      '<td>' + esc(it.unit) + '</td>' +
      '<td class="qs-num">' + (qty || '') + '</td>' +
      '<td class="qs-num">' + (price ? wonPlain(price) : '') + '</td>' +
      '<td class="qs-num">' + (supply ? wonPlain(supply) : '') + '</td>' +
      '<td class="qs-num">' + (tax ? wonPlain(tax) : '') + '</td>' +
      '</tr>';
  });
  const fill = Math.max(0, Q_MIN_ROWS - shown.length);
  for (let i = 0; i < fill; i++) {
    rows += '<tr class="qs-filler"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
  }
  const body = $('#qsItems');
  if (body) body.innerHTML = rows;
  setText('#qsSupplySum', wonPlain(t.supply));
  setText('#qsGrandSum', wonPlain(t.total));

  fitQuotePreview();
}

function fitQuotePreview() {
  const wrap = $('#quotePreviewWrap');
  const sheet = $('#quoteSheet');
  if (!wrap || !sheet) return;
  sheet.style.transform = 'none';
  sheet.style.marginLeft = '0px';
  const natural = sheet.offsetWidth || 794;
  const avail = Math.max(120, wrap.clientWidth);
  const s = Math.min(1, avail / natural);
  sheet.style.transform = 'scale(' + s.toFixed(4) + ')';
  sheet.style.marginLeft = Math.max(0, Math.round((avail - natural * s) / 2)) + 'px';
  wrap.style.height = Math.round(sheet.offsetHeight * s + 20) + 'px';
}

/* ------------------------------ 발행 내역 ------------------------------ */
function renderQuoteHistory() {
  const el = $('#quoteHistoryList');
  if (!el) return;
  const list = quoteList().slice().sort((a, b) =>
    a.date === b.date ? (b.updatedAt || 0) - (a.updatedAt || 0) : (a.date < b.date ? 1 : -1)
  );
  const note = $('#quoteHistoryNote');
  if (note) note.textContent = list.length ? list.length + '건 · 최근 30건 표시' : '';
  if (!list.length) {
    el.innerHTML = '<li class="empty">아직 저장한 견적서가 없습니다. 위에서 작성하고 ‘견적서 저장’을 눌러 주세요.</li>';
    return;
  }
  el.innerHTML = list.slice(0, 30).map(q => {
    const d = parseDate(q.date);
    const items = Array.isArray(q.items) ? q.items.length : 0;
    return '<li data-id="' + esc(q.id) + '">' +
      '<div class="qh-top"><span class="qh-no">' + esc(q.no || '(번호 없음)') + '</span>' +
        '<span class="qh-date">' + (d.getMonth() + 1) + '.' + d.getDate() + '</span></div>' +
      '<span class="qh-amount">' + won(q.total) + '</span>' +
      '<span class="qh-sub">' + esc(q.receiver || '수신 미입력') + ' · 품목 ' + items + '개' +
        (q.receiverEmail ? ' · ' + esc(q.receiverEmail) : '') + '</span>' +
      '<span class="qh-actions">' +
        '<button type="button" data-qact="load" data-id="' + esc(q.id) + '">불러오기</button>' +
        '<button type="button" data-qact="copy" data-id="' + esc(q.id) + '">복제</button>' +
        '<button type="button" class="sales" data-qact="sales" data-id="' + esc(q.id) + '">이 내역으로 매출 등록</button>' +
        '<button type="button" class="del" data-qact="del" data-id="' + esc(q.id) + '">삭제</button>' +
      '</span>' +
      '</li>';
  }).join('');
}

function loadQuoteIntoForm(quote, asCopy) {
  if (!quote) return;
  const date = asCopy ? todayStr() : (quote.date || todayStr());
  qDraft = {
    id: asCopy ? null : quote.id,
    date: date,
    no: asCopy ? nextQuoteNo(date) : (quote.no || ''),
    receiver: quote.receiver || '',
    receiverEmail: quote.receiverEmail || '',
    ref: quote.ref || '',
    valid: quote.valid || DEFAULT_QUOTE_VALID,
    items: (quote.items || []).map(it => blankQuoteItem(it.name, it.spec, it.unit, it.qty, it.price)),
    vat: quote.vat !== false,
    notes: typeof quote.notes === 'string' ? quote.notes : DEFAULT_QUOTE_NOTES
  };
  if (!qDraft.items.length) qDraft.items = [blankQuoteItem()];
  fillQuoteForm();
  persistQuoteDraft();
  renderQuotePreview();
  $('#quoteMode').textContent = asCopy ? '복제본 작성 중 · ' + qDraft.no : '불러옴 · ' + (quote.no || '');
  if (window.scrollTo) window.scrollTo({ top: 0 });
  toast(asCopy ? '견적서를 복제했습니다 · 새 번호 ' + qDraft.no : '견적서를 불러왔습니다 · ' + (quote.no || ''));
}

function saveQuote() {
  if (!qDraft) return;
  const named = qDraft.items.filter(it => String(it.name || '').trim());
  if (!named.length) {
    toast('품목을 하나 이상 입력해 주세요.');
    const first = $('.qr-name', $('#quoteRows'));
    if (first) first.focus();
    return;
  }
  const t = quoteTotals(qDraft);
  const quote = {
    id: qDraft.id || uid(),
    no: String(qDraft.no || '').trim() || nextQuoteNo(qDraft.date),
    date: qDraft.date || todayStr(),
    receiver: qDraft.receiver || '',
    receiverEmail: qDraft.receiverEmail || '',
    ref: qDraft.ref || '',
    valid: qDraft.valid || DEFAULT_QUOTE_VALID,
    items: qDraft.items
      .filter(it => String(it.name || '').trim() || toNum(it.price) > 0)
      .map(it => ({
        name: String(it.name || '').trim(),
        spec: String(it.spec || '기본'),
        unit: String(it.unit || 'EA'),
        qty: Math.max(0, toNum(it.qty)),
        price: Math.max(0, toNum(it.price))
      })),
    vat: !!qDraft.vat,
    notes: qDraft.notes || '',
    supplier: Object.assign({}, qSupplier()),
    supply: t.supply,
    tax: t.tax,
    total: t.total,
    updatedAt: Date.now()
  };
  const list = quoteList();
  const i = list.findIndex(q => q.id === quote.id);
  if (i >= 0) list[i] = quote;
  else list.unshift(quote);
  qDraft.id = quote.id;
  qDraft.no = quote.no;
  $('#qNo').value = quote.no;
  $('#quoteMode').textContent = '저장됨 · ' + quote.no;
  save();
  renderQuoteHistory();
  renderQuotePreview();
  toast('견적서를 저장했습니다 · ' + quote.no);
}

function deleteQuote(id) {
  const q = quoteList().find(x => x.id === id);
  if (!q) return;
  if (!confirm('견적서 ' + (q.no || '') + ' (' + won(q.total) + ')를 삭제할까요?')) return;
  state.data.quotes = quoteList().filter(x => x.id !== id);
  if (qDraft && qDraft.id === id) qDraft.id = null;
  save();
  renderQuoteHistory();
  toast('견적서를 삭제했습니다.');
}

/** 견적 내역을 ‘매출 입력’ 탭으로 옮깁니다. 이름이 같은 기종은 대수로, 나머지는 기타 매출로. */
function quoteToSales(quote) {
  if (!quote) return;
  const target = Math.max(0, toNum(quote.total));
  const counts = {};
  let extra = 0;
  let mapped = 0;
  (quote.items || []).forEach(it => {
    const qty = Math.max(0, toNum(it.qty));
    const price = Math.max(0, toNum(it.price));
    const lineTotal = Math.round(qty * price * (quote.vat ? 1.1 : 1));
    const name = String(it.name || '').trim().toLowerCase();
    const type = state.data.unitTypes.find(x => String(x.name).trim().toLowerCase() === name);
    if (type && qty) {
      counts[type.id] = (counts[type.id] || 0) + qty;
      mapped += qty * type.price;
    } else {
      extra += lineTotal;
    }
  });
  const adjust = target - mapped - extra;

  state.editSale = null;
  switchTab('entry');
  fillSaleForm(null);
  $('#salesDate').value = quote.date || todayStr();
  renderCountList(counts);
  $('#extraSales').value = extra ? wonPlain(extra) : '';
  $('#adjustSales').value = adjust ? wonPlain(adjust) : '';
  $('#salesMemo').value = '견적 ' + (quote.no || '') + (quote.receiver ? ' · ' + quote.receiver : '');
  updateEntryTotal();
  toast('매출 입력으로 옮겼습니다 · 저장을 눌러 주세요 (' + won(target) + ')');
}

/* ------------------------------ 인쇄 / PDF ------------------------------ */
function buildPrintSheet() {
  const root = $('#printRoot');
  const sheet = $('#quoteSheet');
  if (!root || !sheet) return null;
  root.innerHTML = '';
  const clone = document.createElement('div');
  clone.className = 'qsheet';
  clone.innerHTML = sheet.innerHTML;
  root.appendChild(clone);
  // 품목이 많아 A4 보다 길어지면 한 장에 들어가도록 자동 축소(Chromium zoom)
  const mmPx = 96 / 25.4;
  const pageH = 297 * mmPx;
  const h = clone.scrollHeight;
  if (h > pageH + 2) {
    clone.style.zoom = String(Math.max(0.55, pageH / h));
  }
  return clone;
}

function printQuote() {
  renderQuotePreview();
  buildPrintSheet();
  window.print();
}

/* ------------------------------ 이미지(PNG) ------------------------------ */
function buildQuoteCanvas() {
  const d = qDraft;
  const sup = qSupplier();
  const t = quoteTotals(d);
  const K = 6;                                     // 1mm = 6px (≈152dpi)
  const FONT = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

  const L = 14.4, R = 194.7, CX1 = 53.4, CX2 = 155.7;
  const TOP = 17.4, HEAD_B = TOP + 10.2;
  const RECV_R = 106.5, SUP_L = 107.9;
  const R1B = 45.9, R2B = 54.3, R3B = 61.8;
  const S_TITLE_B = 37.2, S_NAME_B = 42.7, S_REG_B = 49.0, S_ADDR_B = 65.5, S_TEL_B = 74.9;
  const BAND_T = 74.9, BAND_B = 84.6;
  const TH_T = 84.6, TH_B = 92.6;
  const ROW_H = 8;
  const shown = d.items.filter(it => String(it.name || '').trim() || toNum(it.price) > 0);
  const rows = Math.max(Q_MIN_ROWS, shown.length);
  const BODY_B = TH_B + rows * ROW_H;
  const FOOT_B = BODY_B + 7.8;
  const NOTE_T = FOOT_B, NOTE_H = 70;
  const NOTE_B = NOTE_T + NOTE_H;
  const ACC_B = NOTE_B + 8.3;
  const Hmm = Math.max(297, ACC_B + 10);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(210 * K);
  canvas.height = Math.round(Hmm * K);
  const ctx = canvas.getContext('2d');

  const px = v => v * K;
  const font = (size, weight) => (weight || 400) + ' ' + px(size) + 'px ' + FONT;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111';
  ctx.strokeStyle = '#111';
  ctx.lineCap = 'butt';

  function line(x1, y1, x2, y2, w) {
    ctx.lineWidth = px(w || 0.25);
    ctx.beginPath();
    ctx.moveTo(px(x1), px(y1));
    ctx.lineTo(px(x2), px(y2));
    ctx.stroke();
  }
  function rect(x1, y1, x2, y2, w) {
    ctx.lineWidth = px(w || 0.25);
    ctx.strokeRect(px(x1), px(y1), px(x2 - x1), px(y2 - y1));
  }
  function text(str, x, y, o) {
    o = o || {};
    ctx.font = font(o.size || 2.7, o.weight);
    ctx.fillStyle = o.color || '#111';
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(str == null ? '' : str), px(x), px(y));
  }
  function tracked(str, cx, y, size, weight, tracking) {
    ctx.font = font(size, weight);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const chars = String(str).split('');
    const widths = chars.map(c => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + px(tracking) * (chars.length - 1);
    let x = px(cx) - total / 2;
    ctx.fillStyle = '#111';
    chars.forEach((c, i) => {
      ctx.fillText(c, x, px(y));
      x += widths[i] + px(tracking);
    });
  }
  /** 폭에 맞춰 줄바꿈 — 가급적 공백에서 끊고, 한 단어가 길면 글자 단위로 */
  function wrap(str, maxW, size, weight) {
    ctx.font = font(size, weight);
    const max = px(maxW);
    const out = [];
    String(str).split('\n').forEach(par => {
      if (!par) { out.push(''); return; }
      let line = '';
      for (let i = 0; i < par.length; i++) {
        const ch = par[i];
        if (ctx.measureText(line + ch).width > max && line) {
          const sp = line.lastIndexOf(' ');
          if (sp > 0 && i - sp < 14) {
            out.push(line.slice(0, sp));
            line = line.slice(sp + 1) + ch;
          } else {
            out.push(line);
            line = ch;
          }
        } else {
          line += ch;
        }
      }
      out.push(line);
    });
    return out;
  }

  /* --- 머리글 --- */
  line(L, TOP, R, TOP, 0.45);
  line(L, HEAD_B, R, HEAD_B, 0.45);
  line(CX1, TOP, CX1, HEAD_B, 0.25);
  line(CX2, TOP, CX2, HEAD_B, 0.25);
  text('DATE', L + 2, TOP + 3.1, { size: 2.2 });
  text(korDate(d.date), L + 2, TOP + 7.4, { size: 2.9, weight: 700 });
  tracked('견 적 서', (CX1 + CX2) / 2, TOP + 5.3, 7, 800, 3.1);
  text('No.', R - 2, TOP + 3.1, { size: 2.2, align: 'right' });
  text(d.no || '', R - 2, TOP + 7.4, { size: 2.9, weight: 700, align: 'right' });

  /* --- 수신 블록 --- */
  rect(L, HEAD_B, RECV_R, R3B, 0.25);
  line(L, R1B, RECV_R, R1B, 0.25);
  line(L, R2B, RECV_R, R2B, 0.25);
  text('수신', L + 2, (HEAD_B + R1B) / 2, { size: 2.8 });
  text('참조', L + 2, (R1B + R2B) / 2, { size: 2.8 });
  text('유효기간', L + 2, (R2B + R3B) / 2, { size: 2.8 });
  text('귀중', RECV_R - 2, (HEAD_B + R1B) / 2, { size: 2.8, align: 'right' });

  const recvLines = wrap(d.receiver || '', RECV_R - L - 36, 3, 700).slice(0, 2);
  const recvBase = (HEAD_B + R1B) / 2 - (recvLines.length - 1) * 2.2;
  recvLines.forEach((ln, i) => text(ln, RECV_R - 10, recvBase + i * 4.4, { size: 3, weight: 700, align: 'right' }));
  const refLines = wrap(d.ref || '', RECV_R - L - 30, 2.7, 400).slice(0, 1);
  refLines.forEach(ln => text(ln, (L + 26 + RECV_R) / 2, (R1B + R2B) / 2, { size: 2.7, align: 'center' }));
  const validLines = wrap(d.valid || DEFAULT_QUOTE_VALID, RECV_R - L - 30, 2.7, 400).slice(0, 1);
  validLines.forEach(ln => text(ln, (L + 26 + RECV_R) / 2, (R2B + R3B) / 2, { size: 2.7, align: 'center' }));

  text('아래와 같이 견적합니다.', L + 1.4, R3B + 8, { size: 3.2 });

  /* --- 공급자 --- */
  rect(SUP_L, HEAD_B, R, S_TEL_B, 0.25);
  line(SUP_L, S_TITLE_B, R, S_TITLE_B, 0.25);
  line(SUP_L, S_NAME_B, R, S_NAME_B, 0.25);
  line(SUP_L, S_REG_B, R, S_REG_B, 0.25);
  line(SUP_L, S_ADDR_B, R, S_ADDR_B, 0.25);
  tracked('공 급 자', (SUP_L + R) / 2, (HEAD_B + S_TITLE_B) / 2, 3.1, 700, 0.9);

  const C1 = SUP_L + 16.5;
  const C2 = C1 + 20.4;
  const C3 = C2 + 12.9;
  const C4 = R - 12.3;
  line(C1, S_TITLE_B, C1, S_TEL_B, 0.25);
  line(C2, S_NAME_B, C2, S_REG_B, 0.25);
  line(C3, S_NAME_B, C3, S_REG_B, 0.25);
  line(C4, S_NAME_B, C4, S_REG_B, 0.25);
  line(C2, S_ADDR_B, C2, S_TEL_B, 0.25);
  line(C3, S_ADDR_B, C3, S_TEL_B, 0.25);

  text('상호', SUP_L + 2, (S_TITLE_B + S_NAME_B) / 2, { size: 2.6 });
  text(sup.name || '', (C1 + R) / 2, (S_TITLE_B + S_NAME_B) / 2, { size: 2.9, weight: 700, align: 'center' });

  text('등록번호', SUP_L + 2, (S_NAME_B + S_REG_B) / 2, { size: 2.5 });
  text(sup.regno || '', (C1 + C2) / 2, (S_NAME_B + S_REG_B) / 2, { size: 2.6, align: 'center' });
  text('성명', C2 + 1.6, (S_NAME_B + S_REG_B) / 2, { size: 2.5 });
  text(sup.person || '', (C3 + C4) / 2, (S_NAME_B + S_REG_B) / 2, { size: 2.6, align: 'center' });
  text('(인)', (C4 + R) / 2, (S_NAME_B + S_REG_B) / 2, { size: 2.5, align: 'center' });

  text('주소', SUP_L + 2, S_REG_B + 3, { size: 2.6 });
  const addrLines = wrap(sup.addr || '', R - C1 - 5, 2.6, 400).slice(0, 2);
  addrLines.forEach((ln, i) => text(ln, C1 + 2, S_REG_B + 4 + i * 4.3, { size: 2.6 }));

  text('TEL', SUP_L + 2, (S_ADDR_B + S_TEL_B) / 2, { size: 2.5 });
  text(sup.tel || '', C1 + 2, (S_ADDR_B + S_TEL_B) / 2, { size: 2.6 });
  text('E-mail', C2 + 1.6, (S_ADDR_B + S_TEL_B) / 2, { size: 2.5 });
  const emailTxt = sup.email || '';
  ctx.font = font(2.6, 400);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let emailSize = 2.6;
  while (ctx.measureText(emailTxt).width > px(R - C3 - 4) && emailSize > 1.8) {
    emailSize -= 0.1;
    ctx.font = font(emailSize, 400);
  }
  text(emailTxt, C3 + 2, (S_ADDR_B + S_TEL_B) / 2, { size: emailSize });

  /* --- 합계금액 --- */
  line(L, BAND_T, R, BAND_T, 0.45);
  line(L, BAND_B, R, BAND_B, 0.45);
  const bandMid = (BAND_T + BAND_B) / 2;
  text('합계금액', L + 1.4, bandMid, { size: 2.9, weight: 700 });
  ctx.font = font(2.9, 700);
  const labelW = 14.6;
  text(d.vat ? '(세액포함)' : '(부가세 별도)', L + 1.4 + labelW, bandMid, { size: 2.4 });
  text('일금', 72.8, bandMid, { size: 2.8, align: 'center' });
  text(hangulNumber(t.total) + ' 원정', 127, bandMid, { size: 3.4, weight: 700, align: 'center' });
  text('(₩ ' + nf.format(t.total) + ')', R - 1.4, bandMid, { size: 3, weight: 700, align: 'right' });

  /* --- 품목 표 --- */
  const COLS = [L, 67.4, 90.3, 103.5, 116.4, 143.3, 169.8, R];
  line(L, TH_T, R, TH_T, 0.45);
  line(L, TH_B, R, TH_B, 0.25);
  line(L, TH_T, L, FOOT_B, 0.25);
  line(R, TH_T, R, FOOT_B, 0.25);
  const HEADERS = ['품목', '규격/사양', '단위', '수량', '단가', '공급가액', '세액'];
  for (let c = 1; c < COLS.length - 1; c++) line(COLS[c], TH_T, COLS[c], FOOT_B, 0.25);
  HEADERS.forEach((h, i) => text(h, (COLS[i] + COLS[i + 1]) / 2, (TH_T + TH_B) / 2, { size: 2.7, weight: 700, align: 'center' }));

  for (let i = 0; i < rows; i++) {
    const top = TH_B + i * ROW_H;
    const mid = top + ROW_H / 2;
    line(L, top + ROW_H, R, top + ROW_H, 0.25);
    const it = shown[i];
    if (!it) continue;
    const qty = Math.max(0, toNum(it.qty));
    const price = Math.max(0, toNum(it.price));
    const supply = qty * price;
    const tax = d.vat ? Math.round(supply * 0.1) : 0;
    text(String(it.name || ''), (COLS[0] + COLS[1]) / 2, mid, { size: 2.7, align: 'center' });
    text(String(it.spec || ''), (COLS[1] + COLS[2]) / 2, mid, { size: 2.7, align: 'center' });
    text(String(it.unit || ''), (COLS[2] + COLS[3]) / 2, mid, { size: 2.7, align: 'center' });
    text(qty ? String(qty) : '', (COLS[3] + COLS[4]) / 2, mid, { size: 2.7, align: 'center' });
    text(price ? wonPlain(price) : '', COLS[5] - 1.6, mid, { size: 2.7, align: 'right' });
    text(supply ? wonPlain(supply) : '', COLS[6] - 1.6, mid, { size: 2.7, align: 'right' });
    text(tax ? wonPlain(tax) : '', COLS[7] - 1.6, mid, { size: 2.7, align: 'right' });
  }

  line(L, BODY_B, R, BODY_B, 0.45);
  text('합계', (COLS[0] + COLS[1]) / 2, BODY_B + 3.9, { size: 2.7, weight: 700, align: 'center' });
  text(wonPlain(t.supply), COLS[6] - 1.6, BODY_B + 3.9, { size: 2.7, weight: 700, align: 'right' });
  text(wonPlain(t.total), COLS[7] - 1.6, BODY_B + 3.9, { size: 2.7, weight: 700, align: 'right' });

  /* --- 비고 / 계좌정보 --- */
  rect(L, NOTE_T, R, NOTE_B, 0.25);
  line(L + 34.4, NOTE_T, L + 34.4, NOTE_B, 0.25);
  text('비고', L + 17.2, NOTE_T + NOTE_H / 2, { size: 2.8, align: 'center' });
  const noteLines = wrap(d.notes || '', R - (L + 36.4) - 2, 2.6, 400);
  const lh = 4.1;
  noteLines.slice(0, Math.floor((NOTE_H - 6) / lh)).forEach((ln, i) => {
    text(ln, L + 36.4, NOTE_T + 5 + i * lh, { size: 2.6 });
  });

  rect(L, NOTE_B, R, ACC_B, 0.25);
  line(L + 34.4, NOTE_B, L + 34.4, ACC_B, 0.25);
  text('계좌정보', L + 17.2, (NOTE_B + ACC_B) / 2, { size: 2.8, align: 'center' });
  text(sup.account || '', L + 36.4, (NOTE_B + ACC_B) / 2, { size: 2.6 });

  return canvas;
}

function downloadQuotePng() {
  return new Promise(resolve => {
    try {
      const canvas = buildQuoteCanvas();
      canvas.toBlob(blob => {
        if (!blob) { resolve(null); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const d = parseDate(qDraft.date || todayStr());
        a.href = url;
        a.download = '해밀홈케어_견적서_' + (qDraft.no || (d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()))) + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        resolve(blob.size);
      }, 'image/png');
    } catch (err) {
      console.error(err);
      resolve(null);
    }
  });
}

/** 견적서를 새 탭에 원본 크기로 열어 폰에서도 크게 본다(집기(핀치) 확대 가능). */
function openQuoteImage() {
  try {
    const canvas = buildQuoteCanvas();
    canvas.toBlob(blob => {
      if (!blob) { toast('이미지를 만들지 못했습니다.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    }, 'image/png');
  } catch (err) {
    console.error(err);
    toast('이미지를 만들지 못했습니다.');
  }
}

/* ------------------------------ 이메일 ------------------------------ */
function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());
}

function emailjsCfg() {
  return qSettings().emailjs || {};
}

function isEmailjsReady() {
  const c = emailjsCfg();
  return !!(c.serviceId && c.templateId && c.publicKey);
}

function quoteEmailParts(quote) {
  const d = quote || qDraft;
  const sup = qSupplier();
  const t = quoteTotals(d);
  const subject = '[해밀홈케어] 에어컨 청소 견적서 (' + (d.no || '번호 미지정') + ')';
  const lines = [];
  lines.push('안녕하세요, 해밀홈케어입니다.');
  lines.push('아래와 같이 에어컨 청소 견적을 보내드립니다.');
  lines.push('');
  lines.push('■ 견적번호 : ' + (d.no || '-'));
  lines.push('■ 작성일 : ' + korDate(d.date));
  if (d.receiver) lines.push('■ 수신 : ' + d.receiver);
  if (d.ref) lines.push('■ 참조 : ' + d.ref);
  lines.push('■ 유효기간 : ' + (d.valid || DEFAULT_QUOTE_VALID));
  lines.push('');
  lines.push('[ 품목 ]');
  (d.items || []).forEach((it, i) => {
    const qty = Math.max(0, toNum(it.qty));
    const price = Math.max(0, toNum(it.price));
    if (!String(it.name || '').trim() && !price) return;
    lines.push(' ' + (i + 1) + ') ' + (it.name || '품목') + ' · ' + (it.spec || '기본') + ' · ' +
      qty + (it.unit || 'EA') + ' × ' + won(price) + ' = ' + won(qty * price));
  });
  lines.push('');
  lines.push('공급가액 : ' + won(t.supply));
  if (d.vat) lines.push('세액(10%) : ' + won(t.tax));
  lines.push('합계금액 : ' + won(t.total) + ' (일금 ' + hangulNumber(t.total) + ' 원정)');
  if (d.notes) {
    lines.push('');
    lines.push('[ 비고 ]');
    lines.push(d.notes);
  }
  if (sup.account) {
    lines.push('');
    lines.push('[ 계좌정보 ]');
    lines.push(sup.account);
  }
  lines.push('');
  lines.push([sup.name, sup.person, sup.tel ? 'TEL ' + sup.tel : '', sup.email].filter(Boolean).join(' | '));
  return { subject: subject, body: lines.join('\r\n'), totals: t };
}

function buildQuoteMailto(quote, myEmail) {
  const d = quote || qDraft;
  const sup = qSupplier();
  const parts = quoteEmailParts(quote);
  const to = String(d.receiverEmail || '').trim();
  const cc = String(myEmail == null ? qSettings().myEmail : myEmail).trim();
  const qs = ['subject=' + encodeURIComponent(parts.subject)];
  if (cc) qs.push('cc=' + encodeURIComponent(cc));
  qs.push('body=' + encodeURIComponent(parts.body));
  return 'mailto:' + to + '?' + qs.join('&');
}

function openExternal(url) {
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function sendViaEmailjs(params) {
  const c = emailjsCfg();
  const res = await fetch(EMAILJS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: c.serviceId,
      template_id: c.templateId,
      user_id: c.publicKey,
      template_params: params
    })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (err) { detail = ''; }
    throw new Error('EmailJS ' + res.status + (detail ? ' · ' + detail.slice(0, 160) : ''));
  }
  return true;
}

async function sendQuoteEmail() {
  if (!qDraft) return;
  renderQuotePreview();
  const btn = $('#quoteEmail');
  const d = qDraft;
  const sup = qSupplier();
  const to = String(d.receiverEmail || '').trim();
  const my = String(qSettings().myEmail || '').trim();

  if (!to && !my) {
    toast('받는 사람(수신 이메일)이나 내 메일을 먼저 입력해 주세요.');
    const el = $('#qReceiverEmail');
    if (el) el.focus();
    return;
  }
  if (to && !isEmail(to)) { toast('수신 이메일 주소 형식을 확인해 주세요.'); $('#qReceiverEmail').focus(); return; }
  if (my && !isEmail(my)) { toast('내 메일 주소 형식을 확인해 주세요.'); $('#qMyEmail').focus(); return; }

  const parts = quoteEmailParts();

  if (!isEmailjsReady()) {
    const url = buildQuoteMailto(d, my);
    qLastMailto = url;
    openExternal(url);
    toast('메일 앱을 열었습니다 · 받는 사람' + (my ? '·내 메일' : '') + '이 채워졌어요');
    return;
  }

  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '발송 중…'; }
  try {
    const base = {
      from_name: sup.name || '해밀홈케어',
      reply_to: sup.email || my || to,
      subject: parts.subject,
      message: parts.body,
      quote_no: d.no || '',
      quote_date: korDate(d.date),
      receiver: d.receiver || '',
      total: String(parts.totals.total),
      total_krw: won(parts.totals.total),
      items_summary: (d.items || []).filter(it => String(it.name || '').trim()).map(it =>
        it.name + ' ' + toNum(it.qty) + (it.unit || 'EA') + '×' + wonPlain(it.price)
      ).join(' / '),
      account: sup.account || '',
      my_email: my
    };
    const jobs = [sendViaEmailjs(Object.assign({}, base, { to_email: to || my, cc_email: my && my !== to ? my : '' }))];
    if (my && my !== to) {
      jobs.push(sendViaEmailjs(Object.assign({}, base, { to_email: my, cc_email: to })));
    }
    await Promise.all(jobs);
    toast('이메일을 발송했습니다 · ' + [to, my].filter(Boolean).join(', '));
  } catch (err) {
    console.error(err);
    qLastMailto = buildQuoteMailto(d, my);
    toast('자동발송이 실패했습니다. 메일 앱으로 열어 보내 주세요.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label || '이메일 발송'; }
  }
}

/* ------------------------------ 초기화 · 이벤트 ------------------------------ */
function initQuote() {
  qDraft = reviveQuoteDraft(state.data.quoteDraft);
  fillQuoteForm();
  renderQuotePreview();
  renderQuoteHistory();
  renderEmailCfgState();
}

function renderQuote() {
  if (!qDraft) qDraft = newQuoteDraft();
  fillQuoteForm();
  renderQuotePreview();
  renderQuoteHistory();
  renderEmailCfgState();
  const presets = $('#receiverPresets');
  if (presets) {
    const names = Array.from(new Set(quoteList().map(q => q.receiver).filter(Boolean))).slice(0, 20);
    presets.innerHTML = names.map(n => '<option value="' + esc(n) + '"></option>').join('');
  }
}

function renderEmailCfgState() {
  const ready = isEmailjsReady();
  const stateEl = $('#emailCfgState');
  if (stateEl) stateEl.textContent = ready ? '1클릭 자동발송 사용 중' : '미설정 · 메일 앱으로 열기';
  const hint = $('#emailModeHint');
  if (hint) {
    hint.textContent = ready
      ? '이메일 발송을 누르면 수신 이메일과 내 메일로 동시에 자동 발송됩니다.'
      : '지금은 이메일 발송을 누르면 폰의 메일 앱이 견적 내용으로 채워진 채 열립니다. 아래 설정에서 EmailJS를 연결하면 앱에서 바로 자동발송됩니다.';
  }
}

function wireQuoteEvents() {
  if (!$('#quoteForm')) return;

  // 텍스트 필드 → 모델
  QUOTE_TEXT_FIELDS.forEach(([sel, key]) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('input', () => {
      if (!qDraft) qDraft = newQuoteDraft();
      qDraft[key] = el.value;
      refreshQuoteTotals();
      queueQuotePreview();
      if (key === 'notes') {
        qSettings().notes = el.value;
        save();
      }
    });
    el.addEventListener('change', () => {
      if (!qDraft) return;
      qDraft[key] = el.value;
      refreshQuoteTotals();
      queueQuotePreview();
    });
  });

  // 공급자 정보 → localStorage
  QUOTE_SUPPLIER_FIELDS.forEach(([sel, key]) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('input', () => {
      qSupplier()[key] = el.value;
      save();
      queueQuotePreview();
    });
  });

  const vat = $('#qVat');
  if (vat) {
    vat.addEventListener('change', () => {
      qDraft.vat = vat.checked;
      qSettings().vat = vat.checked;
      save();
      refreshQuoteTotals();
      queueQuotePreview();
    });
  }

  const myEmail = $('#qMyEmail');
  if (myEmail) {
    myEmail.addEventListener('input', () => {
      qSettings().myEmail = myEmail.value.trim();
      save();
    });
  }

  // 빠른 선택 칩
  const chips = $('#qTypeChips');
  if (chips) {
    chips.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-qtype]');
      if (!btn) return;
      const t = typeById(btn.dataset.qtype);
      if (!t) return;
      const same = qDraft.items.find(it => String(it.name).trim() === String(t.name).trim());
      if (same) {
        same.qty = toNum(same.qty) + 1;
        if (!toNum(same.price)) same.price = t.price;
        refreshQuoteTotals();
        renderQuoteRows();
        queueQuotePreview();
        toast(t.name + ' 수량을 1 늘렸습니다 (' + same.qty + ')');
        return;
      }
      const blank = qDraft.items.find(it => !String(it.name).trim() && !toNum(it.price));
      if (blank) {
        blank.name = t.name;
        blank.price = t.price;
        if (!toNum(blank.qty)) blank.qty = 1;
      } else {
        qDraft.items.push(blankQuoteItem(t.name, '기본', 'EA', 1, t.price));
      }
      renderQuoteRows();
      refreshQuoteTotals();
      queueQuotePreview();
      toast(t.name + ' 추가 · ' + won(t.price));
    });
  }

  const addRow = $('#quoteAddRow');
  if (addRow) {
    addRow.addEventListener('click', () => {
      qDraft.items.push(blankQuoteItem());
      renderQuoteRows();
      refreshQuoteTotals();
      queueQuotePreview();
      const rows = $$('#quoteRows .q-row');
      const last = rows[rows.length - 1];
      const input = last && $('.qr-name', last);
      if (input) input.focus();
    });
  }

  const rowsBox = $('#quoteRows');
  if (rowsBox) {
    rowsBox.addEventListener('input', ev => {
      const t = ev.target;
      if (!t.matches('input')) return;
      const row = t.closest('.q-row');
      if (!row) return;
      const it = qDraft.items.find(x => x.k === row.dataset.k);
      if (!it) return;
      if (t.classList.contains('qr-name')) it.name = t.value;
      else if (t.classList.contains('qr-spec')) it.spec = t.value;
      else if (t.classList.contains('qr-unit')) it.unit = t.value;
      else if (t.classList.contains('qr-qty')) {
        const clean = t.value.replace(/[^\d]/g, '').slice(0, 4);
        if (t.value !== clean) t.value = clean;
        it.qty = toNum(clean);
      } else if (t.classList.contains('qr-price')) {
        const caretEnd = t.selectionStart === t.value.length;
        const v = toNum(t.value);
        it.price = v;
        if (caretEnd) t.value = v ? wonPlain(v) : '';
      }
      const box = $('.qr-amount', row);
      if (box) box.innerHTML = quoteRowAmountHtml(it);
      refreshQuoteTotals();
      queueQuotePreview();
    });
    rowsBox.addEventListener('click', ev => {
      const del = ev.target.closest('[data-qdel]');
      if (!del) return;
      qDraft.items = qDraft.items.filter(x => x.k !== del.dataset.qdel);
      if (!qDraft.items.length) qDraft.items = [blankQuoteItem()];
      renderQuoteRows();
      refreshQuoteTotals();
      queueQuotePreview();
    });
  }

  const noAuto = $('#qNoAuto');
  if (noAuto) {
    noAuto.addEventListener('click', () => {
      qDraft.no = nextQuoteNo(qDraft.date);
      $('#qNo').value = qDraft.no;
      queueQuotePreview();
      toast('견적번호를 ' + qDraft.no + ' 로 정했습니다.');
    });
  }

  const notesReset = $('#qNotesReset');
  if (notesReset) {
    notesReset.addEventListener('click', () => {
      if (!confirm('비고를 기본 표준 문구로 되돌릴까요?')) return;
      qDraft.notes = DEFAULT_QUOTE_NOTES;
      qSettings().notes = DEFAULT_QUOTE_NOTES;
      $('#qNotes').value = DEFAULT_QUOTE_NOTES;
      save();
      queueQuotePreview();
      toast('기본 문구로 되돌렸습니다.');
    });
  }

  const newBtn = $('#quoteNew');
  if (newBtn) {
    newBtn.addEventListener('click', () => {
      if (!confirm('새 견적서를 작성할까요? 지금 작성 중인 내용은 저장하지 않으면 사라집니다.')) return;
      qDraft = newQuoteDraft();
      $('#qNotes').value = qDraft.notes;
      fillQuoteForm();
      persistQuoteDraft();
      renderQuotePreview();
      toast('새 견적서 · ' + qDraft.no);
    });
  }

  const saveBtn = $('#quoteSave');
  if (saveBtn) saveBtn.addEventListener('click', saveQuote);

  const printBtn = $('#quotePrint');
  if (printBtn) printBtn.addEventListener('click', printQuote);

  const pngBtn = $('#quotePng');
  if (pngBtn) {
    pngBtn.addEventListener('click', async () => {
      pngBtn.disabled = true;
      const size = await downloadQuotePng();
      pngBtn.disabled = false;
      toast(size ? '이미지를 저장했습니다 · ' + Math.round(size / 1024) + 'KB' : '이미지를 만들지 못했습니다.');
    });
  }

  const emailBtn = $('#quoteEmail');
  if (emailBtn) emailBtn.addEventListener('click', sendQuoteEmail);

  const zoomBtn = $('#quoteZoom');
  if (zoomBtn) zoomBtn.addEventListener('click', openQuoteImage);

  const hist = $('#quoteHistoryList');
  if (hist) {
    hist.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-qact]');
      if (!btn) return;
      const q = quoteList().find(x => x.id === btn.dataset.id);
      if (!q) return;
      const act = btn.dataset.qact;
      if (act === 'load') loadQuoteIntoForm(q, false);
      else if (act === 'copy') loadQuoteIntoForm(q, true);
      else if (act === 'del') deleteQuote(q.id);
      else if (act === 'sales') quoteToSales(q);
    });
  }

  const ejSave = $('#qEjSave');
  if (ejSave) {
    ejSave.addEventListener('click', () => {
      const cfg = {
        serviceId: $('#qEjService').value.trim(),
        templateId: $('#qEjTemplate').value.trim(),
        publicKey: $('#qEjPublic').value.trim()
      };
      qSettings().emailjs = cfg;
      save();
      renderEmailCfgState();
      if (cfg.serviceId && cfg.templateId && cfg.publicKey) toast('EmailJS 설정을 저장했습니다 · 이제 1클릭 자동발송');
      else toast('세 항목을 모두 채워야 자동발송이 켜집니다.');
    });
  }
  const ejClear = $('#qEjClear');
  if (ejClear) {
    ejClear.addEventListener('click', () => {
      qSettings().emailjs = { serviceId: '', templateId: '', publicKey: '' };
      $('#qEjService').value = '';
      $('#qEjTemplate').value = '';
      $('#qEjPublic').value = '';
      save();
      renderEmailCfgState();
      toast('EmailJS 설정을 지웠습니다 · 메일 앱으로 열기 모드');
    });
  }

  window.addEventListener('resize', debounce(() => {
    if (state.view.tab === 'quote') fitQuotePreview();
  }, 160));

  window.addEventListener('beforeprint', () => {
    if (state.view.tab === 'quote') buildPrintSheet();
  });
}

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
  /* 견적서 확인용 */
  quote() {
    if (!qDraft) return null;
    const t = quoteTotals(qDraft);
    return {
      draft: JSON.parse(JSON.stringify(qDraft)),
      totals: t,
      hangul: hangulNumber(t.total),
      saved: quoteList().length
    };
  },
  quoteHangul(n) { return hangulNumber(n); },
  quoteMailto() { return buildQuoteMailto(qDraft, qSettings().myEmail); },
  lastMailto() { return qLastMailto; },
  quotePngSize() {
    return downloadQuotePng();
  },
  resetStorage() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* noop */ }
    state.data = freshData();
    Object.assign(state.view, state.data.ui);
    renderAll();
    fillSaleForm(null);
    fillExpenseForm(null);
  }
};

/* ==========================================================================
   통화예약 (Reservations) · Google Sheets 양방향 연동
   - 구글시트 '통화예약 정리'(탭 시트1)의 6개 항목과 1:1 대응
     고객명 | 주소 | 청소수량 | 예약확정 일 및 시간 | 완료여부 | 기타
   - 시트 연동 전에도 로컬 저장 + 예시 2건으로 바로 사용 가능
   - 연동: 구글 Apps Script 웹앱을 JSONP(script 태그)로 호출
     (CORS 영향 없이 읽기·쓰기 모두 응답을 확인하고, 실패는 토스트로 알림)
   ========================================================================== */

const RESV_SHEET_ID = '14IO6RTTz3oITQYqPV_sC329-JbSPaCrv2cHlZm4kS7M';
const RESV_SHEET_URL = 'https://docs.google.com/spreadsheets/d/' + RESV_SHEET_ID + '/edit';
const RESV_TAB_NAME = '시트1';
const RESV_HEADERS = ['고객명', '주소', '청소수량', '예약확정 일 및 시간', '완료여부', '기타'];
const RESV_DONE_WORDS = ['완료', '완료됨', 'o', 'true', 'y', 'yes', '1', '✓', 'v', '완', 'ㅇ'];
const RESV_QTY_PRESETS = [
  '벽걸이 1대', '벽걸이 2대', '스탠드 1대', '벽걸이 1대 · 스탠드 1대',
  '투인원 1대', '천장형 4way 2대', '시스템 4way 4대'
];

const RESV_CODE_GS = `/*************************************************************
 * 해밀홈케어 · 통화예약 시트 연동 (Google Apps Script)
 * 대상 시트: 통화예약 정리 / 탭: 시트1
 * 열 순서: 고객명 | 주소 | 청소수량 | 예약확정 일 및 시간 | 완료여부 | 기타
 *
 * 사용법
 *  1) 시트에서 [확장 프로그램 → Apps Script] 열기
 *  2) 이 코드를 통째로 붙여넣고 저장(Ctrl+S)
 *  3) [배포 → 새 배포 → 유형: 웹 앱]
 *     - 실행: 나 / 액세스: 모든 사용자 → [배포]
 *  4) 나온 '웹 앱 URL'을 대시보드 통화예약 탭 → 연동 설정에 붙여넣기
 *
 * 코드를 고친 뒤에는 [배포 → 배포 관리 → 수정 → 새 버전] 으로 다시 배포해야 반영됩니다.
 *************************************************************/

var SHEET_NAME = '시트1';   // 탭 이름 (다르면 고쳐 주세요)
var TOKEN = '';             // 접근 토큰(선택): 앱의 '접근 토큰'과 같은 글자를 넣으면 주소를 알아도 못 읽습니다
var TIMEZONE = 'Asia/Seoul';
var HEAD = ['고객명', '주소', '청소수량', '예약확정 일 및 시간', '완료여부', '기타'];

function doGet(e) {
  return handle_(e);
}

function doPost(e) {
  return handle_(e);
}

function handle_(e) {
  var p = (e && e.parameter) || {};
  var body = {};
  if (e && e.postData && e.postData.contents) {
    try { body = JSON.parse(e.postData.contents) || {}; } catch (err) { body = {}; }
  }

  var action = String(p.action || body.action || 'list');
  var data = body;
  if (p.data) {
    try { data = JSON.parse(p.data) || {}; } catch (err) { data = {}; }
  }

  var out;
  var lock = null;
  try {
    if (TOKEN && String(p.t || data.t || '') !== TOKEN) {
      throw new Error('접근 토큰이 맞지 않습니다.');
    }

    if (action === 'list' || action === 'ping') {
      out = apiList_();
    } else if (action === 'append') {
      lock = lock_();
      out = apiAppend_(data.item || {});
    } else if (action === 'update') {
      lock = lock_();
      out = apiUpdate_(Number(data.row || p.row), data.item || {});
    } else if (action === 'delete') {
      lock = lock_();
      out = apiDelete_(Number(data.row || p.row), String(data.name || p.name || ''));
    } else {
      throw new Error('알 수 없는 요청입니다: ' + action);
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (err2) {} }
  }

  return reply_(out, p.callback);
}

function lock_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('시트가 다른 요청을 처리 중입니다. 잠시 뒤 다시 시도해 주세요.');
  return lock;
}

function reply_(obj, callback) {
  var name = String(callback || '').replace(/[^A-Za-z0-9_$.]/g, '');
  var json = JSON.stringify(obj);
  if (name) {
    return ContentService.createTextOutput(name + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------ 시트 ------------------------------ */
function sheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.getSheets()[0];
  return sh;
}

function ensureHead_(sh) {
  var first = String(sh.getRange(1, 1).getDisplayValue() || '').trim();
  if (first) return;
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
}

/** 머리글 이름으로 열 위치를 찾고, 없으면 기본 순서(1~6)를 씁니다. */
function cols_(sh) {
  var width = Math.max(HEAD.length, sh.getLastColumn());
  var head = sh.getRange(1, 1, 1, width).getDisplayValues()[0];
  var keys = ['name', 'addr', 'qty', 'when', 'done', 'memo'];
  var map = {};
  for (var i = 0; i < keys.length; i++) {
    var target = String(HEAD[i]).replace(/\\s/g, '');
    var found = -1;
    for (var j = 0; j < head.length; j++) {
      if (String(head[j]).replace(/\\s/g, '') === target) { found = j; break; }
    }
    map[keys[i]] = found >= 0 ? found + 1 : i + 1;
  }
  return map;
}

function text_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return dateText_(v);
  return String(v).trim();
}

function dateText_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd HH:mm');
  if (typeof v === 'number' && v > 20000) {
    var ms = Math.round((v - 25569) * 86400000);
    return Utilities.formatDate(new Date(ms), TIMEZONE, 'yyyy-MM-dd HH:mm');
  }
  return String(v).trim();
}

function done_(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined || v === '') return false;
  if (typeof v === 'number') return v !== 0;
  var s = String(v).trim().toLowerCase();
  return ['완료', '완료됨', 'o', 'true', 'y', 'yes', '1', '✓', 'v', '완', 'ㅇ'].indexOf(s) >= 0;
}

function apiList_() {
  var sh = sheet_();
  ensureHead_(sh);
  var c = cols_(sh);
  var last = sh.getLastRow();
  var items = [];
  if (last >= 2) {
    var width = Math.max(HEAD.length, sh.getLastColumn());
    var vals = sh.getRange(2, 1, last - 1, width).getValues();
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i];
      var name = text_(r[c.name - 1]);
      var addr = text_(r[c.addr - 1]);
      var qty = text_(r[c.qty - 1]);
      var memo = text_(r[c.memo - 1]);
      var when = dateText_(r[c.when - 1]);
      var done = done_(r[c.done - 1]);
      if (!name && !addr && !qty && !memo && !when && !done) continue;  // 빈 줄은 건너뜁니다
      items.push({ row: i + 2, name: name, addr: addr, qty: qty, when: when, done: done, memo: memo });
    }
  }
  return {
    ok: true,
    sheet: '통화예약 정리',
    tab: sh.getName(),
    count: items.length,
    items: items,
    updated: new Date().toISOString()
  };
}

function apiAppend_(item) {
  var sh = sheet_();
  ensureHead_(sh);
  var c = cols_(sh);
  var row = Math.max(2, sh.getLastRow() + 1);
  writeRow_(sh, c, row, item);
  return { ok: true, row: row };
}

function apiUpdate_(row, item) {
  var sh = sheet_();
  ensureHead_(sh);
  if (!(row >= 2)) throw new Error('행 번호가 없습니다.');
  if (row > sh.getLastRow()) throw new Error('그 행이 없습니다. 시트에서 지워졌을 수 있습니다.');
  writeRow_(sh, cols_(sh), row, item);
  return { ok: true, row: row };
}

function apiDelete_(row, name) {
  var sh = sheet_();
  if (!(row >= 2)) throw new Error('행 번호가 없습니다.');
  if (row > sh.getLastRow()) return { ok: true, row: row, skipped: true };

  var c = cols_(sh);
  var cur = String(text_(sh.getRange(row, c.name).getValue())).replace(/\\s/g, '');
  var want = String(name || '').replace(/\\s/g, '');
  if (want && cur && cur !== want) {
    throw new Error('행 내용이 달라 삭제하지 않았습니다(그 행: ' + cur + ').');
  }
  sh.deleteRow(row);
  return { ok: true, row: row };
}

function writeRow_(sh, c, row, item) {
  if (!item) return;
  if ('name' in item) sh.getRange(row, c.name).setValue(text_(item.name));
  if ('addr' in item) sh.getRange(row, c.addr).setValue(text_(item.addr));
  if ('qty' in item) sh.getRange(row, c.qty).setValue(text_(item.qty));
  if ('when' in item) sh.getRange(row, c.when).setValue(String(item.when || ''));
  if ('done' in item) sh.getRange(row, c.done).setValue(item.done ? '완료' : '미완료');
  if ('memo' in item) sh.getRange(row, c.memo).setValue(text_(item.memo));
}
`;

/* ------------------------------ 상태 ------------------------------ */
let resvFilter = 'all';
let resvQuery = '';
let resvEditing = null;
let resvBusy = false;
let resvAgain = false;
let resvJsonpSeq = 0;
let resvPushTimer = null;
let resvLastAutoPull = 0;

/* ------------------------------ 데이터 ------------------------------ */
function resvSyncCfg() {
  const d = state.data;
  if (!d) return { url: '', token: '', lastSyncAt: 0, lastError: '', pendingDeletes: [] };
  if (!d.resvSync || typeof d.resvSync !== 'object') {
    d.resvSync = { url: '', token: '', lastSyncAt: 0, lastError: '', pendingDeletes: [] };
  }
  const s = d.resvSync;
  if (!Array.isArray(s.pendingDeletes)) s.pendingDeletes = [];
  s.url = String(s.url || '');
  s.token = String(s.token || '');
  s.lastSyncAt = Number(s.lastSyncAt) || 0;
  s.lastError = String(s.lastError || '');
  return s;
}

function resvList() {
  if (!Array.isArray(state.data.reservations)) state.data.reservations = [];
  return state.data.reservations;
}

function resvById(id) { return resvList().find(r => r.id === id); }

function resvSameName(a, b) {
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
  return norm(a && a.name) === norm(b && b.name);
}

function resvKeyOf(x) {
  const name = String((x && x.name) || '').replace(/\s+/g, '').toLowerCase();
  const when = resvWhenNormalize((x && (x.when || x.whenText)) || '').replace(/\D/g, '');
  return name + '#' + when;
}

/* 예약일 표기: 'YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:mm' */
function resvJoinWhen(y, mo, d, h, mi) {
  const yy = String(y);
  const mm = pad2(Math.min(12, Math.max(1, Number(mo) || 1)));
  const dd = pad2(Math.min(31, Math.max(1, Number(d) || 1)));
  if (h == null || h === '') return yy + '-' + mm + '-' + dd;
  const hh = pad2(Math.min(23, Math.max(0, Number(h) || 0)));
  const mn = pad2(Math.min(59, Math.max(0, Number(mi) || 0)));
  return yy + '-' + mm + '-' + dd + 'T' + hh + ':' + mn;
}

function resvWhenNormalize(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?:[.\sT]+(\d{1,2})\s*[:시]\s*(\d{1,2})?)?/);
  if (m) return resvJoinWhen(m[1], m[2], m[3], m[4], m[5]);
  m = s.match(/^(\d{1,2})\s*[-./월]\s*(\d{1,2})일?(?:[.\s]+(\d{1,2})\s*[:시]\s*(\d{1,2})?)?/);
  if (m) return resvJoinWhen(new Date().getFullYear(), m[1], m[2], m[3], m[4] || '00');
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return todayStr() + 'T' + pad2(m[1]) + ':' + m[2];
  return '';
}

function resvWhenDate(when) {
  const m = String(when || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), 0, 0);
}

function resvDayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function resvWhenLabel(when) {
  const d = resvWhenDate(when);
  if (!d) return '';
  const base = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEKDAY[d.getDay()] + ')';
  return /T\d{2}:\d{2}$/.test(String(when)) ? base + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : base;
}

function resvWhenSheet(when) {
  if (!when) return '';
  return String(when).slice(0, 10) + (String(when).indexOf('T') > 0 ? ' ' + String(when).slice(11, 16) : '');
}

function resvDayTag(r) {
  if (r.done) return { label: '완료', cls: 'done' };
  const d = resvWhenDate(r.when);
  if (!d) return null;
  const diff = Math.round((resvDayStart(d.getTime()) - resvDayStart(Date.now())) / 86400000);
  if (diff === 0) return { label: '오늘', cls: 'today' };
  if (diff === 1) return { label: '내일', cls: 'today' };
  if (diff > 1) return { label: 'D-' + diff, cls: 'soon' };
  return { label: Math.abs(diff) + '일 지남', cls: 'past' };
}

function resvAgo(ts) {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return '방금 전';
  const min = Math.round(sec / 60);
  if (min < 60) return min + '분 전';
  const hour = Math.round(min / 60);
  if (hour < 24) return hour + '시간 전';
  const d = new Date(ts);
  return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function resvSampleSeed() {
  const plus = (n, time) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return toStr(d) + (time ? 'T' + time : '');
  };
  return [
    {
      name: '김지은 (예시)',
      addr: '서울 마포구 성산동 · ○○아파트 101동',
      qty: '벽걸이 2대',
      when: plus(2, '10:00'),
      done: false,
      memo: '오전 방문 요청 · 주차는 지하 2층',
      sample: true
    },
    {
      name: '박현수 (예시)',
      addr: '경기 성남시 분당구 · ○○오피스텔',
      qty: '벽걸이 1대 · 스탠드 1대',
      when: plus(-3, '14:00'),
      done: true,
      memo: '현장 카드 결제 완료 · 세금계산서 요청',
      sample: true
    }
  ].map(r => normalizeResv(Object.assign({ id: uid() }, r)));
}

function normalizeResv(r) {
  if (!r || typeof r !== 'object') return null;
  const when = resvWhenNormalize(r.when);
  const rowNum = toNum(r.row);
  return {
    id: String(r.id || uid()),
    name: String(r.name == null ? '' : r.name),
    addr: String(r.addr == null ? '' : r.addr),
    qty: String(r.qty == null ? '' : r.qty),
    when: when,
    whenText: when ? '' : String(r.whenText || ''),
    done: !!r.done,
    memo: String(r.memo == null ? '' : r.memo),
    sample: !!r.sample,
    row: rowNum >= 2 ? rowNum : null,
    pending: !!r.pending,
    updatedAt: Number(r.updatedAt) || Date.now()
  };
}

function resvNormalizeList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeResv).filter(Boolean);
}

/* ------------------------------ 계산 ------------------------------ */
function resvStats() {
  const list = resvList();
  const today = resvDayStart(Date.now());
  let open = 0, upcoming = 0, done = 0;
  list.forEach(r => {
    if (r.done) { done += 1; return; }
    open += 1;
    const d = resvWhenDate(r.when);
    if (d && resvDayStart(d.getTime()) >= today) upcoming += 1;
  });
  return { all: list.length, open: open, upcoming: upcoming, done: done };
}

function resvSort(a, b) {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1;
  const da = resvWhenDate(a.when), db = resvWhenDate(b.when);
  const ta = da ? da.getTime() : Infinity;
  const tb = db ? db.getTime() : Infinity;
  if (ta !== tb) return a.done ? tb - ta : ta - tb;
  return String(a.name).localeCompare(String(b.name), 'ko');
}

function resvFiltered() {
  const today = resvDayStart(Date.now());
  const q = resvQuery.trim().toLowerCase();
  let list = resvList().slice();

  if (resvFilter === 'open') list = list.filter(r => !r.done);
  else if (resvFilter === 'done') list = list.filter(r => r.done);
  else if (resvFilter === 'upcoming') list = list.filter(r => {
    if (r.done) return false;
    const d = resvWhenDate(r.when);
    return !!d && resvDayStart(d.getTime()) >= today;
  });

  if (q) {
    list = list.filter(r => [r.name, r.addr, r.qty, r.memo, r.whenText, resvWhenLabel(r.when)]
      .join(' ').toLowerCase().indexOf(q) >= 0);
  }
  return list.sort(resvSort);
}

/* ------------------------------ 렌더 ------------------------------ */
function renderResvSyncBar() {
  const cfg = resvSyncCfg();
  const dot = $('#resvSyncDot');
  if (!dot) return;
  const failed = !!cfg.lastError;
  dot.className = 'rs-dot ' + (!cfg.url ? 'off' : (failed ? 'err' : (resvBusy ? 'busy' : 'ok')));
  $('#resvSyncTitle').textContent = !cfg.url ? '시트 연동 전' : (failed ? '시트 연동 · 확인 필요' : '시트 연동됨');

  let desc;
  if (!cfg.url) desc = '연결하면 예약이 구글시트와 양방향으로 맞춰집니다.';
  else if (resvBusy) desc = '시트와 맞추는 중…';
  else if (failed) desc = cfg.lastError;
  else if (cfg.lastSyncAt) desc = '마지막 동기화 ' + resvAgo(cfg.lastSyncAt);
  else desc = '아직 한 번도 동기화하지 않았습니다. [지금 동기화]를 눌러 주세요.';
  $('#resvSyncDesc').textContent = desc;

  const btn = $('#resvSyncNow');
  btn.disabled = !cfg.url || resvBusy;
}

function renderResvSampleBanner() {
  const el = $('#resvSampleBanner');
  if (!el) return;
  const n = resvList().filter(r => r.sample).length;
  if (!n) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML =
    '<div class="banner-text"><div><strong>예시 예약 ' + n + '건이 들어 있습니다.</strong> 화면을 확인해 보고 실제 예약으로 시작하려면 지워 주세요.</div></div>' +
    '<div class="banner-actions"><button type="button" class="btn btn-sm" data-resv-act="clear-sample">예시 예약 지우기</button></div>';
}

function resvEmptyHtml() {
  if (resvQuery.trim()) return '<li class="empty">‘' + esc(resvQuery.trim()) + '’ 검색 결과가 없습니다.</li>';
  if (resvFilter === 'done') return '<li class="empty">완료한 예약이 없습니다.</li>';
  if (resvFilter === 'open' || resvFilter === 'upcoming') return '<li class="empty">미완료 예약이 없습니다. 모두 끝냈습니다.</li>';
  return '<li class="empty">예약이 없습니다.<br><b>+ 새 예약</b>으로 첫 예약을 넣어 보세요.</li>';
}

function resvCardHtml(r) {
  const tag = resvDayTag(r);
  const whenTxt = resvWhenLabel(r.when) || r.whenText;
  const cfg = resvSyncCfg();
  const html = [];
  html.push('<li class="resv-card' + (r.done ? ' is-done' : '') + '" data-resv-id="' + esc(r.id) + '">');
  html.push('<button type="button" class="rc-check" data-resv-act="toggle" role="checkbox" aria-checked="' +
    (r.done ? 'true' : 'false') + '" aria-label="' + esc(r.name || '예약') + ' 완료 표시">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg></button>');
  html.push('<div class="rc-body">');
  html.push('<div class="rc-top"><strong class="rc-name">' + esc(r.name || '이름 없음') + '</strong>' +
    (tag ? '<span class="rc-tag ' + tag.cls + '">' + esc(tag.label) + '</span>' : '') +
    (r.sample ? '<span class="rc-tag sample">예시</span>' : '') + '</div>');
  if (whenTxt) html.push('<div class="rc-when">' + esc(whenTxt) + '</div>');
  if (r.addr) html.push('<div class="rc-addr">' + esc(r.addr) + '</div>');
  const chips = [];
  if (r.qty) chips.push('<span class="rc-chip">' + esc(r.qty) + '</span>');
  if (cfg.url && r.pending) chips.push('<span class="rc-chip pending">시트 전송 대기</span>');
  if (chips.length) html.push('<div class="rc-meta">' + chips.join('') + '</div>');
  if (r.memo) html.push('<p class="rc-memo">' + esc(r.memo) + '</p>');
  html.push('<div class="rc-actions"><button type="button" data-resv-act="edit">수정</button>' +
    '<button type="button" data-resv-act="del" class="del">삭제</button></div>');
  html.push('</div></li>');
  return html.join('');
}

function renderResvNavCount(st) {
  const n = st ? st.upcoming : resvStats().upcoming;
  ['#resvNavCount', '#resvNavCountTop'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.textContent = String(n);
    el.hidden = n === 0;
  });
}

function renderResv() {
  if (!state.data) return;
  renderResvSyncBar();
  renderResvSampleBanner();

  const st = resvStats();
  $('#resvStatAll').textContent = String(st.all);
  $('#resvStatOpen').textContent = String(st.open);
  $('#resvStatUp').textContent = String(st.upcoming);

  $$('#resvFilter button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.resvFilter === resvFilter)));
  $$('[data-resv-stat]').forEach(b => b.classList.toggle('is-active', b.dataset.resvStat === resvFilter));

  const search = $('#resvSearch');
  if (search && search.value !== resvQuery) search.value = resvQuery;

  const list = resvFiltered();
  $('#resvList').innerHTML = list.length ? list.map(resvCardHtml).join('') : resvEmptyHtml();

  const names = { all: '전체', open: '미완료', upcoming: '예정', done: '완료' };
  $('#resvHint').textContent = names[resvFilter] + ' ' + list.length + '건 · 예정은 미완료 중 예약일이 남은 예약입니다. 완료는 동그라미를 한 번 누르면 됩니다.';

  renderResvNavCount(st);
}

/* ------------------------------ 모달 ------------------------------ */
let resvModalOpener = null;

function openResvModal(id, opener) {
  const el = document.getElementById(id);
  if (!el) return;
  resvModalOpener = opener || document.activeElement;
  el.hidden = false;
  document.body.classList.add('modal-open');
}

function closeResvModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('modal-open');
  if (resvModalOpener && resvModalOpener.focus) {
    try { resvModalOpener.focus(); } catch (err) { /* 무시 */ }
  }
  resvModalOpener = null;
}

function closeAllResvModals() {
  $$('.modal').forEach(el => { el.hidden = true; });
  document.body.classList.remove('modal-open');
}

/* ------------------------------ 예약 추가·수정 ------------------------------ */
function openResvForm(r) {
  resvEditing = r ? r.id : null;
  $('#resvFormTitle').textContent = r ? '예약 수정' : '새 예약';
  $('#resvFormDelete').hidden = !r;

  $('#rvName').value = r ? r.name : '';
  $('#rvAddr').value = r ? r.addr : '';
  $('#rvQty').value = r ? r.qty : '';
  $('#rvMemo').value = r ? r.memo : '';
  $('#rvDone').checked = !!(r && r.done);

  const when = r ? r.when : '';
  $('#rvDate').value = r ? String(when).slice(0, 10) : todayStr();
  $('#rvTime').value = when && String(when).indexOf('T') > 0 ? String(when).slice(11, 16) : '';

  openResvModal('resvModal', r ? document.activeElement : $('#resvAddBtn'));
  setTimeout(() => { try { $('#rvName').focus(); } catch (err) { /* 무시 */ } }, 60);
}

function saveResvForm(ev) {
  if (ev) ev.preventDefault();
  const name = $('#rvName').value.trim();
  if (!name) {
    toast('고객명을 넣어 주세요.');
    $('#rvName').focus();
    return;
  }
  const date = $('#rvDate').value;
  const time = $('#rvTime').value;
  const when = date ? (time ? date + 'T' + time : date) : '';
  const fields = {
    name: name,
    addr: $('#rvAddr').value.trim(),
    qty: $('#rvQty').value.trim(),
    when: when,
    done: $('#rvDone').checked,
    memo: $('#rvMemo').value.trim()
  };

  const editing = resvEditing ? resvById(resvEditing) : null;
  if (editing) {
    Object.assign(editing, fields, {
      whenText: '',
      sample: false,
      pending: !!resvSyncCfg().url,
      updatedAt: Date.now()
    });
  } else {
    resvList().push(normalizeResv(Object.assign({ id: uid() }, fields, { pending: !!resvSyncCfg().url })));
  }

  save();
  closeResvModal('resvModal');
  resvEditing = null;
  renderResv();
  toast(editing ? '예약을 고쳤습니다.' : '예약을 추가했습니다.');
  resvSchedulePush();
}

function resvToggle(r) {
  r.done = !r.done;
  r.updatedAt = Date.now();
  r.pending = !!resvSyncCfg().url;
  save();
  renderResv();
  toast(r.done ? '완료로 표시했습니다.' : '미완료로 되돌렸습니다.');
  resvSchedulePush();
}

function resvDelete(r, skipConfirm) {
  const cfg = resvSyncCfg();
  const willSheet = !!(cfg.url && r.row);
  if (!skipConfirm) {
    const msg = (r.name || '예약') + ' 예약을 삭제할까요?' + (willSheet ? '\n구글시트에서도 함께 지워집니다.' : '');
    if (!confirm(msg)) return;
  }
  if (willSheet) cfg.pendingDeletes.push({ row: r.row, name: r.name });
  state.data.reservations = resvList().filter(x => x.id !== r.id);
  save();
  closeResvModal('resvModal');
  renderResv();
  toast('삭제했습니다.');
  resvSchedulePush();
}

function clearResvSample() {
  const n = resvList().filter(r => r.sample).length;
  if (!n) { toast('지울 예시 예약이 없습니다.'); return; }
  if (!confirm('예시 예약 ' + n + '건을 지울까요?')) return;
  state.data.reservations = resvList().filter(r => !r.sample);
  save();
  renderResv();
  toast('예시 예약을 지웠습니다.');
}

/* ------------------------------ 시트 연동 ------------------------------ */
function resvJsonp(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const name = '__resvCb' + (++resvJsonpSeq);
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => {
      try { delete window[name]; } catch (err) { window[name] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('응답 시간이 초과됐습니다.'));
    }, timeoutMs || 20000);

    window[name] = (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error('시트에 연결하지 못했습니다. 웹 앱 배포(액세스: 모든 사용자)와 주소를 확인해 주세요.'));
    };
    script.async = true;
    script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + name;
    document.body.appendChild(script);
  });
}

function resvApi(action, payload) {
  const cfg = resvSyncCfg();
  if (!cfg.url) return Promise.reject(new Error('시트 연동 주소가 없습니다.'));
  const params = new URLSearchParams();
  params.set('action', action);
  if (cfg.token) params.set('t', cfg.token);
  if (payload) params.set('data', JSON.stringify(payload));
  params.set('_', String(Date.now()));
  const url = cfg.url + (cfg.url.indexOf('?') >= 0 ? '&' : '?') + params.toString();
  return resvJsonp(url).then(res => {
    if (!res || res.ok !== true) throw new Error((res && res.error) || '시트가 오류를 돌려보냈습니다.');
    return res;
  });
}

function resvSheetPayload(r) {
  const item = {
    name: r.name || '',
    addr: r.addr || '',
    qty: r.qty || '',
    done: !!r.done,
    memo: r.memo || ''
  };
  if (r.when) item.when = resvWhenSheet(r.when);
  return item;
}

function resvApplyRemote(it, rem) {
  it.name = String(rem.name == null ? '' : rem.name);
  it.addr = String(rem.addr == null ? '' : rem.addr);
  it.qty = String(rem.qty == null ? '' : rem.qty);
  it.memo = String(rem.memo == null ? '' : rem.memo);
  const when = resvWhenNormalize(rem.when);
  it.when = when;
  it.whenText = when ? '' : String(rem.when == null ? '' : rem.when);
  it.done = (rem.done === true) ||
    (typeof rem.done === 'string' && RESV_DONE_WORDS.indexOf(rem.done.trim().toLowerCase()) >= 0);
  it.row = Number(rem.row) || null;
  it.pending = false;
  it.sample = false;
}

/** 시트 목록을 로컬에 합칩니다. 시트가 기준이되, 앱에서 고친(pending) 항목은 앱이 우선입니다. */
function resvMergeRemote(remote) {
  const cfg = resvSyncCfg();
  const list = resvList();
  const rows = (remote || []).filter(x => x && Number(x.row) >= 2);
  const skip = new Set((cfg.pendingDeletes || []).map(d => Number(d.row)));
  const byRow = new Map();
  rows.forEach(x => {
    const n = Number(x.row);
    if (!skip.has(n)) byRow.set(n, x);
  });

  // 시트가 통째로 비어 있으면(실수로 지운 경우) 로컬 기록을 잃지 않도록 다시 올립니다.
  const sheetEmpty = byRow.size === 0;

  const claimed = new Set();
  const next = [];
  let dropped = 0;

  list.forEach(it => {
    if (it.sample) { next.push(it); return; }
    if (it.pending) {
      if (it.row) claimed.add(Number(it.row));
      next.push(it);
      return;
    }
    if (sheetEmpty && it.row) {
      it.row = null;
      it.pending = true;
      next.push(it);
      return;
    }

    let rem = it.row ? byRow.get(Number(it.row)) : null;
    if (rem && !resvSameName(it, rem)) {
      const alt = rows.find(x => !claimed.has(Number(x.row)) && resvKeyOf(x) === resvKeyOf(it));
      if (alt) rem = alt;
    }
    if (!rem && !it.row) {
      rem = rows.find(x => !claimed.has(Number(x.row)) && resvKeyOf(x) === resvKeyOf(it)) || null;
    }

    if (rem) {
      claimed.add(Number(rem.row));
      resvApplyRemote(it, rem);
      next.push(it);
      return;
    }
    if (it.row) { dropped += 1; return; }  // 시트에서 지워진 예약
    next.push(it);                          // 아직 시트에 없는 로컬 예약
  });

  byRow.forEach((x, row) => {
    if (claimed.has(row)) return;
    const item = normalizeResv({ id: uid() });
    resvApplyRemote(item, x);
    next.push(item);
  });

  state.data.reservations = next;
  return dropped;
}

/** 앱에서 고친 것과 삭제 대기를 시트로 보냅니다. 보낸 개수를 돌려줍니다. */
function resvPushPending() {
  const cfg = resvSyncCfg();
  const work = [];
  let ops = 0;

  const dels = (cfg.pendingDeletes || []).slice().sort((a, b) => Number(b.row) - Number(a.row));
  for (let i = 0; i < dels.length; i++) {
    const d = dels[i];
    work.push(
      resvApi('delete', { row: Number(d.row), name: d.name })
        .then(() => {
          cfg.pendingDeletes = (cfg.pendingDeletes || []).filter(x => x !== d);
          ops += 1;
        })
        .catch(err => {
          const msg = String((err && err.message) || err);
          if (msg.indexOf('행이 없습니다') >= 0 || msg.indexOf('행 번호가 없습니다') >= 0 || msg.indexOf('skipped') >= 0) {
            cfg.pendingDeletes = (cfg.pendingDeletes || []).filter(x => x !== d);
            return;
          }
          throw err;
        })
    );
  }

  resvList().forEach(it => {
    if (it.sample) return;
    if (!it.pending && it.row) return;
    if (!it.pending && !it.row) it.pending = true;

    work.push((async () => {
      const payload = { item: resvSheetPayload(it) };
      if (it.row) {
        try {
          await resvApi('update', { row: it.row, item: payload.item });
        } catch (err) {
          it.row = null;  // 그 행이 사라졌으면 아래에서 새로 추가
        }
      }
      if (!it.row) {
        const res = await resvApi('append', payload);
        it.row = Number(res.row) || null;
      }
      it.pending = false;
      ops += 1;
      save();
    })());
  });

  return Promise.all(work).then(() => ops);
}

function resvSchedulePush() {
  if (!resvSyncCfg().url) return;
  clearTimeout(resvPushTimer);
  resvPushTimer = setTimeout(() => { resvSyncNow({ silent: true }); }, 700);
}

function resvSyncNow(opts) {
  opts = opts || {};
  const cfg = resvSyncCfg();
  if (!cfg.url) {
    if (!opts.silent) { openResvSetup(); }
    return Promise.resolve(false);
  }
  if (resvBusy) { resvAgain = true; return Promise.resolve(false); }

  resvBusy = true;
  resvLastAutoPull = Date.now();
  renderResvSyncBar();
  if (opts.fromSetup) setResvSetupState('', '시트와 연결을 확인하는 중…');

  return resvApi('list')
    .then(res => {
      const dropped = resvMergeRemote(res.items || []);
      return resvPushPending().then(pushed => ({ pushed: pushed, dropped: dropped, count: res.items ? res.items.length : 0 }));
    })
    .then(info => {
      cfg.lastSyncAt = Date.now();
      cfg.lastError = '';
      save();
      resvBusy = false;
      renderResvSyncBar();
      renderResv();
      if (opts.fromSetup || !opts.silent) {
        const msg = '시트와 연결됐습니다 · 시트 ' + info.count + '건' + (info.pushed ? ' · ' + info.pushed + '건 반영' : '');
        if (opts.fromSetup) setResvSetupState('ok', msg + ' 이제 예약을 고치면 시트로 바로 보내고, 앱을 열 때 시트 내용을 받아옵니다.');
        toast(msg);
      }
      if (info.dropped > 0 && !opts.silent) toast('시트에서 지워진 예약 ' + info.dropped + '건을 정리했습니다.');
      return true;
    })
    .catch(err => {
      resvBusy = false;
      cfg.lastError = String((err && err.message) || err);
      save();
      renderResvSyncBar();
      if (opts.fromSetup) setResvSetupState('err', cfg.lastError);
      if (!opts.silent || opts.fromSetup) toast('시트 연동 실패: ' + cfg.lastError);
      return false;
    })
    .then(ok => {
      if (resvAgain) {
        resvAgain = false;
        setTimeout(() => { resvSyncNow({ silent: true }); }, 400);
      }
      return ok;
    });
}

/* ------------------------------ 연동 설정 ------------------------------ */
function setResvSetupState(kind, text) {
  const el = $('#resvSetupState');
  if (!el) return;
  el.className = 'resv-setup-state' + (kind ? ' ' + kind : '');
  el.textContent = text || '';
}

function openResvSetup() {
  const cfg = resvSyncCfg();
  $('#resvUrl').value = cfg.url;
  $('#resvToken').value = cfg.token;
  $('#resvCodeView').textContent = RESV_CODE_GS;
  setResvSetupState(cfg.url && !cfg.lastError ? 'ok' : (cfg.lastError ? 'err' : ''),
    cfg.lastError || (cfg.url ? '연결되어 있습니다. 마지막 동기화 ' + (cfg.lastSyncAt ? resvAgo(cfg.lastSyncAt) : '없음') : ''));
  openResvModal('resvSetupModal', $('#resvSetupBtn'));
}

function resvSaveCfg() {
  const url = $('#resvUrl').value.trim().replace(/\s/g, '');
  const token = $('#resvToken').value.trim();
  if (!url) { setResvSetupState('err', '웹 앱 URL을 넣어 주세요.'); return; }
  if (!/^https:\/\/script\.google\.com\//.test(url)) {
    setResvSetupState('err', '웹 앱 URL은 https://script.google.com/macros/s/…/exec 형태여야 합니다.');
    return;
  }
  const cfg = resvSyncCfg();
  cfg.url = url;
  cfg.token = token;
  cfg.lastError = '';
  save();
  setResvSetupState('ok', '저장했습니다. 시트와 연결을 확인합니다…');
  resvSyncNow({ fromSetup: true });
}

function resvClearCfg() {
  const cfg = resvSyncCfg();
  if (!cfg.url) { setResvSetupState('', '연결된 주소가 없습니다.'); return; }
  if (!confirm('시트 연동을 끊을까요?\n화면의 예약은 그대로 남고, 더 이상 시트와 맞추지 않습니다.')) return;
  cfg.url = '';
  cfg.token = '';
  cfg.lastError = '';
  cfg.lastSyncAt = 0;
  save();
  $('#resvUrl').value = '';
  $('#resvToken').value = '';
  setResvSetupState('', '연결을 끊었습니다.');
  renderResv();
  toast('시트 연동을 끊었습니다.');
}

function resvCopyCode() {
  const done = () => {
    setResvSetupState('ok', 'Code.gs를 복사했습니다. 시트의 Apps Script 창에 붙여넣고 저장(Ctrl+S)하세요.');
    toast('Code.gs를 복사했습니다.');
  };
  const text = RESV_CODE_GS;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => resvCopyFallback(text, done));
  } else {
    resvCopyFallback(text, done);
  }
}

function resvCopyFallback(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-2000px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
  ta.remove();
  if (ok) done();
  else setResvSetupState('err', '복사가 막혀 있습니다. 위 [코드 보기]를 열어 직접 선택해 복사해 주세요.');
}

function resvDownloadCode() {
  download('통화예약_Code.gs', RESV_CODE_GS, 'text/plain;charset=utf-8');
  toast('Code.gs 파일을 내려받았습니다.');
}

/* ------------------------------ 이벤트 ------------------------------ */
function wireResvEvents() {
  document.addEventListener('click', ev => {
    const closeBtn = ev.target.closest('[data-close]');
    if (closeBtn) {
      const kind = closeBtn.dataset.close;
      closeResvModal(kind === 'setup' ? 'resvSetupModal' : 'resvModal');
      return;
    }
    const resvAct = ev.target.closest('[data-resv-act]');
    if (!resvAct) return;
    const act = resvAct.dataset.resvAct;
    if (act === 'clear-sample') { clearResvSample(); return; }
    const card = resvAct.closest('[data-resv-id]');
    const r = card ? resvById(card.dataset.resvId) : null;
    if (!r) return;
    if (act === 'toggle') resvToggle(r);
    else if (act === 'edit') openResvForm(r);
    else if (act === 'del') resvDelete(r);
  });

  $('#resvAddBtn').addEventListener('click', () => openResvForm(null));
  $('#resvForm').addEventListener('submit', saveResvForm);
  $('#resvFormDelete').addEventListener('click', () => {
    const r = resvEditing ? resvById(resvEditing) : null;
    if (r) resvDelete(r);
  });

  $$('[data-resv-quick]').forEach(b => b.addEventListener('click', () => {
    const d = new Date();
    if (b.dataset.resvQuick === 'tomorrow') d.setDate(d.getDate() + 1);
    $('#rvDate').value = toStr(d);
    if (!$('#rvTime').value) $('#rvTime').value = '10:00';
  }));

  $('#resvFilter').addEventListener('click', ev => {
    const b = ev.target.closest('[data-resv-filter]');
    if (!b) return;
    resvFilter = b.dataset.resvFilter;
    renderResv();
  });

  $$('[data-resv-stat]').forEach(b => b.addEventListener('click', () => {
    resvFilter = b.dataset.resvStat;
    renderResv();
  }));

  let qTimer = null;
  $('#resvSearch').addEventListener('input', ev => {
    resvQuery = ev.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(renderResv, 120);
  });

  $('#resvSyncNow').addEventListener('click', () => resvSyncNow({}));
  $('#resvSetupBtn').addEventListener('click', openResvSetup);
  $('#resvSaveCfg').addEventListener('click', resvSaveCfg);
  $('#resvCfgClear').addEventListener('click', resvClearCfg);
  $('#resvCopyCode').addEventListener('click', resvCopyCode);
  $('#resvDownloadCode').addEventListener('click', resvDownloadCode);

  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    if (!document.querySelector('.modal:not([hidden])')) return;
    closeAllResvModals();
  });

  window.addEventListener('online', () => {
    if (resvSyncCfg().url) resvSyncNow({ silent: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const cfg = resvSyncCfg();
    if (!cfg.url) return;
    if (Date.now() - resvLastAutoPull < 5 * 60 * 1000) return;
    resvSyncNow({ silent: true });
  });
}

function initResv() {
  const datalist = $('#rvQtyPresets');
  if (datalist) {
    datalist.innerHTML = RESV_QTY_PRESETS.map(v => '<option value="' + esc(v) + '"></option>').join('');
  }
  wireResvEvents();
  renderResv();
  if (resvSyncCfg().url) {
    setTimeout(() => { resvSyncNow({ silent: true }); }, 900);
  }
}
