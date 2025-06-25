const axios = require('axios');
const fs = require('fs').promises;

const getPHTime = (tz = 'Asia/Manila') =>
  new Date().toLocaleString('en-US', { timeZone: tz });

const formatQty = (v) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` :
  v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v;

const formatUptime = (start = Date.now()) => {
  const s = Math.floor((Date.now() - start) / 1000);
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

const saveJson = async (file, data) => {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
};

const getUserName = async (id, token) => {
  try {
    const res = await axios.get(`https://graph.facebook.com/${id}?fields=name&access_token=${token}`);
    return res.data.name || 'User';
  } catch {
    return 'User';
  }
};

const sendMessage = async (id, msg) => {
  try {
    await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
      recipient: { id },
      message: msg
    });
    return true;
  } catch (e) {
    console.error(`[BOT ➜ ${id}] ERROR: ${e.message}`);
    return false;
  }
};

const logMsg = async (id, msg, dbFile) => {
  const db = await getJson(dbFile);
  const u = db[id];
  const icon = u?.role === 'Admin' ? '👑' : '😀';
  console.log(`[${id}] ${u?.name || 'User'} [${icon}]: ${msg}`);
};

module.exports = {
  getPHTime,
  formatQty,
  formatUptime,
  getJson,
  saveJson,
  getUserName,
  sendMessage,
  logMsg
};