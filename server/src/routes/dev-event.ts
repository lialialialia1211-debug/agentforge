import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { Agent, ApiResponse } from '../types.js';

const router = Router();

// Helper: log a game event
function logEvent(
  db: ReturnType<typeof getDb>,
  agentId: string,
  eventType: 'dev' | 'buff',
  message: string,
  locationId: string | null,
): void {
  db.prepare(`
    INSERT INTO game_log (agent_id, event_type, message, location_id)
    VALUES (?, ?, ?, ?)
  `).run(agentId, eventType, message, locationId);
}

// Helper: add or replace a buff on an agent
function addBuff(
  db: ReturnType<typeof getDb>,
  agentId: string,
  buffName: string,
  buffType: 'buff' | 'debuff',
  effect: Record<string, unknown>,
  durationMinutes: number,
): void {
  // Remove existing buff with same name for this agent
  db.prepare('DELETE FROM agent_buffs WHERE agent_id = ? AND buff_name = ?').run(agentId, buffName);

  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19);

  db.prepare(`INSERT INTO agent_buffs (id, agent_id, buff_name, buff_type, effect, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), agentId, buffName, buffType, JSON.stringify(effect), expiresAt);
}

// Helper: add item to inventory (upsert)
function addToInventory(
  db: ReturnType<typeof getDb>,
  agentId: string,
  itemId: string,
  quantity: number,
): void {
  const existing = db.prepare('SELECT id, quantity FROM inventory WHERE agent_id = ? AND item_id = ?').get(agentId, itemId) as { id: string; quantity: number } | undefined;
  if (existing) {
    db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE id = ?').run(quantity, existing.id);
  } else {
    db.prepare('INSERT INTO inventory (id, agent_id, item_id, quantity, equipped) VALUES (?, ?, ?, ?, 0)').run(crypto.randomUUID(), agentId, itemId, quantity);
  }
}

// POST /api/dev-event — trigger a dev workflow event and receive game rewards
router.post('/dev-event', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const db = getDb();
    const { event_type, data } = req.body as { event_type?: string; data?: Record<string, unknown> };

    const validEventTypes = ['commit', 'test_pass', 'lint_pass', 'build_fail', 'merge', 'ci_green', 'ci_red', 'force_push', 'token_usage'];
    if (!event_type || !validEventTypes.includes(event_type)) {
      const response: ApiResponse = { ok: false, error: `event_type must be one of: ${validEventTypes.join(', ')}` };
      res.status(400).json(response);
      return;
    }

    let rewardSummary = '';
    let logMessage = '';

    if (event_type === 'commit') {
      const message = (data?.message as string) ?? '';

      // Grant +1 skill point to all skills
      db.prepare(`UPDATE agent_skills SET exp = exp + 1 WHERE agent_id = ?`).run(agent.id);

      let extras = '+1 skill point';

      if (message.toLowerCase().includes('fix')) {
        db.prepare(`UPDATE agents SET gold = gold + 10, updated_at = datetime('now') WHERE id = ?`).run(agent.id);
        extras += ', +10 gold';
      }
      if (message.toLowerCase().includes('feat')) {
        db.prepare(`UPDATE agents SET exp = exp + 20, updated_at = datetime('now') WHERE id = ?`).run(agent.id);
        extras += ', +20 EXP';
      }

      logMessage = `[開發] ${agent.name} 提交了 "${message}" → ${extras}`;
      rewardSummary = extras;
      logEvent(db, agent.id, 'dev', logMessage, agent.location_id);

    } else if (event_type === 'test_pass') {
      addBuff(db, agent.id, 'Iron Wall', 'buff', { stat: 'defense', modifier: 0.15 }, 10);
      logMessage = `[增益] ${agent.name} 獲得「Iron Wall」（DEF +15%，10 分鐘）`;
      rewardSummary = 'Iron Wall buff applied (DEF +15%, 10min)';
      logEvent(db, agent.id, 'buff', logMessage, agent.location_id);

    } else if (event_type === 'lint_pass') {
      addBuff(db, agent.id, 'Focus', 'buff', { stat: 'attack', modifier: 0.10 }, 10);
      logMessage = `[增益] ${agent.name} 獲得「Focus」（ATK +10%，10 分鐘）`;
      rewardSummary = 'Focus buff applied (ATK +10%, 10min)';
      logEvent(db, agent.id, 'buff', logMessage, agent.location_id);

    } else if (event_type === 'build_fail') {
      addBuff(db, agent.id, 'Chaos', 'debuff', { stat: 'chaos', modifier: 0.20 }, 5);
      logMessage = `[減益] ${agent.name} 獲得「Chaos」（20% 機率失手，5 分鐘）`;
      rewardSummary = 'Chaos debuff applied (20% miss chance, 5min)';
      logEvent(db, agent.id, 'buff', logMessage, agent.location_id);

    } else if (event_type === 'merge') {
      // Pick a random green/blue weapon or armor
      const items = db.prepare(`SELECT id, name FROM items WHERE rarity IN ('green','blue') AND type IN ('weapon','armor')`).all() as { id: string; name: string }[];
      if (items.length > 0) {
        const picked = items[Math.floor(Math.random() * items.length)];
        addToInventory(db, agent.id, picked.id, 1);
        logMessage = `[開發] ${agent.name} 合併程式碼 → 獲得 ${picked.name}！`;
        rewardSummary = `Received ${picked.name}`;
      } else {
        logMessage = `[開發] ${agent.name} 合併程式碼 → 目前沒有可獲得的裝備`;
        rewardSummary = 'No equipment available';
      }
      logEvent(db, agent.id, 'dev', logMessage, agent.location_id);

    } else if (event_type === 'ci_green') {
      addBuff(db, agent.id, 'Guardian Shield', 'buff', { stat: 'defense', modifier: 0.20 }, 15);
      logMessage = `[增益] ${agent.name} 獲得「Guardian Shield」（DEF +20%，15 分鐘）`;
      rewardSummary = 'Guardian Shield buff applied (DEF +20%, 15min)';
      logEvent(db, agent.id, 'buff', logMessage, agent.location_id);

    } else if (event_type === 'ci_red') {
      // Remove all active buffs
      db.prepare(`DELETE FROM agent_buffs WHERE agent_id = ? AND buff_type = 'buff'`).run(agent.id);
      logMessage = `[減益] ${agent.name} 的 CI 失敗 — 所有增益被移除！`;
      rewardSummary = 'All buffs removed';
      logEvent(db, agent.id, 'buff', logMessage, agent.location_id);

    } else if (event_type === 'force_push') {
      // Teleport to a random wild location
      const wildLocations = db.prepare(`SELECT id, name FROM locations WHERE type IN ('wild','dungeon')`).all() as { id: string; name: string }[];
      if (wildLocations.length > 0) {
        const dest = wildLocations[Math.floor(Math.random() * wildLocations.length)];
        db.prepare(`UPDATE agents SET location_id = ?, updated_at = datetime('now') WHERE id = ?`).run(dest.id, agent.id);
        logMessage = `[開發] ${agent.name} 強制推送，被傳送到 ${dest.name}！`;
        rewardSummary = `Teleported to ${dest.name}`;
      } else {
        logMessage = `[開發] ${agent.name} 強制推送，但找不到傳送目的地！`;
        rewardSummary = 'No teleport destination found';
      }
      logEvent(db, agent.id, 'dev', logMessage, agent.location_id);
    }

    // === Energy System ===
    const ENERGY_REWARDS: Record<string, number> = {
      commit: 5, lint_pass: 3, test_pass: 5, ci_green: 10,
      build_fail: -2, merge: 15, force_push: -10, ci_red: -5
    };

    let energyChange = 0;

    if (event_type === 'token_usage') {
      const tokens = (data?.tokens as number) || 0;
      energyChange = Math.floor(tokens / 1000);
      db.prepare('UPDATE agents SET total_tokens_consumed = total_tokens_consumed + ? WHERE id = ?')
        .run(tokens, agent.id);
      logMessage = `[能量] ${agent.name} 消耗 ${tokens.toLocaleString()} tokens → +${energyChange} 能量`;
      rewardSummary = `+${energyChange} energy from ${tokens} tokens`;
      logEvent(db, agent.id, 'dev', logMessage, agent.location_id);
    }

    if (ENERGY_REWARDS[event_type] !== undefined) {
      energyChange += ENERGY_REWARDS[event_type];
    }

    if (energyChange !== 0) {
      const currentAgent = db.prepare('SELECT energy, max_energy FROM agents WHERE id = ?').get(agent.id) as { energy: number; max_energy: number };
      const newEnergy = Math.max(0, Math.min(currentAgent.max_energy, currentAgent.energy + energyChange));
      const actualChange = newEnergy - currentAgent.energy;

      db.prepare('UPDATE agents SET energy = ?, energy_earned_today = energy_earned_today + ? WHERE id = ?')
        .run(newEnergy, Math.max(0, actualChange), agent.id);

      db.prepare(`INSERT INTO energy_log (agent_id, type, source, amount, balance_after, details) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(agent.id, energyChange > 0 ? 'earn' : 'spend', event_type, actualChange, newEnergy, JSON.stringify(data ?? {}));

      if (actualChange > 0 && event_type !== 'token_usage') {
        logEvent(db, agent.id, 'dev', `[能量] ${agent.name} 獲得 ${actualChange} 能量（${event_type}）`, agent.location_id);
      } else if (actualChange < 0) {
        logEvent(db, agent.id, 'dev', `[能量] ${agent.name} 失去 ${Math.abs(actualChange)} 能量（${event_type}）`, agent.location_id);
      }
    }

    // Record in dev_events table
    db.prepare(`INSERT INTO dev_events (id, agent_id, event_type, data, reward_summary) VALUES (?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), agent.id, event_type, JSON.stringify(data ?? {}), rewardSummary);

    const updatedAgent = db.prepare('SELECT energy, max_energy FROM agents WHERE id = ?').get(agent.id) as { energy: number; max_energy: number };

    const response: ApiResponse = {
      ok: true,
      data: {
        event_type,
        message: logMessage,
        reward_summary: rewardSummary,
        energy_change: energyChange,
        energy: updatedAgent.energy,
        max_energy: updatedAgent.max_energy,
      },
    };
    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
