const { sendMessage, getPHTime, formatQty } = require('../utils');

module.exports = async (id, text, { notify, role }) => {
  const command = text.trim().toLowerCase();

  // /stock -on
  if (command === '/stock -on') {
    notify[id] = true;
    const { saveJson } = require('../utils');
    await saveJson('./stock_notify.json', notify);
    return sendMessage(id, { text: '✅ Stock updates enabled.' });
  }

  // /stock -off
  if (command === '/stock -off') {
    delete notify[id];
    const { saveJson } = require('../utils');
    await saveJson('./stock_notify.json', notify);
    return sendMessage(id, { text: '❌ Stock updates disabled.' });
  }

  // /stock - view current stock data
  if (command === '/stock') {
    if (!global.lastStockDataRaw) {
      return sendMessage(id, { text: '⏳ Waiting for stock data...' });
    }

    const s = global.lastStockDataRaw;
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
      text: `📦 Current Stock\n\n${clean}\n\n📅 As of: ${getPHTime()}`
    });
  }

  return sendMessage(id, { text: '❓ Unknown stock command.' });
};