import bcrypt from 'bcryptjs';
import {
  absolutePhotos,
  id,
  loadDb,
  persist,
  pickEmoji,
  pickTone,
  presentAvatar,
  publicUser,
} from './db.js';
import { reviewAccess, reviewsForListing, trustSummary } from './trust.js';

const now = Date.now();

const DEMO_LISTINGS = [
  {
    title: '雙門雪櫃 運作正常',
    price: 800,
    category: '家電',
    location: '氹仔',
    condition: '良好',
    description: '搬屋急讓，雙門雪櫃，製冷正常，無明顯刮花。可自取，晚上亦可約。',
    sellerName: '小美',
    emoji: '🧊',
    tone: '#d8d4cc',
    ago: 40,
    handover: '面交／自取',
  },
  {
    title: 'Unisex 白色恤衫 M',
    price: 80,
    category: '服飾',
    location: '中區',
    condition: '幾乎全新',
    description: '只穿過一次，無黃漬。適合上班或面試。',
    sellerName: 'Ken',
    emoji: '👕',
    tone: '#eceae6',
    ago: 90,
    handover: '面交',
  },
  {
    title: 'Apple Watch SE 44mm',
    price: 1200,
    category: '數碼',
    location: '澳門 · 附近',
    condition: '良好',
    description: '連原裝錶帶，電量健康良好。螢幕無裂痕。可議。',
    sellerName: 'Ada',
    emoji: '⌚',
    tone: '#cfcfcf',
    ago: 180,
    handover: '面交',
  },
  {
    title: '實木餐枱 四人座',
    price: 650,
    category: '家居',
    location: '路環',
    condition: '有使用痕跡',
    description: '實木餐枱，輕微使用痕跡，穩固耐用。需自備交通。',
    sellerName: '阿明',
    emoji: '🪵',
    tone: '#ddd6c8',
    ago: 300,
    handover: '自取',
  },
  {
    title: 'Sony 頭戴式耳機',
    price: 350,
    category: '數碼',
    location: '氹仔',
    condition: '良好',
    description: '音質清晰，耳墊乾淨。附原裝線。',
    sellerName: 'Joey',
    emoji: '🎧',
    tone: '#e4e4e4',
    ago: 420,
    handover: '面交',
  },
  {
    title: '白色收納櫃 三層',
    price: 200,
    category: '家居',
    location: '中區',
    condition: '幾乎全新',
    description: '清屋出售，幾乎全新。可拆裝，方便帶走。',
    sellerName: 'Carmen',
    emoji: '🗄️',
    tone: '#f0eeea',
    ago: 600,
    negotiable: false,
    handover: '自取',
  },
  {
    title: '限定聯名波鞋 42',
    price: 980,
    category: '潮流',
    location: '中區',
    condition: '幾乎全新',
    description: '只著過兩次，盒裝齊全。可議，中區交收。',
    sellerName: 'Rex',
    emoji: '👟',
    tone: '#e8e4de',
    ago: 50,
    handover: '面交',
  },
  {
    title: '未開封唇膏色號 08',
    price: 120,
    category: '美妝',
    location: '氹仔',
    condition: '全新',
    description: '買多一支，全新未拆。',
    sellerName: '琪琪',
    emoji: '💄',
    tone: '#f2ece8',
    ago: 70,
    negotiable: false,
    handover: '面交',
  },
  {
    title: '瑜伽墊 附揹帶',
    price: 90,
    category: '運動',
    location: '澳門 · 附近',
    condition: '良好',
    description: '厚度足夠，無異味。週末可送氹仔。',
    sellerName: 'Yan',
    emoji: '🧘',
    tone: '#e6ebe4',
    ago: 110,
    handover: '面交',
  },
  {
    title: '嬰兒手推車 輕便可摺',
    price: 450,
    category: '母嬰',
    location: '氹仔',
    condition: '良好',
    description: '自用兩年，摺疊輕便，煞車正常。附遮陽篷。可議，週末交收。',
    sellerName: '晴晴',
    emoji: '🍼',
    tone: '#efe8e4',
    ago: 95,
    handover: '面交',
  },
];

export const HANDOVERS = ['面交', '自取', '面交／自取'];

/** Peer handoff only. Never implies warehouse authentication or insured shipping. */
export function normalizeHandover(value, description = '') {
  const v = String(value || '').trim();
  if (HANDOVERS.includes(v)) return v;
  const text = String(description || '');
  const pickup = /自取|自備交通|帶走/.test(text);
  const meet = /面交|交收|碰面/.test(text);
  if (pickup && meet) return '面交／自取';
  if (pickup) return '自取';
  return '面交';
}

