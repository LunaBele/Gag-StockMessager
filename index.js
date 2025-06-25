require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const WebSocket = require('ws');
const path = require('path');
const { getUserName, sendMessage, getPHTime, logMsg } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;
const WS_URL = 'wss://gagstock.gleeze.com/grow-a-garden';
const PH_TIMEZONE = 'Asia/Manila';

global.START_TIME = Date.now();
global.lastStockDataRaw = null;
let lastStockKey = null;

// ✅ MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('✅ MongoDB Connected'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
  });

// ✅ MongoDB Schemas
const User = mongoose.model('User', new mongoose.Schema({
  _id: String,
  name: String,
  joined: String,
  role: String,
}));

const VIP = mongoose.model('VIP', new mongoose.Schema({
  _id: String,
  items: [String]
}));

const StockNotify = mongoose.model('StockNotify', new mongoose.Schema({
  _id: String
}));

const ConsoleConfig = mongoose.model('ConsoleConfig', new mongoose.Schema({
  enabled: Boolean
}));

// ✅ Command Handlers
const commandHandlers = {
  help: async (id, text, { role }) => {
    await sendMessage(id, {
      text: `📜 Commands:\n/help - Show this help\n/uptime - Show bot uptime\n/dt -show - Show all users (Admin only)`
    });
  },

  uptime: async (id, text, { role }) => {
    const ms = Date.now() - global.START_TIME;
    const secs = Math.floor(ms / 1000);
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const seconds = secs % 60;
    await sendMessage(id, {
      text: `⏱ Uptime: ${hours}h ${minutes}m ${seconds}s`
    });
  },

  dt: async (id, text, { role }) => {
    if (text.trim() !== '/dt -show') return;
    if (role !== 'Admin') {
      return sendMessage(id, { text: '⛔ You are not authorized to use this command.' });
    }

    const users = await User.find({}).lean();
    if (!users.length) {
      return sendMessage(id, { text: '📭 No users found in the database.' });
    }

    const response = users.map(u => `👤 ${u.name} (${u._id})`).join('\n');
    return sendMessage(id, {
      text: `📋 All Registered Users:\n\n${response}`
    });
  }
};

// ✅ Welcome new users
const sendWelcomeIfNew = async (id) => {
  let user = await User.findById(id);
  if (!user) {
    const name = await getUserName(id, process.env.PAGE_ACCESS_TOKEN);
    user = new User({
      _id: id,
      name,
      joined: getPHTime(),
      role: id === process.env.ADMIN_ID ? 'Admin' : 'Member',
    });
    await user.save();

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

// ✅ Command handler
const handleCommand = async (id, text) => {
  const user = await User.findById(id);
  const role = user?.role || 'Member';
  const cleanText = text.trim().toLowerCase();

  await logMsg(id, text, 'MongoDB');

  if (cleanText === '/help') return commandHandlers.help(id, text, { role });
  if (cleanText === '/uptime') return commandHandlers.uptime(id, text, { role });
  if (cleanText === '/dt -show') return commandHandlers.dt(id, text, { role });

  // Add more command routes here...
};

// ✅ Admin console logging
const logToConsole = async (id, message) => {
  const user = await User.findById(id);
  const config = await ConsoleConfig.findOne({});
  if (!config?.enabled || !user) return;

  const prefix = user.role === 'Admin' ? '👑' : '😎';
  const logMsg = `[${id}] [${user.name}] [${prefix}]: ${message}`;

  const admins = await User.find({ role: 'Admin' });
  for (const admin of admins) {
    await sendMessage(admin._id, { text: logMsg });
  }
};

// ✅ Stock WebSocket logic
const handleStockData = async (data) => {
  const gear = data.gear.items.filter(i => i.quantity > 0);
  const seeds = data.seed.items.filter(i => i.quantity > 0);
  const key = JSON.stringify({ gear, seeds });
  if (key === lastStockKey) return;
  lastStockKey = key;
  global.lastStockDataRaw = data;

  const users = await User.find({});
  const vips = await VIP.find({});
  const notifyList = await StockNotify.find({});
  const config = await ConsoleConfig.findOne({});
  const time = getPHTime();

  let log = `📦 Stock Update @ ${time}\n`;

  for (const vip of vips) {
    const matches = [...gear, ...seeds].filter(i => vip.items.includes(i.name));
    if (matches.length) {
      await sendMessage(vip._id, {
        text: `🚨 VIP In Stock:\n${matches.map(i => `- ${i.name}: x${i.quantity}`).join('\n')}`
      });
      const user = users.find(u => u._id === vip._id);
      log += `👤 ${user?.name || vip._id}: ${matches.length} VIP(s)\n`;
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

  for (const notify of notifyList) {
    await sendMessage(notify._id, { text: finalMsg });
  }

  if (config?.enabled) {
    const admins = users.filter(u => u.role === 'Admin');
    for (const admin of admins) {
      await sendMessage(admin._id, { text: log });
    }
  }
};

// ✅ WebSocket connection
const connectWS = () => {
  const ws = new WebSocket(WS_URL);
  ws.on('open', async () => {
    const admins = await User.find({ role: 'Admin' });
    const config = await ConsoleConfig.findOne({});
    if (config?.enabled) {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: PH_TIMEZONE }));
      const part = now.getHours() < 12 ? 'Morning' : now.getHours() < 18 ? 'Afternoon' : 'Evening';
      for (const admin of admins) {
        await sendMessage(admin._id, {
          text: `🤖 Bot online at ${now.toLocaleTimeString()}, ${now.toLocaleDateString()} (${part})`
        });
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
app.use(express.static('public'));

app.get('/doc', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'doc.html'));
});

app.get('/', (req, res) => {
  res.redirect('/doc');
});

// Facebook webhook
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