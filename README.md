# 今天吃什麼

手機用的附近餐廳查詢網頁。點類型或輸入想吃的，用目前位置即時查 Google Places，由近到遠列出，點店家開 Google Maps。

店家資料不存檔，每次查詢都是即時結果。

## 設定 Google API 金鑰

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立專案並綁定帳單帳戶。
2. 在 API 程式庫啟用 **Places API (New)**。
3. 到「憑證」建立 API 金鑰，再編輯它：
   - 應用程式限制選「網站」，加入 `https://<你的帳號>.github.io/*`。
   - API 限制選「限制金鑰」，只勾 Places API (New)。
4. 到 Google Maps Platform 的「配額」頁面，選 Places API (New)，把 Text Search 的**每日**配額改成 `32`。
5. 把金鑰填進 `config.js` 的 `API_KEY`。

Google Cloud 免費試用期間無法編輯配額，第 4 步可以先略過：試用期不會收費，用量只會扣 US$300 贈金。試用約 90 天後結束，要繼續使用就得升級成付費帳戶，**升級後要立刻補做第 4 步**。

查詢包含 AI 評論摘要，計費項目是 Text Search Enterprise + Atmosphere，超過免費額度後每 1,000 次 US$40。每月免費額度是 1,000 次，除以 31 天就是 32 次／天，超過當天就會查詢失敗，不會產生費用。**預算設定只會寄警告，不會擋下用量，一定要設每日配額。** 配額在太平洋時間午夜重置，也就是台灣時間下午 3 到 4 點。

## 本機預覽

定位功能只能在 HTTPS 或 localhost 使用，直接開啟檔案不行。

```bash
python -m http.server 5500
```

然後開 `http://localhost:5500`。本機測試時，金鑰的網站限制要暫時加上 `http://localhost:5500/*`。

## 部署到 GitHub Pages

金鑰會公開在 `config.js`，所以上一節的網站限制和每日配額要先設好。

```bash
gh auth login
gh repo create nearby-food --public --source . --push
gh api repos/{owner}/nearby-food/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

## 調整

- 類型標籤：改 `config.js` 的 `CATEGORIES`，文字會直接當搜尋關鍵字。
- 測試：`npm test`。
- 更新檔案後：GitHub Pages 會讓瀏覽器快取 10 分鐘，舊手機可能繼續用舊檔。修改 `config.js`、`logic.js`、`app.js` 或 `style.css` 時，要把 `index.html` 和 `app.js` 裡的 `?v=` 版本號加一。
