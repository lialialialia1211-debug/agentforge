import { Router } from 'express';
import { getDb } from '../db/schema.js';
import type { Agent, InventoryEntry, Location, ApiResponse } from '../types.js';

const router = Router();

// POST /api/auth/register — create a new agent with default stats and starter items
router.post('/register', (req, res) => {
  try {
    const { name } = req.body as { name?: string };
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

    // Insert agent
    db.prepare(`
      INSERT INTO agents (id, name, token, level, exp, exp_to_next, hp, max_hp, attack, defense, gold, location_id, status)
      VALUES (?, ?, ?, 1, 0, ?, 100, 100, 10, 5, 50, 'starter_village', 'idle')
    `).run(agentId, trimmedName, token, expToNext);

    // Give starter inventory: wooden_sword (equipped) + 3x hp_potion_s
    db.prepare(`
      INSERT INTO inventory (id, agent_id, item_id, quantity, equipped)
      VALUES (?, ?, 'wooden_sword', 1, 1)
    `).run(crypto.randomUUID(), agentId);

    db.prepare(`
      INSERT INTO inventory (id, agent_id, item_id, quantity, equipped)
      VALUES (?, ?, 'hp_potion_s', 3, 0)
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
