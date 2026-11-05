import { API_KEY, CATEGORIES } from './config.js';
import {
  FIELD_MASK,
  SEARCH_URL,
  buildSearchRequest,
  describeApiError,
  filterAndSort,
  formatDistance,
  toRestaurant,
} from './logic.js';

const WITHIN_METERS = 500;
const CIRCLE_PATH = 'M50 6C78 4 97 16 96 32C95 49 70 58 44 56C20 54 2 45 4 29C6 13 28 3 58 5';

const form = document.querySelector('#search-form');
const input = document.querySelector('#search-input');
const categories = document.querySelector('#categories');
const openOnly = document.querySelector('#open-only');
const within500 = document.querySelector('#within-500');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const resultsBody = document.querySelector('#results-body');

let restaurants = [];
let lastQuery = '';
let latestSearch = 0;

function showStatus(message) {
  status.textContent = message;
  results.hidden = true;
}

function renderCategories() {
  for (const name of CATEGORIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category';
    button.textContent = name;
    button.setAttribute('aria-pressed', 'false');
    button.insertAdjacentHTML(
      'beforeend',
      `<svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="${CIRCLE_PATH}"/></svg>`,
    );
    button.addEventListener('click', () => {
      input.value = '';
      markCategory(button);
      search(name);
    });
    categories.append(button);
  }
}

function markCategory(selected) {
  for (const button of categories.children) {
    button.setAttribute('aria-pressed', String(button === selected));
  }
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

async function fetchPlaces(query, location) {
  const response = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(buildSearchRequest(query, location)),
  });
  if (!response.ok) throw new Error(describeApiError(response.status));
  const data = await response.json();
  return data.places ?? [];
}

async function search(query) {
  if (!API_KEY) {
    showStatus('還沒有設定 API 金鑰，請在 config.js 填入。');
    return;
  }
  lastQuery = query;
  restaurants = [];
  // 連續點不同類型時，只顯示最後一次查詢的結果，避免慢回來的舊結果蓋掉新的。
  const searchId = ++latestSearch;
  showStatus('正在取得你的位置');
  let location;
  try {
    location = await getPosition();
  } catch {
    if (searchId === latestSearch) {
      showStatus('沒有取得定位。請允許這個網頁使用位置，再查詢一次。');
    }
    return;
  }
  if (searchId !== latestSearch) return;

  showStatus(`正在查詢附近的${query}`);
  try {
    const places = await fetchPlaces(query, location);
    if (searchId !== latestSearch) return;
    restaurants = places.map((place) => toRestaurant(place, location));
    renderResults();
  } catch (error) {
    if (searchId !== latestSearch) return;
    const isNetworkError = error instanceof TypeError;
    showStatus(isNetworkError ? '連不上網路，請確認連線後再查詢一次。' : error.message);
  }
}

function renderRow(restaurant) {
  const row = resultsBody.insertRow();
  const link = document.createElement('a');
  link.href = restaurant.mapsUrl;
  link.target = '_blank';
  link.rel = 'noopener';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = restaurant.name;

  const detail = document.createElement('span');
  detail.className = 'detail';
  if (restaurant.isOpen !== null) {
    const open = document.createElement('span');
    open.textContent = restaurant.isOpen ? '營業中' : '已打烊';
    open.classList.toggle('closed', !restaurant.isOpen);
    detail.append(open);
  }
  if (restaurant.rating !== null) {
    const rating = document.createElement('span');
    rating.textContent = `★${restaurant.rating.toFixed(1)}（${restaurant.ratingCount} 則）`;
    detail.append(rating);
  }

  const distanceLink = link.cloneNode(false);
  distanceLink.tabIndex = -1;
  distanceLink.className = 'distance';
  distanceLink.textContent = formatDistance(restaurant.distance);

  link.append(name, detail);
  row.insertCell().append(link);
  row.insertCell().append(distanceLink);
}

function renderResults() {
  const visible = filterAndSort(restaurants, {
    openOnly: openOnly.checked,
    maxDistance: within500.checked ? WITHIN_METERS : Infinity,
  });
  resultsBody.replaceChildren();
  if (restaurants.length === 0) {
    showStatus(`附近沒有找到「${lastQuery}」，換個說法再查詢一次，例如「牛肉麵」。`);
    return;
  }
  if (visible.length === 0) {
    showStatus('目前的勾選條件下沒有店家，取消勾選就能看到其他店。');
    return;
  }
  visible.forEach(renderRow);
  status.textContent = '';
  results.hidden = false;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  input.blur();
  markCategory(null);
  search(query);
});

// 篩選只在已取得的結果上運作，不會重新查詢，所以不花查詢額度。
for (const filter of [openOnly, within500]) {
  filter.addEventListener('change', () => {
    if (restaurants.length > 0) renderResults();
  });
}

renderCategories();
showStatus('點一個類型，或輸入想吃的。');
