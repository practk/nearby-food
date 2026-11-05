import { API_URL, CATEGORIES } from './config.js?v=5';
import {
  describeApiError,
  filterAndSort,
  formatDistance,
  formatUsage,
  toRestaurant,
} from './logic.js?v=5';

const WITHIN_METERS = 500;
const MIN_RATING = 4.0;
// Google 規定 AI 評論摘要要附上「資料如何產生」的說明連結
const ABOUT_SUMMARY_URL = 'https://support.google.com/local-listings/answer/9851099';
const CODE_STORAGE_KEY = 'nearby-food-access-code';
const CIRCLE_PATH = 'M50 6C78 4 97 16 96 32C95 49 70 58 44 56C20 54 2 45 4 29C6 13 28 3 58 5';

const form = document.querySelector('#search-form');
const input = document.querySelector('#search-input');
const categories = document.querySelector('#categories');
const openOnly = document.querySelector('#open-only');
const within500 = document.querySelector('#within-500');
const minRating = document.querySelector('#min-rating');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const resultsBody = document.querySelector('#results-body');
const attribution = document.querySelector('#attribution');
const codeForm = document.querySelector('#code-form');
const codeInput = document.querySelector('#code-input');
const usageLine = document.querySelector('#usage');

let restaurants = [];
let lastQuery = '';
let latestSearch = 0;

function showResults(visible) {
  results.hidden = !visible;
  attribution.hidden = !visible;
}

function showStatus(message) {
  status.textContent = message;
  showResults(false);
}

function showCodeForm(message) {
  localStorage.removeItem(CODE_STORAGE_KEY);
  codeForm.hidden = false;
  showStatus(message);
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

async function callApi(path, init = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init.headers, 'X-Access-Code': localStorage.getItem(CODE_STORAGE_KEY) },
  });
  const data = await response.json().catch(() => ({}));
  if (data.usage) usageLine.textContent = formatUsage(data.usage);
  if (!response.ok) {
    throw Object.assign(new Error(describeApiError(response.status)), { status: response.status });
  }
  return data;
}

async function fetchPlaces(query, location) {
  const { places } = await callApi('/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, location }),
  });
  return places;
}

async function loadUsage() {
  try {
    await callApi('/usage');
  } catch (error) {
    if (error.status === 401) showCodeForm(error.message);
  }
}

async function search(query) {
  lastQuery = query;
  restaurants = [];
  if (!localStorage.getItem(CODE_STORAGE_KEY)) {
    showCodeForm('輸入密碼後就能查詢。');
    return;
  }
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
    if (error.status === 401) {
      showCodeForm(error.message);
      return;
    }
    const isNetworkError = error instanceof TypeError;
    showStatus(isNetworkError ? '連不上網路，請確認連線後再查詢一次。' : error.message);
  }
}

function externalLink(href) {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

// Google 規定評論摘要要完整顯示，並附上標題、緊接在下方且不可改動的 Gemini 標示，以及三個連結。
function renderSummary(summary) {
  const box = document.createElement('div');
  box.className = 'summary';
  box.append(
    textElement('h2', 'summary-title', '評論摘要'),
    textElement('p', 'summary-text', summary.text),
    textElement('p', 'summary-disclosure', summary.disclosure),
  );

  const links = document.createElement('div');
  links.className = 'summary-links';
  for (const [href, text] of [
    [summary.reviewsUrl, '看評論'],
    [summary.flagUrl, '回報摘要'],
    [ABOUT_SUMMARY_URL, '關於這份摘要'],
  ]) {
    const link = externalLink(href);
    link.textContent = text;
    links.append(link);
  }
  box.append(links);
  return box;
}

function renderRow(restaurant) {
  const row = resultsBody.insertRow();
  const link = externalLink(restaurant.mapsUrl);

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

  const distanceLink = externalLink(restaurant.mapsUrl);
  distanceLink.tabIndex = -1;
  distanceLink.className = 'distance';
  distanceLink.textContent = formatDistance(restaurant.distance);

  link.append(name, detail);
  const nameCell = row.insertCell();
  nameCell.append(link);
  if (restaurant.summary) nameCell.append(renderSummary(restaurant.summary));
  row.insertCell().append(distanceLink);
}

function renderResults() {
  const visible = filterAndSort(restaurants, {
    openOnly: openOnly.checked,
    maxDistance: within500.checked ? WITHIN_METERS : Infinity,
    minRating: minRating.checked ? MIN_RATING : 0,
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
  showResults(true);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  input.blur();
  markCategory(null);
  search(query);
});

codeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = codeInput.value.trim();
  if (!code) return;
  localStorage.setItem(CODE_STORAGE_KEY, code);
  codeInput.value = '';
  codeInput.blur();
  codeForm.hidden = true;
  if (lastQuery) {
    search(lastQuery);
  } else {
    showStatus('點一個類型，或輸入想吃的。');
    loadUsage();
  }
});

// 篩選只在已取得的結果上運作，不會重新查詢，所以不花查詢額度。
for (const filter of [openOnly, within500, minRating]) {
  filter.addEventListener('change', () => {
    if (restaurants.length > 0) renderResults();
  });
}

renderCategories();
if (localStorage.getItem(CODE_STORAGE_KEY)) {
  showStatus('點一個類型，或輸入想吃的。');
  loadUsage();
} else {
  showCodeForm('輸入密碼後就能查詢。');
}
