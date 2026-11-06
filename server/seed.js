import bcrypt from 'bcryptjs';
import {
  absolutePhotos,
  id,
  loadDb,
  persist,
  pickEmoji,
  pickTone,
  publicUser,
} from './db.js';

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

  db.users = users;
  db.listings = listings;
  db.offers = [];
  db.threads = [];
  db.messages = [];
  db.wants = [];
  persist();
  console.log(`[seed] demo user ${demo.email} / demo1234 · ${listings.length} listings`);
}

export function listingDto(l, db, publicBase) {
  const seller = db.users.find((u) => u.id === l.sellerId);
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
    sellerAvatar: seller?.avatar || '賣',
    sellerBio: seller?.bio || '',
    sellerVerified: Boolean(seller?.verified),
    tone: l.tone,
    emoji: l.emoji,
    photos: absolutePhotos(l.photos || [], publicBase),
    sold: Boolean(l.sold),
    createdAt: l.createdAt,
  };
}

export { publicUser };
