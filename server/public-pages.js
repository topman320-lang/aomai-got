/** Public HTML for App Store privacy and support URLs. Traditional Chinese. */

export const SUPPORT_EMAIL = 'mogot.app@gmail.com';

const MAILTO = `mailto:${SUPPORT_EMAIL}`;

function page({ title, body }) {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} · 澳賣GOT</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif;max-width:680px;margin:0 auto;padding:32px 20px 64px;line-height:1.7;color:#111;background:#fff}
  h1{font-size:22px;margin:0 0 8px}
  h2{font-size:16px;margin:28px 0 8px}
  p,li{font-size:14px;color:#333}
  a{color:#111}
  .muted{color:#767676;font-size:13px}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function privacyPage() {
  return page({
    title: '隱私政策',
    body: `  <h1>澳賣GOT 隱私政策</h1>
  <p class="muted">適用於澳門特別行政區 · 最後更新：2026 年 11 月</p>
  <p>澳賣GOT（MoGOT，下稱「本服務」）是一個以鄰里議價為主的二手物品交流平台。我們重視你的個人資料，並依本政策說明蒐集、使用與保存方式。</p>
  <h2>一、我們蒐集什麼</h2>
  <ul>
    <li>帳號資料：使用者名稱、個人簡介、頭像、電郵、密碼（加密儲存）。</li>
    <li>刊登與交易相關內容：商品說明、照片、出價、交收意願、聊天訊息（文字、相片、語音）、街坊短評。語音只在你於對話內按錄音時才會向瀏覽器索取麥克風，並與該對話一併保存。</li>
    <li>見面安排：雙方自行填寫的見面時間、地點與備註。平台不代為保管物品或貨款。</li>
    <li>通知：若你開啟提醒，我們會保存裝置權杖，以便日後發送訊息與出價通知。未設定推播憑證時，提醒只在你開啟應用時於應用內顯示。</li>
    <li>裝置與技術資料：基本日誌（例如 IP、瀏覽器類型），用於維運與防止濫用。</li>
  </ul>
  <h2>二、用途</h2>
  <ul>
    <li>提供註冊登入、刊登、議價、訊息、見面安排與你開啟的提醒。</li>
    <li>維護平台安全、防詐騙與不當內容。</li>
    <li>依法律要求配合主管機關。</li>
  </ul>
  <h2>三、分享與披露</h2>
  <p>我們不會出售你的個人資料。僅在提供服務所必需（例如顯示賣家暱稱給買家）、經你同意、或法律要求時，才會披露相關資訊。交收請在安全公開場所進行，切勿分享敏感證件或銀行資料。</p>
  <h2>四、保存與安全</h2>
  <p>資料保存在我們的伺服器（目前為應用程式後端資料庫）。密碼以雜湊方式儲存。請妥善保管登入憑證；若懷疑帳號被盜用，請立即更改密碼並聯絡我們。</p>
  <h2>五、你的權利</h2>
  <p>你可要求查閱、更正或刪除帳號相關資料（法律另有規定者除外）。刪除帳號後，公開刊登與對話紀錄可能依法或營運需要在合理期間內保留備份。</p>
  <h2>六、兒童</h2>
  <p>本服務不針對 16 歲以下人士。若發現相關帳號，我們可能予以停用。</p>
  <h2>七、聯絡</h2>
  <p>關於隱私、查閱或刪除帳號資料，請電郵至 <a href="${MAILTO}">${SUPPORT_EMAIL}</a>。</p>
  <p>使用上的問題見 <a href="/support">支援頁</a>。</p>
  <p class="muted">本政策可能不時更新；重大變更將於應用內或本頁公告。</p>`,
  });
}

export function supportPage() {
  return page({
    title: '支援',
    body: `  <h1>澳賣GOT 支援</h1>
  <p class="muted">MoGOT · 澳門鄰里二手議價 · 2026 年 11 月</p>
  <p>澳賣GOT（MoGOT）是澳門街坊刊登閑置、出價議價、用訊息約見面的平台。價錢與成色由賣家自己標。平台不在 App 內收款，不託管貨款，不代為寄倉，也不鑑定真偽。</p>
  <h2>聯絡我們</h2>
  <p>帳號、刊登、訊息、議價、見面安排或隱私問題，請電郵 <a href="${MAILTO}">${SUPPORT_EMAIL}</a>。請在信裡寫上你的使用者名稱，以及發生了什麼（不必附上密碼）。</p>
  <h2>使用提示</h2>
  <ul>
    <li>建議面交，當面睇清楚先付款，唔好預先轉帳。</li>
    <li>見面時間與地點由買賣雙方自己填寫並確認，不是平台安排的物流。</li>
    <li>本服務不針對 16 歲以下人士。</li>
  </ul>
  <h2>相關頁面</h2>
  <p><a href="/privacy">隱私政策</a></p>
  <p class="muted">網站：<a href="https://aomai-got.onrender.com">https://aomai-got.onrender.com</a></p>`,
  });
}
