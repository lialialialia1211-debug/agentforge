import { Router } from 'express';
import { getDb } from '../db/schema.js';
import type { Agent, InventoryEntry, Location, ApiResponse } from '../types.js';

const router = Router();

// Language talent mapping
interface LanguageTalent {
  class: string;
  str: number;
  int_stat: number;
  agi: number;
  vit: number;
  spd: number;
  cha: number;
}

function getLanguageTalent(language: string): LanguageTalent {
  const lang = language.toLowerCase().trim();
  const map: Record<string, LanguageTalent> = {
    python:     { class: 'Mage',      str: 5, int_stat: 8, agi: 5, vit: 5, spd: 5, cha: 7 },
    rust:       { class: 'Warrior',   str: 8, int_stat: 5, agi: 5, vit: 7, spd: 5, cha: 5 },
    javascript: { class: 'Assassin',  str: 5, int_stat: 5, agi: 7, vit: 5, spd: 8, cha: 5 },
    typescript: { class: 'Assassin',  str: 5, int_stat: 5, agi: 7, vit: 5, spd: 8, cha: 5 },
    go:         { class: 'Ranger',    str: 5, int_stat: 5, agi: 5, vit: 8, spd: 7, cha: 5 },
    java:       { class: 'Paladin',   str: 5, int_stat: 5, agi: 5, vit: 7, spd: 5, cha: 8 },
    kotlin:     { class: 'Paladin',   str: 5, int_stat: 5, agi: 5, vit: 7, spd: 5, cha: 8 },
    c:          { class: 'Berserker', str: 9, int_stat: 5, agi: 5, vit: 5, spd: 4, cha: 5 },
    cpp:        { class: 'Berserker', str: 9, int_stat: 5, agi: 5, vit: 5, spd: 4, cha: 5 },
    ruby:       { class: 'Bard',      str: 5, int_stat: 7, agi: 5, vit: 5, spd: 5, cha: 8 },
  };
  return map[lang] ?? { class: 'Sage', str: 6, int_stat: 6, agi: 6, vit: 6, spd: 6, cha: 6 };
}

// POST /api/auth/register — create a new agent with default stats and starter items
router.post('/register', (req, res) => {
  try {
    const { name, language } = req.body as { name?: string; language?: string };
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      const response: ApiResponse = { ok: false, error: 'Name is required' };
      res.status(400).json(response);
      return;
    }

    const db = getDb();
    const trimmedName = name.trim();

    // Check if name already taken
    const existing = db.prepare('SELECT id FROM agents WHERE name = ?').get(trimmedName);
    if (existing) {
      const response: ApiResponse = { ok: false, error: 'Name already taken' };
      res.status(409).json(response);
      return;
    }

    const agentId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const expToNext = Math.floor(100 * 1 * 1.5); // level 1 formula

    // Resolve language talent
    const primaryLanguage = (language && typeof language === 'string') ? language.toLowerCase().trim() : 'unknown';
    const talent = getLanguageTalent(primaryLanguage);

    // Insert agent
    db.prepare(`
      INSERT INTO agents (id, name, token, level, exp, exp_to_next, hp, max_hp, attack, defense, gold, location_id, status,
                          class, primary_language, str, int_stat, agi, vit, spd, cha)
      VALUES (?, ?, ?, 1, 0, ?, 100, 100, 10, 5, 50, 'spawn_terminal', 'idle',
              ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(agentId, trimmedName, token, expToNext,
           talent.class, primaryLanguage, talent.str, talent.int_stat, talent.agi, talent.vit, talent.spd, talent.cha);

    // Give starter inventory: rubber_duck (equipped) + 3x debug_potion
    db.prepare(`
      INSERT INTO inventory (id, agent_id, item_id, quantity, equipped)
      VALUES (?, ?, 'rubber_duck', 1, 1)
    `).run(crypto.randomUUID(), agentId);

    db.prepare(`
      INSERT INTO inventory (id, agent_id, item_id, quantity, equipped)
      VALUES (?, ?, 'debug_potion', 3, 0)
    `).run(crypto.randomUUID(), agentId);

    // Create default skills
    for (const skill of ['combat', 'scout', 'trade']) {
      db.prepare('INSERT OR IGNORE INTO agent_skills (agent_id, skill_name, level, exp) VALUES (?, ?, 0, 0)').run(agentId, skill);
    }

    // Create default strategy
    db.prepare('INSERT OR IGNORE INTO agent_strategies (agent_id) VALUES (?)').run(agentId);

    // Fetch the created agent
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as Agent;
    const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(agent.location_id) as Location;
    const inventory = db.prepare('SELECT * FROM inventory WHERE agent_id = ?').all(agentId) as InventoryEntry[];

    const response: ApiResponse = {
      ok: true,
      data: {
        agent,
        location,
        inventory,
      },
    };
    res.status(201).json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
