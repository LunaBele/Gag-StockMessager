const { formatUptime, sendMessage } = require('../utils');

module.exports = async (id, text, { role }) => {
  if (role !== 'Admin') return sendMessage(id, { text: '⛔ Admins only.' });
  return sendMessage(id, { text: `⏱️ Bot uptime: ${formatUptime(global.START_TIME)}` });
};