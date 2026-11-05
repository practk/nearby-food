export const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

// 這些欄位決定計費層級：rating 和營業時間屬於 Enterprise，再加 Atmosphere 類欄位會更貴。
export const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.currentOpeningHours.openNow',
].join(',');

const EARTH_RADIUS_METERS = 6371000;
const SEARCH_RADIUS_METERS = 2000;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

export function distanceMeters(a, b) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
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

export function toRestaurant(place, origin) {
  return {
    id: place.id,
    name: place.displayName.text,
    distance: distanceMeters(origin, place.location),
    isOpen: place.currentOpeningHours?.openNow ?? null,
    rating: place.rating ?? null,
    ratingCount: place.userRatingCount ?? 0,
    mapsUrl: place.googleMapsUri,
  };
}

// 營業時間不明的店不算已打烊，「只看營業中」時保留，避免漏掉 Google 沒有時間資料的小店。
export function filterAndSort(restaurants, { openOnly = false, maxDistance = Infinity }) {
  return restaurants
    .filter((r) => !(openOnly && r.isOpen === false) && r.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
}

export function describeApiError(status) {
  if (status === 400 || status === 401 || status === 403) {
    return 'API 金鑰無效或未授權這個網址，請檢查金鑰設定。';
  }
  // Google 的每日配額在太平洋時間午夜重置，換算台灣時間是下午 3 或 4 點（依日光節約時間）。
  if (status === 429) return '查詢次數已達上限，台灣時間下午 3 到 4 點會自動恢復。';
  return '查詢失敗，請稍後再試。';
}
