# 澳賣 GOT

澳門鄰里二手議價市集 — 白底黑字 VSCO 風 SPA + Express API。

標語：**一物一故事 · 閑置亦有價**

資料存在後端（登入、刊登、議價、訊息、我想要互通）。主題色仍存在瀏覽器。

## 功能

- **首頁**：搜尋、分類、雙欄刊登（價錢／地點／可議）
- **登入／註冊**：JWT；刊登、議價、訊息、我想要需登入
- **商品詳情**：大圖、說明、賣家、「議價」「我想要」／賣家標示已售
- **議價**：出價、交收方式、留言 → 建立對話
- **刊登**：標題／價錢／分類／地點／狀況／描述／最多 3 張圖
- **訊息**：真實對話（無假自動回覆）
- **我的**：統計、選單、隱私政策、登出
- **隱私政策**：`GET http://127.0.0.1:8787/privacy`

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

示範登入：`demo@aomai.got` / `demo1234`

可選環境變數：`VITE_API_URL`（預設 `http://127.0.0.1:8787`）。

正式建置：

```bash
npm run build
npm run preview
```

## 技術

- Vite + Vanilla HTML / CSS / JS（hash routing）
- Express API（port 8787）+ JSON 檔案庫 `server/data/aomai.json`
- JWT（jsonwebtoken）+ bcryptjs
- Capacitor iOS / Android 包殼（上架仍需 Mac + Developer 帳號）

詳見 `server/README.md`。

## 品牌 Logo

檔案在 `public/brand/`：

| 檔案 | 用途 |
|------|------|
| `logo-light.jpg` | 白底黑字 — 首頁 topbar、我的頁品牌條 |
| `logo-dark.jpg` | 介面顏色 — 關於彈窗黑底條；可作 App icon／啟動畫面素材 |

Capacitor 上架時，請用這兩款裁成各尺寸 App Icon（iOS `AppIcon.appiconset`、Android `mipmap-*`）。目前 `favicon.svg` 仍是簡化「澳」字標；真機 icon 建議換成完整字標裁切。

## Capacitor 原生包殼（iOS / Android）

本專案已用 Capacitor 包成可在 Xcode / Android Studio 開啟的原生專案。  
**重要：此 Linux 環境無法簽署 IPA 或上傳 App Store。** 上架必須用你本人的 **Mac + Xcode + Apple Developer 帳號**（付費會員）完成。

| 項目 | 值 |
|------|-----|
| App 顯示名稱 | 澳賣 GOT |
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
7. 到 [App Store Connect](https://appstoreconnect.apple.com/) 建立 App（Bundle ID 選 `com.aomai.got`），填審核資料、截圖、隱私政策等，再提交審核。

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
