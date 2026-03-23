import express from 'express';
import cors from 'cors';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db/schema.js';
import { spawnMonsters } from './game/monsters.js';
import { runAutoTick } from './game/auto-tick.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import authRouter from './routes/auth.js';
import worldRouter from './routes/world.js';
import actionRouter from './routes/action.js';
import dashboardRouter from './routes/dashboard.js';
import pvpRouter from './routes/pvp.js';
import tradeRouter from './routes/trade.js';
import shopRouter from './routes/shop.js';
import strategyRouter from './routes/strategy.js';
import devEventRouter from './routes/dev-event.js';
import heartbeatRouter from './routes/heartbeat.js';
import claudeMdRouter from './routes/claude-md.js';
import roomRouter from './routes/room.js';

const app = express();
app.use(cors());
app.use(express.json());

// Initialize database
const db = initDb();

// Mount routers
app.use('/api', authRouter);
app.use('/api', worldRouter);      // GET /api/status, GET /api/look
app.use('/api', actionRouter);     // POST /api/move, /api/attack, /api/rest, /api/use
app.use('/api', dashboardRouter);  // GET /api/dashboard (public)
app.use('/api', pvpRouter);        // POST /api/pvp
app.use('/api', tradeRouter);      // POST /api/trade
app.use('/api', shopRouter);       // POST /api/shop
app.use('/api', strategyRouter);   // POST /api/strategy
app.use('/api', devEventRouter);   // POST /api/dev-event
app.use('/api', heartbeatRouter);  // POST /api/heartbeat
app.use('/api', claudeMdRouter);   // GET  /api/claude-md
app.use('/api', roomRouter);       // GET /api/room/:locationId

// Serve dashboard static files at root
app.use(express.static(resolve(__dirname, '../../dashboard')));

// Serve skill.md at root for external access
app.get('/skill.md', (_req, res) => {
  res.sendFile(resolve(__dirname, '../../skill.md'));
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'running' });
});

// Initial monster spawn on server start
spawnMonsters(db);
console.log('Initial monster spawn complete.');

// Spawn monsters every 60 seconds
setInterval(() => {
  spawnMonsters(db);
  console.log('Monster spawn tick.');
}, 60 * 1000);

// Auto-tick engine — each agent acts every 10 seconds
setInterval(() => {
  try {
    runAutoTick(db);
  } catch (err) {
    console.error('Auto-tick error:', (err as Error).message);
  }
}, 10000);
console.log('Auto-tick engine started (10s interval).');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CodeMud server running on port ${PORT}`);
});
