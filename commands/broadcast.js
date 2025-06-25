const { sendMessage } = require('../utils');

module.exports = async (id, text, { db, role }) => {
  if (role !== 'Admin') return sendMessage(id, { text: '⛔ Admins only.' });

  const msg = text.slice('/broadcast '.length).trim();
  if (!msg) return sendMessage(id, { text: '⚠️ Provide a message to broadcast.' });

  let sent = 0;
  for (const uid of Object.keys(db)) {
    const ok = await sendMessage(uid, { text: `📢 Admin Broadcast:\n\n${msg}` });
    if (ok) sent++;
  }
  return sendMessage(id, { text: `✅ Broadcast delivered to ${sent} users ✅` });
};