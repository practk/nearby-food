const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

// 這些欄位決定 Google 的計費層級：reviewSummary 屬於最高的 Enterprise + Atmosphere，每次查詢都以該層級計費。
// 放在伺服器端，避免有人改前端要求更貴的欄位。
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.reviewSummary',
  'places.currentOpeningHours.openNow',
].join(',');

const SEARCH_RADIUS_METERS = 2000;
const MAX_QUERY_LENGTH = 100;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taipeiDate(now) {
  return new Date(now.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export function nextUsage(state, date, limit) {
  const month = date.slice(0, 7);
  const today = state?.date === date ? state.today : 0;
  const monthTotal = state?.month === month ? state.monthTotal : 0;
  const allowed = today < limit;
  const added = allowed ? 1 : 0;
  return {
    allowed,
    state: { date, month, today: today + added, monthTotal: monthTotal + added },
  };
}

export function buildSearchRequest(query, location) {
  return {
    textQuery: query.trim(),
    languageCode: 'zh-TW',
    regionCode: 'TW',
    rankPreference: 'DISTANCE',
    pageSize: 20,
    locationBias: {
      circle: {
        center: { latitude: location.latitude, longitude: location.longitude },
        radius: SEARCH_RADIUS_METERS,
      },
    },
  };
}

function isCoordinate(value, limit) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

function isValidSearch(body) {
  const query = body?.query;
  const location = body?.location;
  return (
    typeof query === 'string' &&
    query.trim().length > 0 &&
    query.length <= MAX_QUERY_LENGTH &&
    isCoordinate(location?.latitude, 90) &&
    isCoordinate(location?.longitude, 180)
  );
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,x-access-code',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
}

function json(env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function search(request, env, { counter, fetchImpl, now }) {
  const body = await request.json().catch(() => null);
  if (!isValidSearch(body)) return json(env, 400, { error: 'invalid_request' });

  const date = taipeiDate(now);
  const { allowed, usage } = await counter.consume(date, Number(env.DAILY_LIMIT));
  if (!allowed) return json(env, 429, { error: 'quota_exceeded', usage });

  const google = await fetchImpl(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(buildSearchRequest(body.query, body.location)),
  }).catch(() => null);

  // 已送出的查詢可能已被 Google 計費，所以失敗也算一次。Google 的錯誤內容不傳給前端，避免洩漏金鑰。
  if (!google?.ok) return json(env, 502, { error: 'upstream_failed', usage });

  const data = await google.json();
  return json(env, 200, { places: data.places ?? [], usage });
}

export async function handleRequest(request, env, { counter, fetchImpl = fetch, now = new Date() }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });

  // Origin 可被非瀏覽器程式偽造，只用來擋掉其他網站；真正的存取控制是下面的密碼。
  if (request.headers.get('Origin') !== env.ALLOWED_ORIGIN) return json(env, 403, { error: 'forbidden' });

  const code = request.headers.get('X-Access-Code');
  if (!env.ACCESS_CODE || code !== env.ACCESS_CODE) return json(env, 401, { error: 'invalid_code' });

  const { pathname } = new URL(request.url);
  if (request.method === 'POST' && pathname === '/search') {
    return search(request, env, { counter, fetchImpl, now });
  }
  if (request.method === 'GET' && pathname === '/usage') {
    const usage = await counter.read(taipeiDate(now), Number(env.DAILY_LIMIT));
    return json(env, 200, { usage });
  }
  return json(env, 404, { error: 'not_found' });
}
