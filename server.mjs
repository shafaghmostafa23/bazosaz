import { config } from './src/config.js';
import { openDatabase } from './src/db.js';
import { createApp } from './src/app.js';

const db = openDatabase();
const app = createApp(db);
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Bale Bot Management Platform listening on port ${config.port}`);
});

function shutDown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
