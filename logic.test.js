import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchRequest,
  describeApiError,
  distanceMeters,
  filterAndSort,
  formatDistance,
  toRestaurant,
} from './logic.js';

const TAIPEI_101 = { latitude: 25.033964, longitude: 121.564468 };
const TAIPEI_MAIN = { latitude: 25.047924, longitude: 121.517081 };

test('distanceMeters 算出台北 101 到台北車站約 5 公里', () => {
  const meters = distanceMeters(TAIPEI_101, TAIPEI_MAIN);
  assert.ok(meters > 4900 && meters < 5100, `實際為 ${meters}`);
});

test('distanceMeters 同一點為 0', () => {
  assert.equal(distanceMeters(TAIPEI_101, TAIPEI_101), 0);
});

for (const [meters, want] of [
  [120.4, '120 m'],
  [999, '999 m'],
  [1000, '1.0 km'],
  [1540, '1.5 km'],
]) {
  test(`formatDistance(${meters}) 顯示 ${want}`, () => {
    assert.equal(formatDistance(meters), want);
  });
}

test('buildSearchRequest 以使用者位置為中心查繁中結果', () => {
  assert.deepEqual(buildSearchRequest('麵', TAIPEI_101), {
    textQuery: '麵',
    languageCode: 'zh-TW',
    regionCode: 'TW',
    rankPreference: 'DISTANCE',
    pageSize: 20,
    locationBias: {
      circle: {
        center: { latitude: 25.033964, longitude: 121.564468 },
        radius: 2000,
      },
    },
  });
});

test('buildSearchRequest 去除關鍵字前後空白', () => {
  assert.equal(buildSearchRequest('  牛肉麵 ', TAIPEI_101).textQuery, '牛肉麵');
});

const FULL_PLACE = {
  id: 'abc',
  displayName: { text: '範例牛肉麵', languageCode: 'zh-TW' },
  location: { latitude: 25.033964, longitude: 121.564468 },
  rating: 4.5,
  userRatingCount: 120,
  googleMapsUri: 'https://maps.google.com/?cid=1',
  currentOpeningHours: { openNow: true },
  reviewSummary: {
    text: { text: '顧客稱讚牛肉軟嫩。\n\n部分評論提到偏鹹。', languageCode: 'zh-TW' },
    disclosureText: { text: '摘要由 Gemini 生成', languageCode: 'zh-TW' },
    flagContentUri: 'https://www.google.com/flag',
    reviewsUri: 'https://www.google.com/reviews',
  },
};

test('toRestaurant 轉出畫面需要的欄位', () => {
  assert.deepEqual(toRestaurant(FULL_PLACE, TAIPEI_101), {
    id: 'abc',
    name: '範例牛肉麵',
    distance: 0,
    isOpen: true,
    rating: 4.5,
    ratingCount: 120,
    mapsUrl: 'https://maps.google.com/?cid=1',
    summary: {
      text: '顧客稱讚牛肉軟嫩。\n\n部分評論提到偏鹹。',
      disclosure: '摘要由 Gemini 生成',
      flagUrl: 'https://www.google.com/flag',
      reviewsUrl: 'https://www.google.com/reviews',
    },
  });
});

test('toRestaurant 店家沒有營業時間時 isOpen 為 null，而不是當成已打烊', () => {
  const { currentOpeningHours, ...noHours } = FULL_PLACE;
  assert.equal(toRestaurant(noHours, TAIPEI_101).isOpen, null);
});

test('toRestaurant 明確打烊時 isOpen 為 false', () => {
  const closed = { ...FULL_PLACE, currentOpeningHours: { openNow: false } };
  assert.equal(toRestaurant(closed, TAIPEI_101).isOpen, false);
});

test('toRestaurant 沒有評分時 rating 為 null', () => {
  const { rating, userRatingCount, ...noRating } = FULL_PLACE;
  const result = toRestaurant(noRating, TAIPEI_101);
  assert.equal(result.rating, null);
  assert.equal(result.ratingCount, 0);
});

test('toRestaurant 沒有 AI 評論摘要時 summary 為 null', () => {
  const { reviewSummary, ...noSummary } = FULL_PLACE;
  assert.equal(toRestaurant(noSummary, TAIPEI_101).summary, null);
});

test('toRestaurant 摘要缺少 Gemini 標示時不顯示摘要', () => {
  const { disclosureText, ...unlabeled } = FULL_PLACE.reviewSummary;
  const place = { ...FULL_PLACE, reviewSummary: unlabeled };
  assert.equal(toRestaurant(place, TAIPEI_101).summary, null);
});

const LIST = [
  { id: 'far', distance: 900, isOpen: true },
  { id: 'near', distance: 100, isOpen: false },
  { id: 'edge', distance: 500, isOpen: true },
  { id: 'unknown', distance: 300, isOpen: null },
];
const ids = (list) => list.map((r) => r.id);

test('filterAndSort 預設全部保留並由近到遠', () => {
  assert.deepEqual(ids(filterAndSort(LIST, {})), ['near', 'unknown', 'edge', 'far']);
});

test('filterAndSort 只看營業中時保留營業時間不明的店', () => {
  assert.deepEqual(ids(filterAndSort(LIST, { openOnly: true })), ['unknown', 'edge', 'far']);
});

test('filterAndSort 距離上限包含剛好 500 m 的店', () => {
  assert.deepEqual(ids(filterAndSort(LIST, { maxDistance: 500 })), ['near', 'unknown', 'edge']);
});

test('filterAndSort 不改動傳入的陣列', () => {
  const before = ids(LIST);
  filterAndSort(LIST, { openOnly: true });
  assert.deepEqual(ids(LIST), before);
});

for (const [rating, kept] of [[4.0, true], [3.9, false], [null, false]]) {
  test(`filterAndSort 評價下限 4.0 時，評分 ${rating} ${kept ? '保留' : '排除'}`, () => {
    const list = [{ id: 'x', distance: 100, isOpen: true, rating }];
    assert.equal(filterAndSort(list, { minRating: 4.0 }).length, kept ? 1 : 0);
  });
}

test('filterAndSort 沒設評價下限時保留沒有評分的店', () => {
  const list = [{ id: 'x', distance: 100, isOpen: true, rating: null }];
  assert.equal(filterAndSort(list, {}).length, 1);
});

for (const [status, keyword] of [
  [403, '金鑰'],
  [429, '上限'],
  [500, '稍後'],
]) {
  test(`describeApiError(${status}) 提到「${keyword}」`, () => {
    assert.match(describeApiError(status), new RegExp(keyword));
  });
}
