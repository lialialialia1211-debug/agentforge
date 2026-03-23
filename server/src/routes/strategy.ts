import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { Agent, AgentStrategy, ApiResponse } from '../types.js';

const router = Router();

// Valid location IDs for preferred_zone validation
const VALID_LOCATION_IDS = new Set([
  'auto',
  'spawn_terminal',
  'npm_commons',
  'pypi_shores',
  'crates_peaks',
  'maven_depths',
  'package_bazaar',
]);

// Field type map for safe dynamic UPDATE building
const ALLOWED_FIELDS: Record<string, 'string' | 'number' | 'boolean'> = {
  combat_style: 'string',
  hp_retreat_threshold: 'number',
  target_priority: 'string',
  auto_equip: 'boolean',
  auto_potion: 'boolean',
  potion_threshold: 'number',
  preferred_zone: 'string',
  pvp_enabled: 'boolean',
  pvp_aggression: 'string',
  trade_enabled: 'boolean',
  sell_materials: 'boolean',
  buy_potions_when_low: 'boolean',
  explore_new_zones: 'boolean',
};

// Convert SQLite integer booleans to proper booleans for the API response
function toApiStrategy(row: AgentStrategy) {
  return {
    combat_style: row.combat_style,
    hp_retreat_threshold: row.hp_retreat_threshold,
    target_priority: row.target_priority,
    auto_equip: Boolean(row.auto_equip),
    auto_potion: Boolean(row.auto_potion),
    potion_threshold: row.potion_threshold,
    preferred_zone: row.preferred_zone,
    pvp_enabled: Boolean(row.pvp_enabled),
    pvp_aggression: row.pvp_aggression,
    trade_enabled: Boolean(row.trade_enabled),
    sell_materials: Boolean(row.sell_materials),
    buy_potions_when_low: Boolean(row.buy_potions_when_low),
    explore_new_zones: Boolean(row.explore_new_zones),
  };
}

// POST /api/strategy — get or set agent strategy
router.post('/strategy', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const { action } = req.body as { action?: string };

    if (!action) {
      const response: ApiResponse = { ok: false, error: 'action is required (get, set)' };
      res.status(400).json(response);
      return;
    }

    const db = getDb();

    // --- GET ---
    if (action === 'get') {
      const strategy = db.prepare('SELECT * FROM agent_strategies WHERE agent_id = ?').get(agent.id) as AgentStrategy | undefined;

      if (!strategy) {
        // Auto-create if missing (e.g. legacy agents)
        db.prepare('INSERT OR IGNORE INTO agent_strategies (agent_id) VALUES (?)').run(agent.id);
        const created = db.prepare('SELECT * FROM agent_strategies WHERE agent_id = ?').get(agent.id) as AgentStrategy;
        const response: ApiResponse = { ok: true, data: { strategy: toApiStrategy(created) } };
        res.json(response);
        return;
      }

      const response: ApiResponse = { ok: true, data: { strategy: toApiStrategy(strategy) } };
      res.json(response);
      return;
    }

    // --- SET ---
    if (action === 'set') {
      const { strategy: strategyInput } = req.body as { strategy?: Record<string, unknown> };

      if (!strategyInput || typeof strategyInput !== 'object') {
        const response: ApiResponse = { ok: false, error: 'strategy object is required for action "set"' };
        res.status(400).json(response);
        return;
      }

      // Validate provided fields
      for (const [key, value] of Object.entries(strategyInput)) {
        if (!(key in ALLOWED_FIELDS)) continue; // skip unknown keys

        if (key === 'combat_style' && !['aggressive', 'balanced', 'cautious'].includes(value as string)) {
          const response: ApiResponse = { ok: false, error: 'combat_style must be: aggressive, balanced, or cautious' };
          res.status(400).json(response);
          return;
        }

        if (key === 'hp_retreat_threshold') {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 10 || n > 80) {
            const response: ApiResponse = { ok: false, error: 'hp_retreat_threshold must be an integer between 10 and 80' };
            res.status(400).json(response);
            return;
          }
        }

        if (key === 'target_priority' && !['weakest', 'strongest', 'highest_exp', 'highest_loot'].includes(value as string)) {
          const response: ApiResponse = { ok: false, error: 'target_priority must be: weakest, strongest, highest_exp, or highest_loot' };
          res.status(400).json(response);
          return;
        }

        if (key === 'potion_threshold') {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 20 || n > 80) {
            const response: ApiResponse = { ok: false, error: 'potion_threshold must be an integer between 20 and 80' };
            res.status(400).json(response);
            return;
          }
        }

        if (key === 'pvp_aggression' && !['aggressive', 'defensive', 'passive'].includes(value as string)) {
          const response: ApiResponse = { ok: false, error: 'pvp_aggression must be: aggressive, defensive, or passive' };
          res.status(400).json(response);
          return;
        }

        if (key === 'preferred_zone' && !VALID_LOCATION_IDS.has(value as string)) {
          const response: ApiResponse = { ok: false, error: `preferred_zone must be "auto" or a valid location_id: ${[...VALID_LOCATION_IDS].filter(id => id !== 'auto').join(', ')}` };
          res.status(400).json(response);
          return;
        }
      }

      // Build dynamic UPDATE — only update provided allowed fields
      const updates: string[] = [];
      const values: unknown[] = [];

      for (const [key, value] of Object.entries(strategyInput)) {
        if (!(key in ALLOWED_FIELDS)) continue;
        const fieldType = ALLOWED_FIELDS[key];
        updates.push(`${key} = ?`);
        values.push(fieldType === 'boolean' ? (value ? 1 : 0) : value);
      }

      if (updates.length > 0) {
        values.push(agent.id);
        db.prepare(`UPDATE agent_strategies SET ${updates.join(', ')} WHERE agent_id = ?`).run(...values);
      }

      // Fetch and return the full updated strategy
      const updated = db.prepare('SELECT * FROM agent_strategies WHERE agent_id = ?').get(agent.id) as AgentStrategy | undefined;

      if (!updated) {
        // Edge case: strategy row didn't exist yet, create and return defaults
        db.prepare('INSERT OR IGNORE INTO agent_strategies (agent_id) VALUES (?)').run(agent.id);
        const fresh = db.prepare('SELECT * FROM agent_strategies WHERE agent_id = ?').get(agent.id) as AgentStrategy;
        const response: ApiResponse = { ok: true, data: { strategy: toApiStrategy(fresh) } };
        res.json(response);
        return;
      }

      const response: ApiResponse = { ok: true, data: { strategy: toApiStrategy(updated) } };
      res.json(response);
      return;
    }

    // Unknown action
    const response: ApiResponse = { ok: false, error: `Unknown action '${action}'. Use: get, set` };
    res.status(400).json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
