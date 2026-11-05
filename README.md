# 今天吃什麼

手機用的附近餐廳查詢網頁。點類型或輸入想吃的，用目前位置即時查 Google Places，由近到遠列出，店家下方附 AI 評論摘要，點店家開 Google Maps。

店家資料不存檔，每次查詢都是即時結果。

```text
手機網頁（GitHub Pages）→ Cloudflare Worker（檢查密碼、計次、保管金鑰）→ Google Places API
```

- 網頁：https://practk.github.io/nearby-food/
- Worker：https://nearby-food-api.practk.workers.dev

Google 金鑰和查詢密碼只存在 Worker 的 secrets，不在網頁或 repo 裡。

## 額度

Worker 用 Durable Object 計數，所有裝置合計每天最多 32 次，超過就不會再查 Google，台灣時間午夜歸零。每次查詢算 1 次，切換篩選和開連結不算。上限在 `worker/wrangler.toml` 的 `DAILY_LIMIT`。

查詢包含 AI 評論摘要，計費項目是 Text Search Enterprise + Atmosphere，每月免費 1,000 次，超過後每 1,000 次 US$40。32 次是 1,000 除以 31 天。

Google Cloud 免費試用期間不會收費，也無法編輯配額。試用約 90 天後結束，要繼續使用就得升級成付費帳戶，**升級後要立刻到 Google Maps Platform 的「配額」頁面，把 `SearchTextRequest per day` 設成 32**，當第二道保險。預算設定只會寄警告，不會擋下用量。

## 更換金鑰或密碼

在 `worker/` 建立 `secrets.json`（不進版控），寫入要更換的項目，上傳後刪除：

```json
{
  "GOOGLE_MAPS_API_KEY": "新的 Google 金鑰",
  "ACCESS_CODE": "新的查詢密碼"
}
```

```bash
cd worker
node node_modules/wrangler/bin/wrangler.js secret bulk secrets.json
```

Google 金鑰的應用程式限制選「無」（呼叫來自 Worker，沒有網站來源），API 限制只勾 Places API (New)。更換密碼後，手機下次查詢時會要求重新輸入。

## 部署

- 網頁：推送到 `main` 後 GitHub Pages 會自動更新。
- Worker：`cd worker && npm install && node node_modules/wrangler/bin/wrangler.js deploy`。

wrangler 固定在 4.80.0，因為更新的版本需要 Node 22。

## 調整

- 類型標籤：改 `config.js` 的 `CATEGORIES`，文字會直接當搜尋關鍵字。
- 測試：`npm test`，包含網頁邏輯和 Worker。
- 更新檔案後：GitHub Pages 會讓瀏覽器快取 10 分鐘，舊手機可能繼續用舊檔。修改 `config.js`、`logic.js`、`app.js` 或 `style.css` 時，要把 `index.html` 和 `app.js` 裡的 `?v=` 版本號加一。
