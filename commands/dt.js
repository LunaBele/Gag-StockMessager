// ./commands/dt.js

const { sendMessage } = require('../utils');

module.exports = async (id, text, { role }) => {
  if (text.trim() !== '/dt -show') return;

  // Restrict access to Admins only
  if (role !== 'Admin') {
    return sendMessage(id, { text: '⛔ You are not authorized to use this command.' });
  }

  const User = require('../index').User || require('mongoose').model('User');

  const users = await User.find({}).lean();
  if (!users.length) {
    return sendMessage(id, { text: '📭 No users found in the database.' });
  }

  const response = users.map(u => `👤 ${u.name} (${u._id})`).join('\n');
  return sendMessage(id, {
    text: `📋 All Registered Users:\n\n${response}`
  });
};