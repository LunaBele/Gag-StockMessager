const { saveJson, sendMessage } = require('../utils');

const itemEmojis = {
  'Watering Can': '🚿', 'Trowel': '🛠️', 'Basic Sprinkler': '💧',
  'Advanced Sprinkler': '💦', 'Master Sprinkler': '🌊', 'Godly Sprinkler': '⛲',
  'Recall Wrench': '🔧', 'Lightning Rod': '⚡', 'Favorite Tool': '❤️', 'Harvest Tool': '🌾',
  'Carrot': '🥕', 'Tomato': '🍅', 'Corn': '🌽', 'Sugar Apple': '🍏',
  'Loquat': '🟨', 'Feijoa': '🟩', 'Rosy Delight': '🌹', 'Kiwi': '🥝', 'Bell Pepper': '🫑'
};

const VIP_ITEMS = Object.keys(itemEmojis);

module.exports = async (id, text, { vip }) => {
  const command = text.trim().toLowerCase();

  // /vip -list
  if (command === '/vip -list') {
    const list = VIP_ITEMS.map((v, i) => `#${i + 1} ${v}`).join('\n');
    return sendMessage(id, { text: `📋 VIP List:\n${list}` });
  }

  // /vip #1,#2,#3
  if (command.startsWith('/vip #')) {
    const nums = [...text.matchAll(/#(\d+)/g)].map(m => parseInt(m[1]));
    const selected = nums.map(i => VIP_ITEMS[i - 1]).filter(Boolean);
    if (selected.length) {
      vip[id] = selected;
      await saveJson('./vip.json', vip);
      const msg = selected.map(n => `- ${itemEmojis[n] || ''} ${n}`).join('\n');
      return sendMessage(id, { text: `✅ VIP Set:\n${msg}` });
    } else {
      return sendMessage(id, { text: '⚠️ Invalid.' });
    }
  }

  // /vip -reset
  if (command === '/vip -reset') {
    delete vip[id];
    await saveJson('./vip.json', vip);
    return sendMessage(id, { text: '🗑️ VIP cleared.' });
  }

  // /vip -show
  if (command === '/vip -show') {
    const selected = vip[id];
    if (!selected || selected.length === 0) return sendMessage(id, { text: '📭 No VIP items selected.' });
    const listed = selected.map((item, i) => `#${i + 1} ${itemEmojis[item] || ''} ${item}`).join('\n');
    return sendMessage(id, { text: `📬 Your VIP Items:\n${listed}` });
  }

  // /vip -delete #1,#2
  if (command.startsWith('/vip -delete')) {
    const selected = vip[id];
    if (!selected || selected.length === 0)
      return sendMessage(id, { text: '📭 No VIP items to delete.' });

    const match = text.match(/#\d+/g);
    const indexes = match ? match.map(m => parseInt(m.slice(1)) - 1) : [];
    const filtered = selected.filter((_, i) => !indexes.includes(i));

    vip[id] = filtered;
    await saveJson('./vip.json', vip);

    const updated = filtered.map((item, i) => `#${i + 1} ${itemEmojis[item] || ''} ${item}`).join('\n');
    return sendMessage(id, { text: `🗑️ Updated VIP Items:\n${updated || '📭 Empty'}` });
  }

  return sendMessage(id, { text: '❓ Unknown VIP command.' });
};