import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchRequest, handleRequest, nextUsage, taipeiDate } from './handler.js';

const ORIGIN = 'https://practk.github.io';
const ENV = {
  ALLOWED_ORIGIN: ORIGIN,
  ACCESS_CODE: 'correct-code',
  GOOGLE_MAPS_API_KEY: 'server-key',
  DAILY_LIMIT: '32',
};
const LOCATION = { latitude: 25.03, longitude: 121.56 };
const USAGE = { today: 3, dailyLimit: 32, month: 40 };

function fakeCounter({ allowed = true } = {}) {
  const dates = [];
  return {
    dates,
    async consume(date) {
      dates.push(date);
      return { allowed, usage: USAGE };
    },
    async read() {
      return USAGE;
    },
  };
}

function fakeGoogle(response = { places: [{ id: 'a' }] }, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response), { status });
  };
  return { calls, fetchImpl };
}

function searchRequest({ code = 'correct-code', origin = ORIGIN, body = { query: '麵', location: LOCATION } } = {}) {
  return new Request('https://api.example.dev/search', {
    method: 'POST',
    headers: { Origin: origin, 'X-Access-Code': code, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function run(request, { counter = fakeCounter(), google = fakeGoogle(), now } = {}) {
  const response = await handleRequest(request, ENV, { counter, fetchImpl: google.fetchImpl, now });
  return { response, counter, google };
}

test('taipeiDate 用台灣時間換日', () => {
  assert.equal(taipeiDate(new Date('2026-11-05T15:59:00Z')), '2026-11-05');
  assert.equal(taipeiDate(new Date('2026-11-05T16:00:00Z')), '2026-11-06');
});

test('nextUsage 額度內會加一', () => {
  const state = { date: '2026-11-05', month: '2026-11', today: 3, monthTotal: 40 };
  assert.deepEqual(nextUsage(state, '2026-11-05', 32), {
    allowed: true,
    state: { date: '2026-11-05', month: '2026-11', today: 4, monthTotal: 41 },
  });
});

test('nextUsage 第 32 次放行，第 33 次拒絕且不再加一', () => {
  const base = { date: '2026-11-05', month: '2026-11', monthTotal: 100 };
  assert.equal(nextUsage({ ...base, today: 31 }, '2026-11-05', 32).allowed, true);
  const blocked = nextUsage({ ...base, today: 32 }, '2026-11-05', 32);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.state.today, 32);
  assert.equal(blocked.state.monthTotal, 100);
});

test('nextUsage 換日時今日歸零但本月累計保留', () => {
  const state = { date: '2026-11-05', month: '2026-11', today: 32, monthTotal: 100 };
  assert.deepEqual(nextUsage(state, '2026-11-06', 32).state, {
    date: '2026-11-06',
    month: '2026-11',
    today: 1,
    monthTotal: 101,
  });
});

test('nextUsage 換月時本月累計歸零', () => {
  const state = { date: '2026-11-30', month: '2026-11', today: 5, monthTotal: 500 };
  assert.equal(nextUsage(state, '2026-12-01', 32).state.monthTotal, 1);
});

test('nextUsage 第一次使用沒有舊資料', () => {
  assert.deepEqual(nextUsage(undefined, '2026-11-05', 32).state, {
    date: '2026-11-05',
    month: '2026-11',
    today: 1,
    monthTotal: 1,
  });
});

test('nextUsage 額度為 0 時只讀取：套用換日但不加一', () => {
  const state = { date: '2026-11-05', month: '2026-11', today: 7, monthTotal: 50 };
  assert.deepEqual(nextUsage(state, '2026-11-05', 0).state, state);
  assert.equal(nextUsage(state, '2026-11-06', 0).state.today, 0);
  assert.equal(nextUsage(state, '2026-12-01', 0).state.monthTotal, 0);
});

test('buildSearchRequest 以使用者位置為中心查繁中結果', () => {
  assert.deepEqual(buildSearchRequest('  牛肉麵 ', LOCATION), {
    textQuery: '牛肉麵',
    languageCode: 'zh-TW',
    regionCode: 'TW',
    rankPreference: 'DISTANCE',
    pageSize: 20,
    locationBias: {
      circle: { center: { latitude: 25.03, longitude: 121.56 }, radius: 2000 },
    },
  });
});

test('密碼錯誤時回 401，不計次也不查 Google', async () => {
  const { response, counter, google } = await run(searchRequest({ code: 'wrong' }));
  assert.equal(response.status, 401);
  assert.equal(counter.dates.length, 0);
  assert.equal(google.calls.length, 0);
});

test('來源網址不符時回 403，不查 Google', async () => {
  const { response, google } = await run(searchRequest({ origin: 'https://evil.example' }));
  assert.equal(response.status, 403);
  assert.equal(google.calls.length, 0);
});

for (const [label, body] of [
  ['關鍵字空白', { query: '   ', location: LOCATION }],
  ['關鍵字過長', { query: '麵'.repeat(101), location: LOCATION }],
  ['關鍵字不是文字', { query: 123, location: LOCATION }],
  ['沒有位置', { query: '麵' }],
  ['緯度超出範圍', { query: '麵', location: { latitude: 91, longitude: 121 } }],
  ['經度不是數字', { query: '麵', location: { latitude: 25, longitude: 'x' } }],
  ['不是 JSON', '{壞掉'],
]) {
  test(`${label}時回 400，不計次也不查 Google`, async () => {
    const { response, counter, google } = await run(searchRequest({ body }));
    assert.equal(response.status, 400);
    assert.equal(counter.dates.length, 0);
    assert.equal(google.calls.length, 0);
  });
}

test('超過額度時回 429 並附用量，不查 Google', async () => {
  const { response, google } = await run(searchRequest(), {
    counter: fakeCounter({ allowed: false }),
  });
  assert.equal(response.status, 429);
  assert.deepEqual((await response.json()).usage, USAGE);
  assert.equal(google.calls.length, 0);
});

test('查詢成功時用伺服器的金鑰和欄位查 Google，回傳店家與用量', async () => {
  const { response, google } = await run(searchRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { places: [{ id: 'a' }], usage: USAGE });

  const { url, init } = google.calls[0];
  assert.equal(url, 'https://places.googleapis.com/v1/places:searchText');
  assert.equal(init.headers['X-Goog-Api-Key'], 'server-key');
  assert.match(init.headers['X-Goog-FieldMask'], /places\.reviewSummary/);
  assert.equal(JSON.parse(init.body).textQuery, '麵');
});

test('計次用台灣日期', async () => {
  const { counter } = await run(searchRequest(), { now: new Date('2026-11-05T16:00:00Z') });
  assert.deepEqual(counter.dates, ['2026-11-06']);
});

test('Google 回沒有 places 時回傳空陣列', async () => {
  const { response } = await run(searchRequest(), { google: fakeGoogle({}) });
  assert.deepEqual((await response.json()).places, []);
});

test('Google 失敗時回 502 並附用量，不把 Google 的內容傳給前端', async () => {
  const google = fakeGoogle({ error: { message: 'key=server-key 無效' } }, 403);
  const { response } = await run(searchRequest(), { google });
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(text.includes('server-key'), false);
  assert.deepEqual(JSON.parse(text).usage, USAGE);
});

test('所有回應只允許指定網址跨網域存取', async () => {
  const { response } = await run(searchRequest());
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('跨網域預檢允許密碼標頭，不需密碼也不計次', async () => {
  const request = new Request('https://api.example.dev/search', {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN },
  });
  const { response, counter } = await run(request);
  assert.equal(response.status, 204);
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /x-access-code/i);
  assert.equal(counter.dates.length, 0);
});

test('查用量要密碼，且不計次', async () => {
  const usageRequest = (code) =>
    new Request('https://api.example.dev/usage', { headers: { Origin: ORIGIN, 'X-Access-Code': code } });
  assert.equal((await run(usageRequest('wrong'))).response.status, 401);

  const { response, counter } = await run(usageRequest('correct-code'));
  assert.deepEqual(await response.json(), { usage: USAGE });
  assert.equal(counter.dates.length, 0);
});

test('沒有設定密碼時一律拒絕，不會變成不用密碼', async () => {
  const response = await handleRequest(searchRequest({ code: '' }), { ...ENV, ACCESS_CODE: '' }, {
    counter: fakeCounter(),
    fetchImpl: fakeGoogle().fetchImpl,
  });
  assert.equal(response.status, 401);
});

test('不存在的路徑回 404', async () => {
  const request = new Request('https://api.example.dev/other', {
    headers: { Origin: ORIGIN, 'X-Access-Code': 'correct-code' },
  });
  assert.equal((await run(request)).response.status, 404);
});
