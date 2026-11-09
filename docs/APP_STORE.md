# 澳賣GOT App Store Connect 文案

貼上用草稿。主語言建議 **繁體中文**。英文名 **MoGOT**。  
Bundle ID：**`com.aomai.got`**（不要改）。  
顯示名稱在 `capacitor.config.json` 已是 **澳賣GOT**（沒有空格）。`index.html` 的 `apple-mobile-web-app-title` 與 `public/manifest.webmanifest` 一致。

本文件不簽署 IPA，也不上傳 App Store Connect。同步與 Archive 見下方，細節以根目錄 [README.md](../README.md) 的「Capacitor 原生包殼」為準。營運清單仍見 [STORE_CHECKLIST.md](../STORE_CHECKLIST.md)。

字數按 Unicode 碼位計算（一個漢字算 1）。

## 上架網址

| 欄位 | 值 |
|------|----|
| 支援 URL | https://aomai-got.onrender.com/support |
| 行銷 URL | https://aomai-got.onrender.com |
| 隱私政策 URL | https://aomai-got.onrender.com/privacy |
| 聯絡電郵 | mogot.app@gmail.com |

`/support` 與 `/privacy` 由 API 直接回傳公開頁，部署後即可給 App Store Connect 使用。應用內「我的」也可打開同一份頁面。

## 名稱與文案

| 欄位 | 上限 | 字數 | 建議文字 |
|------|------|------|----------|
| 名稱 | 30 | 5 | 澳賣GOT |
| 英文名稱（英文本地化） | 30 | 5 | MoGOT |
| 副標題 | 30 | 8 | 澳門鄰里二手議價 |
| 宣傳文字 | 170 | 48 | 閑置物品同街坊議價，當面睇貨再付款。澳賣GOT 不在 App 內收款，不託管貨款，亦不鑑定真偽。 |
| 關鍵字 | 100 | 57 | `二手,澳門,議價,面交,閑置,街坊,市集,轉讓,清屋,跳蚤,買賣,交收,鄰里,訊息,評價,約見,MOP,MoGOT` |

關鍵字用逗號分隔、逗號後不加空格。不要再把「澳賣GOT」放進關鍵字（名稱已會被索引）。類別建議 **購物**。

### 描述

```
澳賣GOT（英文名 MoGOT）是澳門鄰里的二手議價市集。

把閑置物品刊登出來，同街坊出價、用訊息傾。出價被接受之後，雙方再約定見面時間同地點。價錢與成色由賣家自己標，買家自己判斷。

你可以：
・搜尋、分類、收藏二手刊登
・出價、接受、拒絕或回價
・用文字、相片或語音訊息聯絡對方
・雙方確認見面時間與地點（澳門地標或自訂）
・成交後為對方留星數與一句短評

平台不在 App 內收款，不託管貨款，不代為寄倉，也不鑑定真偽。建議面交，當面睇清楚先付款，唔好預先轉帳。

本服務不針對 16 歲以下人士。

支援：https://aomai-got.onrender.com/support
隱私政策：https://aomai-got.onrender.com/privacy
```

### 審核備註（App Review Information）

- 審核登入：沒有預設示範帳號。請在登入頁註冊電郵與密碼（至少 6 位），打開認證信完成驗證後再登入。審核電郵必須收得到信。不要把任何帳號密碼寫進商店描述。
- 沒有 App 內購買，沒有結帳，沒有託管或擔保付款。貨款在街坊之間、App 外完成。
- 接受出價後的「見面時間／地點」是雙方自己填的約會，不是平台物流。
- 使用者內容：刊登（文字、相片）、出價、聊天（文字、相片、語音）、短評。
- 推播：應用內紅點與本機通知。遠端推播（關掉 App 仍收到）尚未接入，請不要當成已完成功能。見 `STORE_CHECKLIST.md`。
- 支援與隱私頁就是上面的網址，與應用內同一份。

## 年齡分級備註

