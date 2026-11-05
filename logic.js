const EARTH_RADIUS_METERS = 6371000;

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

// Google 規定 AI 摘要必須附上 Gemini 標示，缺標示時寧可不顯示。
function toSummary(reviewSummary) {
  const text = reviewSummary?.text?.text;
  const disclosure = reviewSummary?.disclosureText?.text;
  if (!text || !disclosure) return null;
  return {
    text,
    disclosure,
    flagUrl: reviewSummary.flagContentUri,
    reviewsUrl: reviewSummary.reviewsUri,
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
    summary: toSummary(place.reviewSummary),
  };
}

// 營業時間不明的店不算已打烊，「只看營業中」時保留，避免漏掉 Google 沒有時間資料的小店。
export function filterAndSort(restaurants, { openOnly = false, maxDistance = Infinity, minRating = 0 }) {
  return restaurants
    .filter((r) => !(openOnly && r.isOpen === false) && r.distance <= maxDistance)
    .filter((r) => (r.rating ?? 0) >= minRating)
    .sort((a, b) => a.distance - b.distance);
}

export function describeApiError(status) {
  if (status === 401) return '密碼不正確，請重新輸入。';
  if (status === 429) return '今天的查詢次數已用完，台灣時間午夜會恢復。';
  return '查詢失敗，請稍後再試。';
}

export function formatUsage({ today, dailyLimit, month }) {
  return `今日 ${today}／${dailyLimit} 次，本月 ${month} 次`;
}
