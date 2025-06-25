require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const WebSocket = require('ws');
const path = require('path');
const { getJson, saveJson, getUserName, sendMessage, getPHTime, logMsg } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;
const WS_URL = 'wss://gagstock.gleeze.com/grow-a-garden';
const PH_TIMEZONE = 'Asia/Manila';

const DATABASE_FILE = './database.json';
const VIP_FILE = './vip.json';
const STOCK_FILE = './stock_notify.json';
const CONSOLE_FILE = './console.json';

global.START_TIME = Date.now();
global.lastStockDataRaw = null;
let lastStockKey = null;

const commandHandlers = {
  help: require('./commands/help'),
  uptime: require('./commands/uptime'),
  broadcast: require('./commands/broadcast'),
  vip: require('./commands/vip'),
  stock: require('./commands/stock'),
  console: require('./commands/console'),
};

const sendWelcomeIfNew = async (id) => {
  const db = await getJson(DATABASE_FILE);
  if (!db[id]) {
    const name = await getUserName(id, process.env.PAGE_ACCESS_TOKEN);
    db[id] = {
      name,
      joined: getPHTime(),
      role: id === process.env.ADMIN_ID ? 'Admin' : 'Member',
    };
    await saveJson(DATABASE_FILE, db);
    await sendMessage(id, {
      text: `👋 Hello ${name}!\nWelcome to Grow A Garden Bot 🌱\nI’ll notify you about VIP items & stock!\nMade by Mart John Labaco 💡`
    });
    if (process.env.ADMIN_ID) {
      await sendMessage(process.env.ADMIN_ID, {
        text: `📥 New user detected: ${name} (${id})`,
      });
    }
  }
};

const handleCommand = async (id, text) => {
  const db = await getJson(DATABASE_FILE);
  const vip = await getJson(VIP_FILE);
  const notify = await getJson(STOCK_FILE);
  const role = db[id]?.role || 'Member';
  const cleanText = text.trim().toLowerCase();

  await logMsg(id, text, DATABASE_FILE);

  if (cleanText === '/help') return commandHandlers.help(id, text, { role });
  if (cleanText === '/uptime') return commandHandlers.uptime(id, text, { role });
  if (cleanText.startsWith('/broadcast ')) {
    return commandHandlers.broadcast(id, text, { role, db });
  }
  if (cleanText.startsWith('/vip')) return commandHandlers.vip(id, text, { vip });
  if (cleanText.startsWith('/stock')) return commandHandlers.stock(id, text, { notify, role });
  if (cleanText.startsWith('/console')) return commandHandlers.console(id, text, { role });
};

const logToConsole = async (id, message) => {
  const db = await getJson(DATABASE_FILE);
  const consoleConfig = await getJson(CONSOLE_FILE);
  if (!consoleConfig.enabled) return;

  const user = db[id];
  if (!user) return;

  const prefix = user.role === 'Admin' ? '👑' : '😎';
  const logMsg = `[${id}] [${user.name}] [${prefix}]: ${message}`;

  for (const [uid, userData] of Object.entries(db)) {
    if (userData.role === 'Admin') {
      await sendMessage(uid, { text: logMsg });
    }
  }
};

const handleStockData = async (data) => {
  const gear = data.gear.items.filter(i => i.quantity > 0);
  const seeds = data.seed.items.filter(i => i.quantity > 0);
  const key = JSON.stringify({ gear, seeds });
  if (key === lastStockKey) return;
  lastStockKey = key;
  global.lastStockDataRaw = data;

  const db = await getJson(DATABASE_FILE);
  const vip = await getJson(VIP_FILE);
  const notify = await getJson(STOCK_FILE);
  const consoleEnabled = (await getJson(CONSOLE_FILE)).enabled === true;
  const time = getPHTime();

  let log = `📦 Stock Update @ ${time}\n`;

  for (const [id, list] of Object.entries(vip)) {
    const matches = [...gear, ...seeds].filter(i => list.includes(i.name));
    if (matches.length) {
      await sendMessage(id, {
        text: `🚨 VIP In Stock:\n${matches.map(i => `- ${i.name}: x${i.quantity}`).join('\n')}`
      });
      log += `👤 ${db[id]?.name || id}: ${matches.length} VIP(s)\n`;
    }
  }

  const finalMsg = [
    '🛠️ Gear:',
    gear.map(i => `- ${i.name}: x${i.quantity}`).join('\n'),
    '',
    '🌱 Seeds:',
    seeds.map(i => `- ${i.name}: x${i.quantity}`).join('\n'),
    '',
    `📅 ${time}`
  ].join('\n');

  for (const id of Object.keys(notify)) {
    await sendMessage(id, { text: finalMsg });
  }

  if (consoleEnabled) {
    for (const [id, user] of Object.entries(db)) {
      if (user.role === 'Admin') {
        await sendMessage(id, { text: log });
      }
    }
  }
};

const connectWS = () => {
  const ws = new WebSocket(WS_URL);
  ws.on('open', async () => {
    const db = await getJson(DATABASE_FILE);
    const consoleEnabled = (await getJson(CONSOLE_FILE)).enabled === true;
    if (consoleEnabled) {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: PH_TIMEZONE }));
      const part = now.getHours() < 12 ? 'Morning' : now.getHours() < 18 ? 'Afternoon' : 'Evening';
      for (const [id, user] of Object.entries(db)) {
        if (user.role === 'Admin') {
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

// 🌐 Serve static files like doc.html from the public folder
app.use(express.static('public'));

// 📄 Serve /doc as doc.html
app.get('/doc', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'doc.html'));
});

// 🔁 Redirect root to /doc
app.get('/', (req, res) => {
  res.redirect('/doc');
});

// 📩 Facebook webhook endpoint
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN)
    return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  if (req.body.object === 'page') {
    for (const entry of req.body.entry) {
      for (const ev of entry.messaging) {
        const id = ev.sender.id;
        await sendWelcomeIfNew(id);
        const db = await getJson(DATABASE_FILE);

        if (ev.message?.text) {
          await handleCommand(id, ev.message.text);
          await logToConsole(id, ev.message.text);
        }

        if (ev.message?.attachments) {
          for (const m of ev.message.attachments) {
            const url = m.payload?.url || 'Unknown Media';
            await logToConsole(id, `${m.type.toUpperCase()}: ${url}`);
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