依目前程式（出價、聊天、使用者內容、沒有 App 內付款）。建議在問卷如實勾選，顯示年齡對齊隱私政策：**16+**（服務不針對 16 歲以下）。

已在程式確認：

- **使用者產生內容**：刊登標題、描述、相片、賣家自填地點文字；短評為 1–5 星，文字可選、最多 80 字（`POST /api/listings`、`POST /api/listings/:id/reviews`）。
- **聊天**：文字、相片、一則語音。麥克風只在對話裡按錄音時才透過 `getUserMedia({ audio: true })` 索取（`src/main.js`）。
- **出價**：金額、交收方式、留言；賣家可接受、拒絕或回價（`POST /api/listings/:id/offers`、`PATCH /api/offers/:id`）。接受後雙方提議並確認見面（`PUT /api/offers/:id/handoff`）。
- **沒有 App 內付款**：沒有 Stripe、PayPal、App 內購買、結帳、錢包或託管貨款。介面防騙句寫明平台不託管（`src/main.js` 的 `SCAM_TIP`）。價錢只是議價紀錄，錢在線下交。
- **沒有**廣告 SDK、IDFA、分析 SDK、裝置 GPS。刊登地點是使用者打的字，不是定位。
- **目前沒有**應用內舉報、封鎖或內容過濾。

問卷草稿（對齊 Apple 現行年齡分級問項；介面名稱以 Connect 當下表單為準）：

| 問題 | 建議答案 |
|------|----------|
| 不受限制的網頁瀏覽 | 否。這是自己的市集，不是一般瀏覽器。 |
| 使用者產生內容 | 是。刊登、相片、短評。 |
| 訊息與聊天 | 是。文字、相片、語音，對象是議價雙方。 |
| 廣告 | 否。 |
| 兒童向／家長監護／年齡驗證 | 否。不面向 16 歲以下。 |
| App 內購買、抽獎箱、博彩 | 否。 |
| 暴力、裸露、恐怖等由本 App 提供的內容 | 無。 |
| 使用者可否買賣實體二手物品 | 是。付款不經本 App。 |

審核風險：有聊天與使用者內容，但沒有舉報或封鎖。Guideline 1.2 可能要求過濾、舉報與封鎖。送審前若仍未做，在備註寫明現況，並預期分級可能落在 16+；若審核認為內容不受限制，有機會被要求改到更高分級或補上管制。本文件只記錄現況，不把未完成的管制說成已有。

## 隱私營養標籤草稿

對齊 `/privacy`。**不用於追蹤**。沒有第三方廣告或資料仲介。

| 資料類型 | 是否蒐集 | 與身分連結 | 用途 | 依據 |
|----------|----------|------------|------|------|
| 聯絡資料 → 電郵 | 是 | 是 | App 功能 | 註冊、登入 |
| 使用者內容 → 相片或影片 | 是 | 是 | App 功能 | 刊登、頭像、聊天相片 |
| 使用者內容 → 音訊 | 是 | 是 | App 功能 | 只在使用者於對話錄音時 |
| 使用者內容 → 其他 | 是 | 是 | App 功能 | 名稱、簡介、刊登文字、出價、聊天文字、短評、見面備註 |
| 識別碼 → 使用者 ID | 是 | 是 | App 功能 | 帳號 ID |
| 識別碼 → 裝置 ID | 使用者開啟提醒時 | 是 | App 功能 | `POST /api/devices` 的推播權杖。不是 IDFA。未開啟則不存。 |
| 診斷 → 其他診斷資料 | 政策已說明 | 視日誌是否跟帳號一併保存 | App 功能／防濫用 | 隱私頁寫明基本日誌（例如 IP、瀏覽器類型）。此 repo 的 JSON 資料庫沒有獨立存取紀錄表；主機或 Render 可能另有請求日誌。若日誌不跟帳號綁在一起，可勾「不與身分連結」。 |

