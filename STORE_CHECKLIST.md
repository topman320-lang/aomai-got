# 澳賣GOT 上架清單

Bundle ID／Application ID：**`com.aomai.got`**  
顯示名稱：**澳賣GOT**  
英文名稱：**MoGOT**  
網站：<https://aomai-got.onrender.com>  
支援：<https://aomai-got.onrender.com/support>（`mogot.app@gmail.com`）  
隱私政策：<https://aomai-got.onrender.com/privacy>  
可直接貼上的 Connect 文案：`docs/APP_STORE.md`  
沒有預設示範帳號。審核時請在登入頁自行註冊。

本檔是審核文案與準備清單。沒有、也不應放上虛構的 App Store Connect 截圖。截圖請在模擬器或實機自己擷取。

## 這個版本實際做到什麼

- 鄰里二手議價。出價被接受後，買賣雙方可以提議並確認見面時間與地點（澳門地標或自訂）。平台不收貨款、不託管、不鑑定。
- 議價、訊息、見面卡有同一句防騙提示：建議面交、唔好預付、平台唔託管唔鑑定。
- 新刊登至少一張相片，建議多角度。相簿與拍照都還在。
- 應用內紅點（訊息、待回覆議價、新提醒）。原生殼可以要本機通知權限，並把裝置權杖存到 `POST /api/devices`。
- **遠端推播（App 關掉仍收到）尚未發送。** 沒有 APNs／FCM 憑證，伺服器不會假裝送出。

## 審核用短句

| 欄位 | 建議文字 |
|------|----------|
| 名稱 | 澳賣GOT |
| 英文名稱 | MoGOT |
| 副標 | 澳門鄰里二手議價 |
| 宣傳文字 | 閑置物品同街坊議價，當面睇貨再付款。 |
| 關鍵字 | 二手,澳門,議價,面交,閑置,街坊 |
| 類別 | 購物 |
| 年齡 | 16+（服務不面向 16 歲以下，見隱私政策） |

### 描述（可直接改完再貼）

澳賣GOT（英文名 MoGOT）是澳門鄰里的二手議價市集。

你可刊登閑置物品、同街坊出價、用訊息約見面。價錢與成色由賣家自己標，買家自己判斷。平台不鑑定真偽，不代收款，不代為寄倉，也不提供擔保交易。

建議面交，當面睇清楚先付款，唔好預先轉帳。

### 審核備註

- 審核登入：沒有預設示範帳號。請在登入頁註冊電郵與密碼（至少 6 位）後登入。
- 沒有 App 內購買，沒有託管或擔保付款。
- 接受出價後，「見面時間／地點」只是雙方自己填的約會，不是平台安排的物流。
- 推播：應用內會顯示紅點。若系統通知權限未開，功能仍可用。遠端推播憑證尚未提交，請不要把「關掉 App 也會收到推播」當成已完成功能。
- 隱私政策網址即上面的 `/privacy`，與應用內「隱私政策」同一份。

## 隱私（對齊現有隱私頁）

蒐集：名稱、簡介、頭像、電郵、密碼（雜湊）、商品說明與照片、出價、聊天、街坊短評、見面時間地點備註。若使用者開啟提醒，另存裝置權杖。伺服器有基本日誌。

不做：不出售個人資料、不用資料追蹤廣告、不託管貨款、不鑑定。隱私頁與支援頁的聯絡信箱是 `mogot.app@gmail.com`。

App Store 營養標籤可這樣對：

- 聯絡資料：電郵
- 使用者內容：照片、刊登、訊息、評價、見面備註
- 識別碼：使用者 ID；開啟通知時的裝置權杖
- 不追蹤

## 圖示與啟動畫面

已放在 repo，由 `scripts/make-store-icons.py` 從字標重製（需要本機 Pillow，不是執行期依賴）：

| 檔案 | 用途 |
|------|------|
| `public/icons/icon-1024.png` | iOS App Store 1024，以及 `@capacitor/assets` 的來源 |
| `public/icons/icon-180.png` | apple-touch-icon |
| `public/icons/icon-192.png`、`icon-512.png` | PWA／高解析 |
| `public/icons/icon-maskable-512.png` | 有較大留白的 maskable |
| `public/icons/ic-stat-aomai.png` | Android 狀態列用白字透明底，複製到 `android/app/src/main/res/...` 並命名成 `ic_stat_aomai` |
| `public/splash/splash-light.png` | 淺色啟動畫面（1080×1920，置中字標） |
| `public/splash/splash-dark.png` | 深色啟動畫面 |
| `public/brand/logo-light.jpg`、`logo-dark.jpg` | 介面內的完整字標 |

`favicon.svg` 仍是簡化的「澳」字。原生圖示請用上面的 PNG，不要把寬幅字標直接拉成正方形。

在 Mac 上可再跑（可選）：

```bash
npm run build:mobile
npx @capacitor/assets generate --iconBackgroundColor '#111111' --splashBackgroundColor '#ffffff'
```

此 Linux 環境不能簽名，也不能上傳 App Store Connect 或 Play Console。

## 截圖

請自行從模擬器或手機擷取，不要用合成的商店後台畫面。常見尺寸：

- iPhone 6.7"、6.5" 各至少一組
- iPad 若只出 iPhone，可在 Connect 勾僅 iPhone
- Play：手機截圖，短邊至少 320px，建議 1080×1920

建議畫面：首頁、商品詳情、出價、已接受後的見面卡、訊息。

## 推播還缺什麼

程式已接上：

- `@capacitor/push-notifications`、`@capacitor/local-notifications`
- 我的 → 訊息提醒：要求權限。網頁用 Notifications API；原生殼才載入外掛，網頁版不會因外掛失敗而打不開
- 新訊息、出價、見面提議會寫入 `notices`，客戶端大約每 25 秒看一次，前景用提示，背景才發本機通知
- `POST /api/devices` 可保存 `{ token, platform: ios|android|web }`
- `GET /api/push/status` 固定 `remotePush: false`

要在商店做真正的遠端推播，還需要你自己準備：

1. Apple Developer 帳號。Xcode → Signing & Capabilities → Push Notifications。Bundle ID `com.aomai.got`。
2. APNs Auth Key（`.p8`）、Key ID、Team ID。環境變數可命名為 `APNS_KEY_ID`、`APNS_TEAM_ID`、`APNS_KEY`。
3. Firebase 專案、Android `google-services.json`，以及伺服器用的 FCM 憑證（`FCM_SERVER_KEY` 或 `FCM_SERVICE_ACCOUNT`）。
4. 在 `server/notices.js` 的 `remotePushHook` 接上實際發送。現在就算設了環境變數也不會送出，避免半套實作誤報成功。
5. `npx cap sync` 之後，Android 通知小圖使用 `ic_stat_aomai`。

未完成上述步驟時，請在審核說明寫：通知是應用內紅點與本機通知，不是背景遠端推播。
