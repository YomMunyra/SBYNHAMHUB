'use strict';

const { seed } = require('./db');
const { createApp } = require('./server/app');
const { startReminderScheduler } = require('./server/lib/scheduler');

seed();

const PORT = process.env.PORT || 3000;
createApp().listen(PORT, () => {
  console.log(`SbyNhamHub server running at http://localhost:${PORT}`);
});

startReminderScheduler(Number(process.env.REMINDER_INTERVAL_MS) || 60 * 1000);
