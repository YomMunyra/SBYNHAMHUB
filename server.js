'use strict';

const { seed } = require('./db');
const { createApp } = require('./server/app');

seed();

const PORT = process.env.PORT || 3000;
createApp().listen(PORT, () => {
  console.log(`SbyNhamHub server running at http://localhost:${PORT}`);
});
