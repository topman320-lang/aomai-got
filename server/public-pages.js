/** Public HTML for App Store privacy and support URLs. Traditional Chinese. */

export const SUPPORT_EMAIL = 'mogot.app@gmail.com';

/** Recorded on new accounts only. Same month as the page’s「最後更新」. */
export const TERMS_POLICY_ID = 'terms-2026-11';

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
    <li>帳號資料：使用者名稱、個人簡介、頭像、電郵、密碼（加密儲存）。註冊後會寄出一次性認證連結，完成後先可以登入。</li>
    <li>刊登與交易相關內容：商品說明、照片、出價、交收意願、聊天訊息（文字、相片、語音）、街坊短評。拍照只在你按「拍照」時才使用相機。語音只在你於對話內按錄音時才會向瀏覽器索取麥克風，並與該對話一併保存。</li>
    <li>見面安排：雙方自行填寫的見面時間、地點與備註。平台不代為保管物品或貨款。</li>
    <li>通知：若你開啟訊息提醒，我們會保存這部裝置的識別與推播權杖，以便在有新訊息或出價時通知你（包括 App 關閉時的 Apple 推播；需已在伺服器設定推播憑證）。關閉提醒後，不會發送本機或遠端通知。未讀紅點仍會在應用內顯示。</li>
    <li>裝置與技術資料：基本日誌（例如 IP、瀏覽器類型），用於維運與防止濫用。</li>
  </ul>
  <h2>二、用途</h2>
  <ul>
    <li>提供註冊、電郵認證、登入、刊登、議價、訊息、見面安排與你開啟的提醒。</li>
    <li>維護平台安全、防詐騙與不當內容。</li>
    <li>依法律要求配合主管機關。</li>
  </ul>
  <h2>三、分享與披露</h2>
  <p>我們不會出售你的個人資料。僅在提供服務所必需（例如顯示賣家暱稱給買家）、經你同意、或法律要求時，才會披露相關資訊。交收請在安全公開場所進行，切勿分享敏感證件或銀行資料。</p>
  <h2>四、保存與安全</h2>
  <p>資料保存在我們的伺服器（目前為應用程式後端資料庫）。密碼以雜湊方式儲存。請妥善保管登入憑證；若懷疑帳號被盜用，請立即更改密碼並聯絡我們。</p>
  <h2>五、你的權利</h2>
  <p>你可以在「我的 → 編輯個人資料」查閱同更正名稱、簡介同頭像。電郵暫不可更改。</p>
  <p>你可以在同一頁刪除帳號。刪除前要再輸入密碼確認，避免誤按。確認後，帳號、密碼、電郵、頭像、簡介同登入狀態會刪除，不能再用該帳號登入。你刊登的相片同說明，以及你發出的訊息、語音同相片會刪除或不再公開。其他街坊自己發出的訊息，以及已經發生的議價狀態，會留給對方，以免破壞對方的紀錄。為處理檢舉同封鎖而保存的紀錄會保留，當中不會另存你的電郵。法律要求保留的資料，只會在所需期間內保存。</p>
  <h2>六、兒童</h2>
  <p>本服務不針對 16 歲以下人士。若發現相關帳號，我們可能予以停用。</p>
  <h2>七、聯絡</h2>
  <p>關於隱私、查閱或刪除帳號資料，請電郵至 <a href="${MAILTO}">${SUPPORT_EMAIL}</a>。</p>
  <p>使用上的問題見 <a href="/support">支援頁</a>。使用條款見 <a href="/terms">使用條款</a>。</p>
  <p class="muted">本政策可能不時更新；重大變更將於應用內或本頁公告。</p>`,
  });
}

export function termsPage() {
  return page({
    title: '使用條款',
    body: `  <h1>澳賣GOT 使用條款</h1>
  <p class="muted">MoGOT · 一物一故事 · 閑置亦有價 · 最後更新：2026 年 11 月</p>
  <p>澳賣GOT（英文 MoGOT）是給澳門同香港街坊刊登閑置、互相議價、用訊息約見面的平台。使用本服務即表示你明白以下說明。這是產品條款，方便你知道平台怎樣運作，不是正式法律意見。</p>
  <h2>一、年齡</h2>
  <p>本服務只供年滿 16 歲的人士使用。註冊時你確認本人已年滿 16 歲。我們不會為 16 歲以下人士提供帳號。</p>
  <h2>二、帳號</h2>
  <p>註冊要提供可用電郵，並打開認證信完成驗證，之後先可以登入。請自己保管密碼。已有帳號不會因為這份條款更新而被要求重新勾選。</p>
  <p>你可以在「我的 → 編輯個人資料」刪除帳號。刪除前要再輸入密碼，避免誤按。確認刪除後：</p>
  <ul>
    <li>帳號、密碼、電郵、頭像、簡介同登入狀態會刪除。你不能再用該帳號登入。同一電郵之後可以重新註冊，那是一個新帳號。</li>
    <li>你刊登的相片、說明，以及你發出的文字、相片同語音訊息會刪除或不再公開。</li>
    <li>其他街坊自己寫的訊息，以及已經發生的議價狀態，會留給對方，以免破壞對方的紀錄。你的名字不再對應一個可登入的帳號。</li>
    <li>檢舉同封鎖紀錄會保留，以便處理不當內容。這些紀錄不另存電郵地址。</li>
  </ul>
  <h2>三、你刊登同發出的內容</h2>
  <p>商品說明、相片、出價留言、聊天文字、語音同街坊評價都是使用者提供的內容。請只刊登你有權轉讓的閑置，並如實描述成色。不要刊登違法、侵權、不雅、詐騙、仇恨或騷擾內容，也不要在訊息裡索取證件、密碼或預先轉帳。</p>
  <h2>四、平台不鑑定、不代收款</h2>
  <p>價錢同成色由賣家自己標。澳賣GOT唔會鑑定貨品，亦唔代收款，不託管貨款，不代為寄倉，也不保證對方一定會履約。交收請當面睇清楚先付款，唔好預先轉帳。</p>
  <h2>五、檢舉同封鎖</h2>
  <p>已登入的街坊可以檢舉刊登、訊息、出價留言、評價或其他令人不安的內容，也可以封鎖另一位街坊。封鎖後，對方的刊登同訊息會即時從你的列表移除，並通知平台管理員跟進。封鎖不會自動刪除對方的帳號。你可以之後在「已封鎖的街坊」解除封鎖。</p>
  <p>我們會查看檢舉。必要時可以隱藏內容或停用帳號。檢舉同封鎖會通知 ${SUPPORT_EMAIL}。</p>
  <h2>六、責任</h2>
  <p>買賣由雙方自己完成。見面時間同地點由雙方填寫，不是平台安排的物流。請在安全、公開的地方交收。</p>
  <h2>七、更新同聯絡</h2>
  <p>我們可能更新本條款，並在本頁標明日期。新註冊的帳號在註冊時同意當時的使用條款同<a href="/privacy">隱私政策</a>。</p>
  <p>帳號、刊登、檢舉或隱私問題，請電郵 <a href="${MAILTO}">${SUPPORT_EMAIL}</a>。使用上的問題亦見 <a href="/support">支援頁</a>。</p>`,
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
  <p><a href="/terms">使用條款</a></p>
  <p><a href="/privacy">隱私政策</a></p>
  <p class="muted">網站：<a href="https://aomai-got.onrender.com">https://aomai-got.onrender.com</a></p>`,
  });
}

/** Browser page after the user opens the one-time verification link. */
export function verifyResultPage({ ok }) {
  if (ok) {
    return page({
      title: '電郵已認證',
      body: `  <h1>電郵已認證</h1>
  <p class="muted">澳賣GOT · MoGOT</p>
  <p>你嘅帳戶已啟用。請打開澳賣GOT App，用剛才嘅電郵同密碼登入，就可以刊登同出價。</p>
  <p><a href="/#/login">前往登入</a></p>`,
    });
  }
  return page({
    title: '未能認證',
    body: `  <h1>未能認證</h1>
  <p>呢個認證連結無效或已過期。</p>
  <p>如果你已經完成認證，撳下面「返回登入」就可以。</p>
  <p>如果未完成，唔使淨係喺 App 操作；網站同 App 嘅登入頁都可以重寄：</p>
  <ol>
    <li>撳下面「返回登入」。</li>
    <li>喺登入頁填寫註冊電郵，再撳「重寄認證信」。</li>
    <li>打開新寄出嘅認證信，撳入面嘅連結。</li>
  </ol>
  <p><a href="/#/login">返回登入</a></p>`,
  });
}