export function seedIfEmpty() {
  const db = loadDb();
  if (db.users.length > 0 && db.listings.length > 0) return;

  const demoHash = bcrypt.hashSync('demo1234', 10);
  const demo = {
    id: id('u-'),
    name: '阿輝',
    email: 'demo@aomai.got',
    passwordHash: demoHash,
    avatar: '輝',
    bio: '氹仔街坊 · 週末出沒',
    verified: true,
    createdAt: now - 1000 * 60 * 60 * 24 * 30,
  };

  const VERIFIED_SELLERS = new Set(['小美', 'Ada', 'Rex', 'Carmen']);
  const sellers = new Map();
  let sellerN = 0;
  function sellerFor(name) {
    if (sellers.has(name)) return sellers.get(name);
    sellerN += 1;
    const slug = name.toLowerCase().replace(/[^a-z0-9]/gi, '') || `seller${sellerN}`;
    const u = {
      id: id('u-'),
      name,
      email: `${slug}${sellerN}@seed.aomai.got`,
      passwordHash: demoHash,
      avatar: name.slice(0, 1),
      bio: '澳門街坊賣家',
      verified: VERIFIED_SELLERS.has(name),
      createdAt: now - 1000 * 60 * 60 * 24 * 10,
    };
    sellers.set(name, u);
    return u;
  }

  const users = [demo];
  const listings = DEMO_LISTINGS.map((row) => {
    const seller = sellerFor(row.sellerName);
    if (!users.find((u) => u.id === seller.id)) users.push(seller);
    return {
      id: id('l-'),
      title: row.title,
      price: row.price,
      negotiable: row.negotiable !== false,
      category: row.category,
      location: row.location,
      condition: row.condition,
      description: row.description,
      handover: normalizeHandover(row.handover, row.description),
      sellerId: seller.id,
      tone: row.tone || pickTone(row.title),
      emoji: row.emoji || pickEmoji(row.category),
      photos: [],
      sold: false,
      createdAt: now - 1000 * 60 * row.ago,
    };
  });

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const xiaomei = sellerFor('小美');
  const ken = sellerFor('Ken');
  const ada = sellerFor('Ada');
  demo.lastActiveAt = now - 2 * MIN;
  xiaomei.lastActiveAt = now - 40 * MIN;
  ken.lastActiveAt = now - 50 * MIN;
  ada.lastActiveAt = now - 3 * DAY;
  for (const u of users) {
    if (!u.lastActiveAt) u.lastActiveAt = u.createdAt;
  }

  const bookId = id('l-');
  const fanId = id('l-');
  const magId = id('l-');
  const fanThreadId = id('t-');
  const bookThreadId = id('t-');
  const tFan = now - 5 * DAY;
  const tBook = now - 50 * MIN;

  const book = {
    id: bookId,
    title: '舊書三本 中文小說',
    price: 40,
    negotiable: true,
    category: '其他',
    location: '氹仔',
    condition: '有使用痕跡',
    description: '自用小說三本，有摺角。週末可面交。',
    handover: '面交',
    sellerId: demo.id,
    tone: pickTone('舊書三本'),
    emoji: '📚',
    photos: [],
    sold: false,
    createdAt: now - 30 * MIN,
  };
  const fan = {
    id: fanId,
    title: '座檯小風扇',
    price: 50,
    negotiable: true,
    category: '其他',
    location: '氹仔',
    condition: '良好',
    description: '夏天用過，風力正常。已面交。',
    handover: '面交',
    sellerId: xiaomei.id,
    buyerId: demo.id,
    tone: pickTone('座檯小風扇'),
    emoji: '🌀',
    photos: [],
    sold: true,
    createdAt: tFan,
  };
  const mag = {
    id: magId,
    title: '舊雜誌一疊',
    price: 20,
    negotiable: false,
    category: '其他',
    location: '氹仔',
    condition: '有使用痕跡',
    description: '雜誌有摺痕，已說明。已面交。',
    handover: '面交',
    sellerId: demo.id,
    buyerId: ada.id,
    tone: pickTone('舊雜誌一疊'),
    emoji: '📰',
    photos: [],
    sold: true,
    createdAt: now - 8 * DAY,
  };

  db.users = users;
  db.listings = [...listings, book, fan, mag];
  db.offers = [
    {
      id: id('o-'),
      listingId: bookId,
      fromId: ken.id,
      amount: 30,
      meetup: '中間點',
      message: '可以週末見嗎？',
      status: 'pending',
      counterAmount: null,
      counterMessage: '',
      agreedAmount: null,
      createdAt: tBook,
      updatedAt: tBook,
    },
    {
      id: id('o-'),
      listingId: fanId,
      fromId: demo.id,
      amount: 50,
      meetup: '賣家地點',
      message: '今晚可以。',
      status: 'accepted',
      counterAmount: null,
      counterMessage: '',
      agreedAmount: 50,
      createdAt: tFan + HOUR,
      updatedAt: tFan + 3 * HOUR,
    },
    {
      id: id('o-'),
      listingId: magId,
      fromId: ada.id,
      amount: 20,
      meetup: '賣家地點',
      message: '',
      status: 'accepted',
      counterAmount: null,
      counterMessage: '',
      agreedAmount: 20,
      createdAt: now - 8 * DAY,
      updatedAt: now - 7 * DAY,
    },
  ];
  db.threads = [
    {
      id: bookThreadId,
      listingId: bookId,
      buyerId: ken.id,
      sellerId: demo.id,
      preview: '出價 MOP 30 · 中間點',
      buyerUnread: false,
      sellerUnread: true,
      createdAt: tBook,
      updatedAt: tBook,
    },
    {
      id: fanThreadId,
      listingId: fanId,
      buyerId: demo.id,
      sellerId: xiaomei.id,
      preview: '收到。',
      buyerUnread: false,
      sellerUnread: false,
      createdAt: tFan,
      updatedAt: tFan + 8 * MIN + 2 * HOUR + 6 * MIN,
    },
  ];
  db.messages = [
    {
      id: id('m-'),
      threadId: bookThreadId,
      fromId: ken.id,
      text: '出價 MOP 30 · 中間點\n可以週末見嗎？',
      createdAt: tBook,
    },
    {
      id: id('m-'),
      threadId: fanThreadId,
      fromId: demo.id,
      text: '風扇還在嗎？今晚可面交嗎？',
      createdAt: tFan,
    },
    {
      id: id('m-'),
      threadId: fanThreadId,
      fromId: xiaomei.id,
      text: '在，七點可以。',
      createdAt: tFan + 8 * MIN,
    },
    {
      id: id('m-'),
      threadId: fanThreadId,
      fromId: demo.id,
      text: '好，到時見。',
      createdAt: tFan + 8 * MIN + 2 * HOUR,
    },
    {
      id: id('m-'),
      threadId: fanThreadId,
      fromId: xiaomei.id,
      text: '收到。',
      createdAt: tFan + 8 * MIN + 2 * HOUR + 6 * MIN,
    },
  ];
  db.wants = [];
  db.reviews = [
    {
      id: id('r-'),
      listingId: fanId,
      fromId: demo.id,
      toId: xiaomei.id,
      stars: 5,
      text: '面交準時，風扇運作正常，與說明一樣。',
      createdAt: tFan + DAY,
    },
    {
      id: id('r-'),
      listingId: fanId,
      fromId: xiaomei.id,
      toId: demo.id,
      stars: 5,
      text: '買家準時，交收順利。',
      createdAt: tFan + DAY + HOUR,
    },
    {
      id: id('r-'),
      listingId: magId,
      fromId: ada.id,
      toId: demo.id,
      stars: 4,
      text: '雜誌有使用痕跡，與說明相符。',
      createdAt: now - 7 * DAY,
    },
  ];
  persist();
  console.log(`[seed] demo user ${demo.email} / demo1234 · ${db.listings.length} listings`);
}

export function listingDto(l, db, publicBase, viewerId = '') {
  const seller = db.users.find((u) => u.id === l.sellerId);
  const access = reviewAccess(l, db, viewerId);
  return {
    id: l.id,
    title: l.title,
    price: l.price,
    negotiable: Boolean(l.negotiable),
    category: l.category,
    location: l.location,
    condition: l.condition,
    description: l.description,
    handover: normalizeHandover(l.handover, l.description),
    sellerId: l.sellerId,
    sellerName: seller?.name || '街坊',
    sellerAvatar: presentAvatar(seller?.avatar || '賣', publicBase),
    sellerBio: seller?.bio || '',
    sellerVerified: Boolean(seller?.verified),
    sellerTrust: trustSummary(l.sellerId, db),
    buyerId: l.sold ? l.buyerId || '' : '',
    reviews: reviewsForListing(l, db),
    canReview: access.canReview,
    reviewRole: access.reviewRole,
    myReview: access.myReview,
    tone: l.tone,
    emoji: l.emoji,
    photos: absolutePhotos(l.photos || [], publicBase),
    sold: Boolean(l.sold),
    createdAt: l.createdAt,
  };
}

export { publicUser };
