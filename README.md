# 澳賣GOT

澳門鄰里二手議價市集 — 白底黑字 VSCO 風 SPA + Express API。

英文簡稱：**MoGOT**

標語：**一物一故事 · 閑置亦有價**

資料存在後端（登入、刊登、議價、訊息、我想要互通）。主題色仍存在瀏覽器。

## 功能

- **首頁**：搜尋、分類、價錢、雙欄刊登；分頁捲動載入，載入時顯示骨架，失敗可重試
- **登入／註冊**：註冊後要先打開認證電郵，完成後先可以登入。刊登、議價、訊息、收藏需登入。訪客仍可瀏覽刊登
- **商品詳情**：大圖、說明、賣家街坊紀錄（售出／買入、回覆、短評）、「議價」「收藏」／賣家標示已售。已接受出價的買家可「確認收貨」，然後為賣家留星數與一句留言
- **議價**：出價、交收方式、留言 → 建立對話；狀態為待回覆／已接受／已拒絕／回價
- **見面**：出價已接受後，買賣雙方可提議並確認見面時間與地點（澳門地標或自訂）。平台不代收款
- **防騙提示**：議價、訊息、見面卡都有同一句：面交、唔好預付、平台唔託管唔鑑定
- **刊登**：至少一張相片，建議多角度；狀況附一句說明；相簿與拍照仍可用。上傳前會先壓縮
- **訊息／議價**：底部紅點顯示未讀訊息、需要你回覆的出價，以及新提醒。我的 → 訊息提醒可開本機通知。關掉 App 的商店推播尚未接入，見 `STORE_CHECKLIST.md`
- **我的**：我的刊登、已售、收藏，以及街坊成交與評價
- **信任**：只顯示街坊之間的成交、回覆與短評。平台不鑑定、不代收款、不代為寄倉
- **隱私政策**：`GET http://127.0.0.1:8787/privacy`（聯絡電郵 `mogot.app@gmail.com`）
- **支援**：`GET http://127.0.0.1:8787/support`（同一電郵；上架支援網址用這個路徑）

底部導覽：首頁 · 訊息 · 刊登(+) · 議價 · 我的

## 啟動（兩個終端）

**終端 1 — API**

```bash
cd /workspace/aomai-got
npm run server:install   # 第一次
npm run server
```

或：

```bash
cd /workspace/aomai-got/server
npm install && npm start
```

**終端 2 — 前端**

```bash
cd /workspace/aomai-got
npm install
npm run dev
```

瀏覽器打開 Vite Local URL（預設 `http://127.0.0.1:5173`）。

沒有預設示範帳號。註冊後要先打開認證電郵，完成後先可以登入。寄信設定見 `server/README.md`（`SMTP_URL` 或 `RESEND_API_KEY`，以及 `MAIL_FROM`）。

可選環境變數：`VITE_API_URL`（預設 `http://127.0.0.1:8787`）。

正式建置：

```bash
npm run build
npm run preview
```

## 技術

- Vite + Vanilla HTML / CSS / JS（hash routing）
- Express API（port 8787）+ JSON 檔案庫 `server/data/aomai.json`
- Render Free 不能保留檔案。`render.yaml` 用付費 Starter，並把 1 GB 磁碟掛在 `/var/data`。只有 `/var/data` 底下的路徑在重新部署後還在（`DATA_DIR=/var/data/db`、`UPLOADS_DIR=/var/data/uploads`）
- JWT（jsonwebtoken）+ bcryptjs
- Capacitor iOS / Android 包殼（上架仍需 Mac + Developer 帳號）

詳見 `server/README.md`。可直接貼上 App Store Connect 的文案、截圖尺寸與隱私營養標籤草稿見 `docs/APP_STORE.md`。圖示與推播憑證見 `STORE_CHECKLIST.md`。

## 品牌 Logo

檔案在 `public/brand/`：

| 檔案 | 用途 |
|------|------|
| `logo-light.jpg` | 白底黑字 — 首頁 topbar、我的頁品牌條 |
| `logo-dark.jpg` | 介面顏色 — 關於彈窗黑底條；可作 App icon／啟動畫面素材 |

iOS 主畫面圖示是 `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`，與 `public/icons/icon-1024.png` 同一張黑底堆疊「澳賣GOT」。啟動畫面在 `Splash.imageset`，底色是純黑。`favicon.svg` 仍是簡化「澳」字。Android 圖示尚未更換。

## Capacitor 原生包殼（iOS / Android）

本專案已用 Capacitor 包成可在 Xcode / Android Studio 開啟的原生專案。  
**重要：此 Linux 環境無法簽署 IPA 或上傳 App Store。** 上架必須用你本人的 **Mac + Xcode + Apple Developer 帳號**（付費會員）完成。

| 項目 | 值 |
|------|-----|
| App 顯示名稱 | 澳賣GOT |
| 英文簡稱 | MoGOT |
| Bundle / App ID | `com.aomai.got` |
| Web 輸出目錄 | `dist/`（Vite 預設） |
| 設定檔 | `capacitor.config.json` |
| iOS 專案 | `ios/App/App.xcodeproj` |
| Android 專案 | `android/` |

### 日常：改完網頁後同步到原生

```bash
cd /workspace/aomai-got   # 或你 Mac 上的專案路徑
npm install
npm run build:mobile      # = vite build + npx cap sync
```

也可分開跑：`npm run build` → `npx cap sync`。

### 在 Mac 用 Xcode 開 iOS（上架必經）

1. 把整個 `aomai-got` 資料夾拷到 Mac（或 git clone）。
2. 安裝 [Xcode](https://developer.apple.com/xcode/)（App Store）並登入你的 Apple ID。
3. 在專案目錄執行：
   ```bash
   npm install
   npm run build:mobile
   npx cap open ios
   ```
   （等同開啟 `ios/App/App.xcodeproj`。）
4. 在 Xcode：**Signing & Capabilities** → 勾選 *Automatically manage signing* → 選你的 **Team**（需已加入 [Apple Developer Program](https://developer.apple.com/programs/)）。
5. 上方裝置選 **Any iOS Device (arm64)**（不要選模擬器）。
6. 選單 **Product → Archive**。成功後在 Organizer 按 **Distribute App** → App Store Connect → Upload。
7. 到 [App Store Connect](https://appstoreconnect.apple.com/) 建立 App（Bundle ID 選 `com.aomai.got`）。名稱、副標題、描述、關鍵字、支援網址 `https://aomai-got.onrender.com/support`、隱私政策網址見 `docs/APP_STORE.md`。截圖請自行擷取。填完再提交審核。

> 沒有付費 Developer 帳號就無法 Archive 上傳；免費帳號只能裝到自己的測試機。

### Android（簡要）

```bash
npm run build:mobile
npx cap open android
```

用 Android Studio 開 `android/`，設定 signing keystore 後 Build → Generate Signed Bundle / APK，再上傳 Google Play Console。  
本環境同樣無法代你簽署或上架。

### npm scripts

| 指令 | 作用 |
|------|------|
| `npm run build:mobile` | 建置 `dist` 並 `cap sync` |
| `npm run open:ios` | 在 Mac 開啟 Xcode 專案 |
| `npm run open:android` | 開啟 Android Studio 專案 |
