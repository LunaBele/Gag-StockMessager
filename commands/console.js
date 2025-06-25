const { sendMessage, saveJson } = require('../utils');

module.exports = async (id, text, { role }) => {
  const cmd = text.trim().toLowerCase();

  if (role !== 'Admin') return sendMessage(id, { text: '⛔ Admins only.' });

  if (cmd === '/console -on') {
    await saveJson('./console.json', { enabled: true });
    return sendMessage(id, { text: '📢 Console logging is ON.' });
  }

  if (cmd === '/console -off') {
    await saveJson('./console.json', { enabled: false });
    return sendMessage(id, { text: '🔇 Console logging is OFF.' });
  }

  return sendMessage(id, { text: '❓ Unknown console command.' });
};