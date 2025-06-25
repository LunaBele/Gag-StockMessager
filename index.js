require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const WS_URL = 'wss://gagstock.gleeze.com/grow-a-garden';
const PH_TIMEZONE = 'Asia/Manila';
const START_TIME = Date.now();

const DATABASE_FILE = './database.json';
const VIP_FILE = './vip.json';
const STOCK_FILE = './stock_notify.json';
const CONSOLE_FILE = './console.json';

const itemEmojis = {
  'Watering Can': '🚿', 'Trowel': '🛠️', 'Basic Sprinkler': '💧',
  'Advanced Sprinkler': '💦', 'Master Sprinkler': '🌊', 'Godly Sprinkler': '⛲',
  'Recall Wrench': '🔧', 'Lightning Rod': '⚡', 'Favorite Tool': '❤️', 'Harvest Tool': '🌾',
  'Carrot': '🥕', 'Tomato': '🍅', 'Corn': '🌽', 'Sugar Apple': '🍏',
  'Loquat': '🟨', 'Feijoa': '🟩', 'Rosy Delight': '🌹', 'Kiwi': '🥝', 'Bell Pepper': '🫑'
};
const VIP_ITEMS = Object.keys(itemEmojis);

const getPHTime = () => new Date().toLocaleString('en-US', { timeZone: PH_TIMEZONE });
const formatQty = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v;
const formatUptime = () => {
  const s = Math.floor((Date.now() - START_TIME) / 1000);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
};

const getJson = async (file, fallback = {}) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    await fs.writeFile(file, JSON.stringify(fallback, null, 2));
    return fallback;
  }
};
const saveJson = async (file, data) =>
  await fs.writeFile(file, JSON.stringify(data, null, 2));

const getUserName = async (id) => {
  try {
    const res = await axios.get(`https://graph.facebook.com/${id}?fields=name&access_token=${PAGE_ACCESS_TOKEN}`);
    return res.data.name || 'User';
  } catch {
    return 'User';
  }
};

const sendMessage = async (id, msg) => {
  try {
    await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      recipient: { id },
      message: msg,
    });
  } catch (e) {
    console.error(`[BOT ➜ ${id}] ERROR: ${e.message}`);
  }
};

const getConsoleSetting = async () => {
  const data = await getJson(CONSOLE_FILE, {});
  return data.enabled === true;
};
const setConsoleSetting = async (value) => {
  await saveJson(CONSOLE_FILE, { enabled: value });
};

const sendWelcomeIfNew = async (id) => {
  const db = await getJson(DATABASE_FILE);
  if (!db[id]) {
    const name = await getUserName(id);
    db[id] = {
      name,
      joined: getPHTime(),
      role: id === ADMIN_ID ? 'Admin' : 'Member',
    };
    await saveJson(DATABASE_FILE, db);
    await sendMessage(id, {
      text: `👋 Hello ${name}!\nWelcome to Grow A Garden Bot 🌱\nI’ll notify you about VIP items & stock!\nMade by Mart John Labaco 💡`,
    });
  }
};

const logMsg = async (id, msg) => {
  const db = await getJson(DATABASE_FILE);
  const u = db[id];
  const icon = u?.role === 'Admin' ? '👑' : '😀';
  console.log(`[${id}] ${u?.name || 'User'} [${icon}]: ${msg}`);
};

let lastStockDataRaw = null;
let lastStockKey = null;

