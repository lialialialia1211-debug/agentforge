import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { seedDatabase } from './seed.js';

// Resolve __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let dbInstance: Database.Database | null = null;

// Initialize database — creates file and all tables if they don't exist
export function initDb(dbPath?: string): Database.Database {
  if (dbInstance) return dbInstance;

  // Default: server/data/codemud.db
  const resolvedPath = dbPath ?? resolve(__dirname, '../../data/codemud.db');

  // Ensure data directory exists
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const db = new Database(resolvedPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables(db);
  seedDatabase(db);

  dbInstance = db;
  console.log(`Database initialized at: ${resolvedPath}`);
  return db;
}

// Returns the singleton database instance (must call initDb first)
export function getDb(): Database.Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return dbInstance;
}

function createTables(db: Database.Database): void {
  // Agents — the AI player characters
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      token       TEXT NOT NULL UNIQUE,
      level       INTEGER NOT NULL DEFAULT 1,
      exp         INTEGER NOT NULL DEFAULT 0,
      exp_to_next INTEGER NOT NULL DEFAULT 100,
      hp          INTEGER NOT NULL DEFAULT 100,
      max_hp      INTEGER NOT NULL DEFAULT 100,
      attack      INTEGER NOT NULL DEFAULT 10,
      defense     INTEGER NOT NULL DEFAULT 5,
      gold        INTEGER NOT NULL DEFAULT 50,
      location_id TEXT NOT NULL DEFAULT 'spawn_terminal',
      status      TEXT NOT NULL DEFAULT 'idle'
                    CHECK(status IN ('idle','combat','traveling','dead')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Locations — world map nodes
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      type         TEXT NOT NULL CHECK(type IN ('town','wild','dungeon')),
      level_min    INTEGER NOT NULL DEFAULT 1,
      level_max    INTEGER NOT NULL DEFAULT 99,
      connected_to TEXT NOT NULL DEFAULT '[]'
    )
  `);

  // Monster templates — static data defining monster stats
  db.exec(`
    CREATE TABLE IF NOT EXISTS monster_templates (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      level           INTEGER NOT NULL DEFAULT 1,
      hp              INTEGER NOT NULL DEFAULT 10,
      attack          INTEGER NOT NULL DEFAULT 3,
      defense         INTEGER NOT NULL DEFAULT 1,
      exp_reward      INTEGER NOT NULL DEFAULT 5,
      gold_reward_min INTEGER NOT NULL DEFAULT 1,
      gold_reward_max INTEGER NOT NULL DEFAULT 3,
      loot_table      TEXT,
      location_ids    TEXT NOT NULL DEFAULT '[]'
    )
  `);

  // Active monsters — spawned instances in locations
  db.exec(`
    CREATE TABLE IF NOT EXISTS active_monsters (
      id          TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES monster_templates(id),
      location_id TEXT NOT NULL REFERENCES locations(id),
      current_hp  INTEGER NOT NULL,
      spawned_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Items — item definitions (static catalog)
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      type           TEXT NOT NULL CHECK(type IN ('weapon','armor','potion','material')),
      rarity         TEXT NOT NULL CHECK(rarity IN ('white','green','blue','purple')),
      attack_bonus   INTEGER NOT NULL DEFAULT 0,
      defense_bonus  INTEGER NOT NULL DEFAULT 0,
      hp_restore     INTEGER NOT NULL DEFAULT 0,
      description    TEXT NOT NULL DEFAULT '',
      sell_price     INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Inventory — agent item ownership
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
      id       TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      item_id  TEXT NOT NULL REFERENCES items(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      equipped INTEGER NOT NULL DEFAULT 0 CHECK(equipped IN (0,1))
    )
  `);

  // Game log — audit trail of all significant events
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
      agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
      event_type  TEXT NOT NULL
                    CHECK(event_type IN ('combat','death','levelup','move','trade','loot')),
      message     TEXT NOT NULL,
      location_id TEXT REFERENCES locations(id) ON DELETE SET NULL
    )
  `);

  // Shop inventory — items available for purchase at each location
  db.exec(`
    CREATE TABLE IF NOT EXISTS shop_inventory (
      id          TEXT PRIMARY KEY,
      location_id TEXT NOT NULL REFERENCES locations(id),
      item_id     TEXT NOT NULL REFERENCES items(id),
      price       INTEGER NOT NULL,
      stock       INTEGER DEFAULT -1
    )
  `);

  // PvP challenges — agent vs agent combat requests
  db.exec(`
    CREATE TABLE IF NOT EXISTS pvp_challenges (
      id            TEXT PRIMARY KEY,
      challenger_id TEXT NOT NULL REFERENCES agents(id),
      target_id     TEXT NOT NULL REFERENCES agents(id),
      status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','accepted','declined','expired','completed')),
      result        TEXT CHECK(result IN ('challenger_win','target_win')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at   TEXT
    )
  `);

  // Trades — item/gold exchange requests between agents
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id            TEXT PRIMARY KEY,
      offerer_id    TEXT NOT NULL REFERENCES agents(id),
      target_id     TEXT NOT NULL REFERENCES agents(id),
      offer_items   TEXT NOT NULL DEFAULT '[]',
      offer_gold    INTEGER NOT NULL DEFAULT 0,
      request_items TEXT NOT NULL DEFAULT '[]',
      request_gold  INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','accepted','declined','expired')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at   TEXT
    )
  `);

  // Agent skills — per-agent skill levels for combat, scout, trade
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      skill_name TEXT NOT NULL CHECK(skill_name IN ('combat','scout','trade')),
      level      INTEGER NOT NULL DEFAULT 0,
      exp        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agent_id, skill_name)
    )
  `);

  // Agent strategies — per-agent AI behavior configuration
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_strategies (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      combat_style TEXT NOT NULL DEFAULT 'balanced' CHECK(combat_style IN ('aggressive','balanced','cautious')),
      hp_retreat_threshold INTEGER NOT NULL DEFAULT 30,
      target_priority TEXT NOT NULL DEFAULT 'weakest' CHECK(target_priority IN ('weakest','strongest','highest_exp','highest_loot')),
      auto_equip INTEGER NOT NULL DEFAULT 1,
      auto_potion INTEGER NOT NULL DEFAULT 1,
      potion_threshold INTEGER NOT NULL DEFAULT 50,
      preferred_zone TEXT NOT NULL DEFAULT 'auto',
      pvp_enabled INTEGER NOT NULL DEFAULT 1,
      pvp_aggression TEXT NOT NULL DEFAULT 'defensive' CHECK(pvp_aggression IN ('aggressive','defensive','passive')),
      trade_enabled INTEGER NOT NULL DEFAULT 1,
      sell_materials INTEGER NOT NULL DEFAULT 1,
      buy_potions_when_low INTEGER NOT NULL DEFAULT 1,
      explore_new_zones INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Add last_pvp_at column to agents if not already present
  try { db.exec("ALTER TABLE agents ADD COLUMN last_pvp_at TEXT"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN telegram_chat_id TEXT"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN auto_play INTEGER DEFAULT 1"); } catch {}

  // Add language talent system columns
  try { db.exec("ALTER TABLE agents ADD COLUMN class TEXT DEFAULT 'Novice'"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN primary_language TEXT DEFAULT 'unknown'"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN str INTEGER DEFAULT 5"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN int_stat INTEGER DEFAULT 5"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN agi INTEGER DEFAULT 5"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN vit INTEGER DEFAULT 5"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN spd INTEGER DEFAULT 5"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN cha INTEGER DEFAULT 5"); } catch {}

  // Migrate game_log to support extended event_type values (pvp, shop, skill, strategy)
  try {
    db.exec("ALTER TABLE game_log RENAME TO game_log_old");
    db.exec(`CREATE TABLE game_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
      agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
      event_type  TEXT NOT NULL CHECK(event_type IN ('combat','death','levelup','move','trade','loot','pvp','shop','skill','strategy')),
      message     TEXT NOT NULL,
      location_id TEXT REFERENCES locations(id) ON DELETE SET NULL
    )`);
    db.exec("INSERT INTO game_log SELECT * FROM game_log_old");
    db.exec("DROP TABLE game_log_old");
  } catch {}

  // Agent buffs/debuffs
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_buffs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      buff_name TEXT NOT NULL,
      buff_type TEXT NOT NULL CHECK(buff_type IN ('buff','debuff')),
      effect TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Dev events log
  db.exec(`
    CREATE TABLE IF NOT EXISTS dev_events (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      data TEXT,
      reward_summary TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Migrate game_log to support dev and buff event types
  try {
    db.exec("ALTER TABLE game_log RENAME TO game_log_old2");
    db.exec(`CREATE TABLE game_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
      agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
      event_type  TEXT NOT NULL CHECK(event_type IN ('combat','death','levelup','move','trade','loot','pvp','shop','skill','strategy','dev','buff')),
      message     TEXT NOT NULL,
      location_id TEXT REFERENCES locations(id) ON DELETE SET NULL
    )`);
    db.exec("INSERT INTO game_log SELECT * FROM game_log_old2");
    db.exec("DROP TABLE game_log_old2");
  } catch {}

  // Active battles — per-tick combat state
  db.exec(`
    CREATE TABLE IF NOT EXISTS active_battles (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      monster_id TEXT,
      opponent_id TEXT,
      agent_hp INTEGER NOT NULL,
      monster_hp INTEGER NOT NULL,
      monster_hp_start INTEGER,
      monster_name TEXT,
      monster_level INTEGER,
      monster_attack INTEGER,
      monster_defense INTEGER,
      rounds TEXT DEFAULT '[]',
      status TEXT DEFAULT 'in_progress',
      location_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // New agent columns for current_action and previous_location_id
  try { db.exec("ALTER TABLE agents ADD COLUMN current_action TEXT DEFAULT '{\"type\":\"idle\"}'"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN previous_location_id TEXT"); } catch {}

  // Add last_heartbeat column for dev integration heartbeat tracking
  try { db.exec("ALTER TABLE agents ADD COLUMN last_heartbeat TEXT"); } catch {}

  // Migrate game_log to support online and offline event types
  try {
    db.exec("ALTER TABLE game_log RENAME TO game_log_old3");
    db.exec(`CREATE TABLE game_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
      agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
      event_type  TEXT NOT NULL CHECK(event_type IN ('combat','death','levelup','move','trade','loot','pvp','shop','skill','strategy','dev','buff','online','offline')),
      message     TEXT NOT NULL,
      location_id TEXT REFERENCES locations(id) ON DELETE SET NULL
    )`);
    db.exec("INSERT INTO game_log SELECT * FROM game_log_old3");
    db.exec("DROP TABLE game_log_old3");
  } catch {}

  // Room position columns for agents
  try { db.exec("ALTER TABLE agents ADD COLUMN room_x REAL DEFAULT 400"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN room_y REAL DEFAULT 250"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN direction TEXT DEFAULT 'right'"); } catch {}

  // Room position columns for active_monsters
  try { db.exec("ALTER TABLE active_monsters ADD COLUMN room_x REAL"); } catch {}
  try { db.exec("ALTER TABLE active_monsters ADD COLUMN room_y REAL"); } catch {}
  try { db.exec("ALTER TABLE active_monsters ADD COLUMN direction TEXT DEFAULT 'left'"); } catch {}
  try { db.exec("ALTER TABLE active_monsters ADD COLUMN wander_target_x REAL"); } catch {}
  try { db.exec("ALTER TABLE active_monsters ADD COLUMN wander_target_y REAL"); } catch {}
}