不要勾：精確位置、粗略位置（沒有 GPS）、聯絡人、健康、財務資料、敏感資料、瀏覽紀錄、搜尋紀錄（搜尋字不會寫進資料庫）、購買項目、廣告資料。沒有當機回報 SDK。

密碼只以雜湊儲存，營養標籤不必把密碼單獨列成一類。

## 截圖尺寸

格式：`.png`、`.jpg` 或 `.jpeg`。**不可帶透明通道**。每個尺寸 1–10 張。請在模擬器或實機自己擷取，不要放合成的後台畫面。

Apple 現行規格把舊稱的 6.7 吋與 6.1 吋拆進下面幾個欄位（[Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)）。直向即可；橫向把寬高對調。

### 6.7 吋

實機：iPhone 14 Pro Max、15 Plus、15 Pro Max、16 Plus。  
直向：**1290 × 2796**。

上傳欄位是 **iPhone with Dynamic Island（large display）**。同一欄也接受 1260 × 2736 與 1320 × 2868（較新的 Pro Max）。1290 × 2796 可以直接交。若表單把最大螢幕標成必填而你還沒有 1320 × 2868，先交 1290 × 2796；被拒再補最大那組。

### 6.1 吋

分兩欄，不要混尺寸：

| 機型 | Connect 欄位 | 直向像素 |
|------|----------------|----------|
| iPhone 14 Pro、15、15 Pro、16、17 這類有 Dynamic Island 的 6.1 吋 | iPhone with Dynamic Island（medium display） | **1179 × 2556**（此欄亦接受 1206 × 2622） |
| iPhone 14、13、13 Pro、12、12 Pro 這類 Face ID、沒有 Dynamic Island 的 6.1 吋 | iPhone with Face ID（medium display） | **1170 × 2532**（此欄亦接受 1125 × 2436、1080 × 2340） |

目前送審 **必備的 iPhone 截圖**是 Dynamic Island 的 medium display（上表第一列，6.1 吋那組）。只交這組時，Connect 會縮小套用到較小螢幕。6.7 吋那組建議另外交，產品頁在大螢幕上才不會被縮小糊掉。

只上 iPhone：Xcode 的目標裝置維持 iPhone。若同時支援 iPad，還要 13 吋 iPad 截圖（2064 × 2752 或 2048 × 2732）。

建議畫面，依此順序：首頁、商品詳情、出價、已接受後的見面卡、訊息。狀態列用實機樣式。不要把審核密碼放進截圖。

## App 圖示

- **1024 × 1024** PNG，無透明、無圓角（系統會自己裁成圓角）。
- 檔案是黑底白字堆疊「澳賣GOT」：`public/icons/icon-1024.png`，並已放進 `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`。
- 不要把橫向字標直接拉成正方形。介面內的字標是 `public/brand/logo-light.jpg` 與 `logo-dark.jpg`。
- 換圖示後必須重新 Archive 上傳，App Store / TestFlight 才會換成新圖示。
- 可選的各尺寸產生方式見 `STORE_CHECKLIST.md`「圖示與啟動畫面」。

## Capacitor 同步與 Archive

顯示名稱維持 **澳賣GOT**，Bundle ID 維持 **`com.aomai.got`**。

在專案根目錄：

```bash
npm install
npm run build:mobile
```

`npm run build:mobile` 等於 `vite build` 再 `npx cap sync`。也可分開跑 `npm run build` 與 `npx cap sync`。

在 Mac 上打開 Xcode、簽署、Archive、上傳的完整步驟見 [README.md](../README.md) 的「Capacitor 原生包殼（iOS / Android）」。摘要只有這三步屬於本機文件範圍：

```bash
npm run build:mobile
npx cap open ios
```

然後在 Xcode：**Signing & Capabilities** 選你的 Team，裝置選 **Any iOS Device (arm64)**，**Product → Archive**，再 **Distribute App**。沒有付費 Apple Developer 帳號就無法上傳。此環境不代簽、不代傳。
