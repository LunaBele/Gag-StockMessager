const { sendMessage } = require('../utils');

module.exports = async (id, text, { role }) => {
  let msg = `🆘 Commands:\n/vip -list\n/vip #1,#2\n/vip -show\n/vip -delete #1,#2\n/vip -reset\n/stock -on\n/stock -off\n/stock`;
  if (role === 'Admin') msg += `\n\n👑 Admin:\n/uptime\n/console -on\n/console -off\n/broadcast <msg>`;
  return sendMessage(id, { text: msg });
};