const handleCommand = async (id, text) => {
  await logMsg(id, text);
  const command = text.trim().toLowerCase();
  const vip = await getJson(VIP_FILE);
  const notify = await getJson(STOCK_FILE);
  const db = await getJson(DATABASE_FILE);
  const role = db[id]?.role || 'Member';

  if (command === '/help') {
    let msg = `🆘 Commands:\n/vip -list\n/vip #1,#2\n/vip -show\n/vip -delete #1,#2\n/vip -reset\n/stock -on\n/stock -off\n/stock`;
    if (role === 'Admin') msg += `\n\n👑 Admin:\n/uptime\n/console -on\n/console -off`;
    return sendMessage(id, { text: msg });
  }

  if (command === '/uptime') {
    if (role !== 'Admin') return sendMessage(id, { text: '⛔ Admins only.' });
    return sendMessage(id, { text: `⏱️ Bot uptime: ${formatUptime()}` });
  }

  if (command === '/console -on') {
    if (role !== 'Admin') return sendMessage(id, { text: '⛔ Admins only.' });
    await setConsoleSetting(true);
    return sendMessage(id, { text: '📢 Console logging is ON.' });
  }

  if (command === '/console -off') {
    if (role !== 'Admin') return sendMessage(id, { text: '⛔ Admins only.' });
    await setConsoleSetting(false);
    return sendMessage(id, { text: '🔇 Console logging is OFF.' });
  }

  if (command === '/vip -list') {
    const list = VIP_ITEMS.map((v, i) => `#${i + 1} ${v}`).join('\n');
    return sendMessage(id, { text: `📋 VIP List:\n${list}\n\nUse /vip #1,#2 to select.` });
  }

  if (command.startsWith('/vip #')) {
    const nums = [...text.matchAll(/#(\d+)/g)].map(m => parseInt(m[1]));
    const selected = nums.map(i => VIP_ITEMS[i - 1]).filter(Boolean);
    if (selected.length) {
      vip[id] = selected;
      await saveJson(VIP_FILE, vip);
      return sendMessage(id, {
        text: `✅ VIP Set:\n${selected.map(n => `- ${itemEmojis[n] || ''} ${n}`).join('\n')}`
      });
    } else return sendMessage(id, { text: '⚠️ Invalid.' });
  }

  if (command === '/vip -reset') {
    delete vip[id];
    await saveJson(VIP_FILE, vip);
    return sendMessage(id, { text: '🗑️ VIP cleared.' });
  }

  if (command === '/vip -show') {
    const selected = vip[id];
    if (!selected || selected.length === 0) {
      await sendMessage(id, { text: '📭 You have no VIP items selected.' });
    } else {
      const listed = selected.map((item, i) => `#${i + 1} ${itemEmojis[item] || ''} ${item}`).join('\n');
      await sendMessage(id, {
        text: `📬 Your VIP Items:\n${listed}\n\nTo delete specific items, use:\n/vip -delete #1,#2`
      });
    }
    return;
  }

  if (command.startsWith('/vip -delete')) {
    const selected = vip[id];
    if (!selected || selected.length === 0) {
      await sendMessage(id, { text: '📭 You have no VIP items to delete.' });
      return;
    }

    const match = text.match(/#\d+/g);
    const indexes = match ? match.map(m => parseInt(m.slice(1)) - 1) : [];
    const filtered = selected.filter((_, i) => !indexes.includes(i));

    if (filtered.length === selected.length) {
      await sendMessage(id, { text: '⚠️ No matching items to delete.' });
      return;
    }

    vip[id] = filtered;
    await saveJson(VIP_FILE, vip);

    const updated = filtered.map((item, i) => `#${i + 1} ${itemEmojis[item] || ''} ${item}`).join('\n');
    await sendMessage(id, {
      text: `🗑️ Selected items removed.\n📬 Updated VIP Items:\n${updated || '📭 Empty'}`
    });
    return;
  }

  if (command === '/stock -on') {
    notify[id] = true;
    await saveJson(STOCK_FILE, notify);
    if (!lastStockDataRaw) return sendMessage(id, { text: '✅ Stock updates enabled.\n⏳ Waiting for stock data...' });

    const s = lastStockDataRaw;
    const sections = [
      ['Gear', s.gear.items],
      ['Seeds', s.seed.items],
      ['Eggs', s.egg.items],
      ['Honey', s.honey.items],
      ['Cosmetics', s.cosmetics.items],
    ];
    const clean = sections.map(([t, l]) =>
      `${t}\n${l.filter(i => i.quantity > 0).map(i => `- ${i.name}: x${formatQty(i.quantity)}`).join('\n')}`
    ).join('\n\n');

    return sendMessage(id, {
      text: `✅ Stock updates enabled.\n\n📦 Current Stock\n\n${clean}\n\n📅 As of: ${getPHTime()}`
    });
  }

  if (command === '/stock -off') {
    delete notify[id];
    await saveJson(STOCK_FILE, notify);
    return sendMessage(id, { text: '❌ Stock updates disabled.' });
  }

  if (command === '/stock') {
    if (!lastStockDataRaw) return sendMessage(id, { text: '⏳ Waiting for stock data...' });
    const s = lastStockDataRaw;
    const sections = [
      ['Gear', s.gear.items],
      ['Seeds', s.seed.items],
      ['Eggs', s.egg.items],
      ['Honey', s.honey.items],
      ['Cosmetics', s.cosmetics.items],
    ];
    const clean = sections.map(([t, l]) =>
      `${t}\n${l.filter(i => i.quantity > 0).map(i => `- ${i.name}: x${formatQty(i.quantity)}`).join('\n')}`
    ).join('\n\n');
    return sendMessage(id, { text: `📦 Current Stock\n\n${clean}\n\n📅 As of: ${getPHTime()}` });
  }
};

const handleStockData = async (data) => {
  const gear = data.gear.items.filter(i => i.quantity > 0);
  const seeds = data.seed.items.filter(i => i.quantity > 0);
  const key = JSON.stringify({ gear, seeds });
  if (key === lastStockKey) return;
  lastStockKey = key;
  lastStockDataRaw = data;

  const db = await getJson(DATABASE_FILE);
  const vip = await getJson(VIP_FILE);
  const notify = await getJson(STOCK_FILE);

  const time = getPHTime();
  const admins = Object.entries(db).filter(([_, u]) => u.role === 'Admin');
  const consoleEnabled = await getConsoleSetting();

  let log = `📦 Stock Update @ ${time}\n`;

  for (const [id, list] of Object.entries(vip)) {
    const found = [...gear, ...seeds].filter(i => list.includes(i.name));
    if (found.length) {
      await sendMessage(id, {
        text: `🚨 VIP In Stock:\n${found.map(i =>
          `- ${itemEmojis[i.name] || ''} ${i.name}: x${formatQty(i.quantity)}`
        ).join('\n')}`
      });
      log += `👤 ${db[id]?.name}: ${found.length} VIP(s)\n`;
    }
  }

  const gearMsg = gear.map(i => `- ${i.name}: x${formatQty(i.quantity)}`).join('\n');
  const seedMsg = seeds.map(i => `- ${i.name}: x${formatQty(i.quantity)}`).join('\n');
  const final = `🛠️ Gear:\n${gearMsg}\n\n🌱 Seeds:\n${seedMsg}\n📅 ${time}`;

  for (const id of Object.keys(notify)) await sendMessage(id, { text: final });
  if (consoleEnabled) {
    for (const [aid] of admins) await sendMessage(aid, { text: log });
  }
};

const connectWS = () => {
  const ws = new WebSocket(WS_URL);
  ws.on('open', async () => {
    console.log(`[WS] Connected to ${WS_URL}`);
    const db = await getJson(DATABASE_FILE);
    const consoleEnabled = await getConsoleSetting();
    if (consoleEnabled) {
      for (const [id, user] of Object.entries(db)) {
        if (user.role === 'Admin') {
          const now = new Date(new Date().toLocaleString('en-US', { timeZone: PH_TIMEZONE }));
          const part = now.getHours() < 12 ? 'Morning' : now.getHours() < 18 ? 'Afternoon' : 'Evening';
          await sendMessage(id, {
            text: `🤖 Bot online at ${now.toLocaleTimeString()}, ${now.toLocaleDateString()} (${part})`
          });
        }
      }
    }
  });
  ws.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.status === 'success') handleStockData(parsed.data);
    } catch (e) {
      console.error('[WS ERROR]', e.message);
    }
  });
  ws.on('close', () => {
    console.log('[WS] Disconnected. Retrying...');
    setTimeout(connectWS, 3000);
  });
};

app.use(bodyParser.json());
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN)
    return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});
app.post('/webhook', async (req, res) => {
  if (req.body.object === 'page') {
    for (const entry of req.body.entry) {
      for (const ev of entry.messaging) {
        const id = ev.sender.id;
        await sendWelcomeIfNew(id);
        if (ev.message?.text) await handleCommand(id, ev.message.text);
        if (ev.message?.attachments) {
          for (const m of ev.message.attachments) {
            console.log(`[${id}] SENT ${m.type.toUpperCase()}: ${m.payload.url}`);
          }
        }
      }
    }
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Bot running on port ${PORT}`);
  connectWS();
});