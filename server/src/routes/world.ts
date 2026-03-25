import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { getScoutBonus } from '../game/skills.js';
import type { Agent, ActiveMonster, MonsterTemplate, Location, InventoryEntry, Item, AgentSkill, ApiResponse } from '../types.js';

const router = Router();

// GET /api/status — return full agent state + inventory + effective stats
router.get('/status', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const db = getDb();

    // Fetch inventory with item details
    const inventoryRows = db.prepare(`
      SELECT inv.*, it.name, it.type, it.rarity, it.attack_bonus, it.defense_bonus,
             it.hp_restore, it.description, it.sell_price
      FROM inventory inv
      JOIN items it ON inv.item_id = it.id
      WHERE inv.agent_id = ?
    `).all(agent.id) as (InventoryEntry & Item)[];

    // Calculate effective stats from equipped items
    let bonusAttack = 0;
    let bonusDefense = 0;
    for (const row of inventoryRows) {
      if (row.equipped === 1) {
        bonusAttack += row.attack_bonus ?? 0;
        bonusDefense += row.defense_bonus ?? 0;
      }
    }

    // Fetch skills and format with exp_to_next and bonus info
    const rawSkills = db.prepare('SELECT * FROM agent_skills WHERE agent_id = ?').all(agent.id) as AgentSkill[];
    const skills: Record<string, { level: number; exp: number; exp_to_next: number; bonus: string }> = {};
    for (const s of rawSkills) {
      const expToNext = 10 * (s.level + 1);
      let bonus = '';
      if (s.skill_name === 'combat') {
        const tiers = Math.floor(s.level / 10);
        bonus = `+${tiers * 2} ATK`;
      } else if (s.skill_name === 'scout') {
        bonus = s.level >= 10 ? 'Can see monster weaknesses' : `${10 - s.level} levels until weakness sight`;
      } else if (s.skill_name === 'trade') {
        const tiers = Math.floor(s.level / 10);
        bonus = `${tiers * 5}% buy discount, ${tiers * 5}% sell bonus`;
      }
      skills[s.skill_name] = { level: s.level, exp: s.exp, exp_to_next: expToNext, bonus };
    }

    // Active buffs/debuffs
    const activeBuffs = db.prepare(
      "SELECT buff_name, buff_type, effect, expires_at FROM agent_buffs WHERE agent_id = ? AND expires_at > datetime('now')"
    ).all(agent.id) as { buff_name: string; buff_type: string; effect: string; expires_at: string }[];

    const formattedBuffs = activeBuffs.map(b => {
      const eff = JSON.parse(b.effect);
      const expiresMs = new Date(b.expires_at + 'Z').getTime() - Date.now();
      const minutes = Math.floor(expiresMs / 60000);
      const seconds = Math.floor((expiresMs % 60000) / 1000);
      let effectStr = '';
      if (eff.stat === 'attack') effectStr = `ATK +${Math.round(eff.modifier * 100)}%`;
      else if (eff.stat === 'defense') effectStr = `DEF +${Math.round(eff.modifier * 100)}%`;
      else if (eff.stat === 'chaos') effectStr = `${Math.round(eff.modifier * 100)}% chance to miss`;
      return {
        name: b.buff_name,
        type: b.buff_type,
        effect: effectStr,
        expires_in: `${minutes}m ${seconds}s`,
      };
    });

    // Pending PVP challenges (where this agent is the target)
    const pendingChallenges = db.prepare(`
      SELECT pc.id as challenge_id, a.name as from_name, a.level as from_level, pc.created_at
      FROM pvp_challenges pc
      JOIN agents a ON pc.challenger_id = a.id
      WHERE pc.target_id = ? AND pc.status = 'pending'
      AND datetime(pc.created_at, '+60 seconds') > datetime('now')
    `).all(agent.id);

    // Pending trades (where this agent is the target)
    const pendingTrades = db.prepare(`
      SELECT t.id as trade_id, a.name as from_name, t.offer_items, t.offer_gold, t.request_items, t.request_gold, t.created_at
      FROM trades t
      JOIN agents a ON t.offerer_id = a.id
      WHERE t.target_id = ? AND t.status = 'pending'
      AND datetime(t.created_at, '+120 seconds') > datetime('now')
    `).all(agent.id);

    // Parse JSON fields for trades
    const formattedTrades = pendingTrades.map((t: any) => ({
      ...t,
      offer_items: JSON.parse(t.offer_items || '[]'),
      request_items: JSON.parse(t.request_items || '[]'),
    }));

    const agentEnergy = db.prepare('SELECT energy, max_energy, total_tokens_consumed FROM agents WHERE id = ?').get(agent.id) as any;
    const energyPct = agentEnergy.max_energy > 0 ? agentEnergy.energy / agentEnergy.max_energy : 0;
    let energyStatus = 'active';
    if (energyPct < 0.1) energyStatus = 'depleted';
    else if (energyPct < 0.3) energyStatus = 'low';

    const response: ApiResponse = {
      ok: true,
      data: {
        agent,
        inventory: inventoryRows,
        effective_attack: agent.attack + bonusAttack,
        effective_defense: agent.defense + bonusDefense,
        class: agent.class,
        primary_language: agent.primary_language,
        stats: {
          str: agent.str,
          int: agent.int_stat,
          agi: agent.agi,
          vit: agent.vit,
          spd: agent.spd,
          cha: agent.cha,
        },
        skills,
        pending_challenges: pendingChallenges,
        pending_trades: formattedTrades,
        active_buffs: formattedBuffs,
        energy: agentEnergy.energy,
        max_energy: agentEnergy.max_energy,
        total_tokens_consumed: agentEnergy.total_tokens_consumed,
        energy_status: energyStatus,
      },
    };
    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

// GET /api/look — return location info, monsters here, other agents here, exits
router.get('/look', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const db = getDb();

    const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(agent.location_id) as Location | undefined;
    if (!location) {
      const response: ApiResponse = { ok: false, error: 'Location not found' };
      res.status(404).json(response);
      return;
    }

    // Monsters at this location (join with template for full info)
    const rawMonsters = db.prepare(`
      SELECT am.id, am.template_id, am.location_id, am.current_hp, am.spawned_at,
             mt.name, mt.level, mt.hp as max_hp, mt.attack, mt.defense,
             mt.exp_reward, mt.gold_reward_min, mt.gold_reward_max
      FROM active_monsters am
      JOIN monster_templates mt ON am.template_id = mt.id
      WHERE am.location_id = ?
    `).all(agent.location_id) as (ActiveMonster & MonsterTemplate & { max_hp: number })[];

    // Apply scout weakness info if agent has scout level >= 10
    const scoutBonus = getScoutBonus(db, agent.id);
    const monsters = rawMonsters.map((m) => {
      if (!scoutBonus.canSeeWeakness) return m;
      let weakness = '';
      if (m.defense <= 3) weakness = 'Low defense — aggressive strategy recommended';
      else if (m.defense <= 6) weakness = 'Moderate defense — balanced approach';
      else if (m.defense <= 10) weakness = 'High defense — consider better equipment';
      else weakness = 'Very high defense — extreme caution advised';
      return { ...m, weakness };
    });

    // Other agents at same location (exclude self) — visible gear since co-located
    const otherAgents = db.prepare(`
      SELECT a.id, a.name, a.level, a.status, a.hp, a.max_hp
      FROM agents a
      WHERE location_id = ? AND id != ?
    `).all(agent.location_id, agent.id);

    const otherAgentsWithGear = otherAgents.map((other: any) => {
      const weapon = db.prepare(`
        SELECT it.name FROM inventory inv JOIN items it ON inv.item_id = it.id
        WHERE inv.agent_id = ? AND inv.equipped = 1 AND it.type = 'weapon'
      `).get(other.id) as any;
      const armor = db.prepare(`
        SELECT it.name FROM inventory inv JOIN items it ON inv.item_id = it.id
        WHERE inv.agent_id = ? AND inv.equipped = 1 AND it.type = 'armor'
      `).get(other.id) as any;
      return {
        name: other.name,
        level: other.level,
        hp: other.hp,
        max_hp: other.max_hp,
        status: other.status,
        equipped_weapon: weapon?.name || null,
        equipped_armor: armor?.name || null,
      };
    });

    // Connected locations (exits)
    const connectedIds: string[] = JSON.parse(location.connected_to);
    const exits = db.prepare(
      `SELECT id, name, type, level_min, level_max FROM locations WHERE id IN (${connectedIds.map(() => '?').join(',')})`,
    ).all(...connectedIds) as Location[];

    const response: ApiResponse = {
      ok: true,
      data: {
        location,
        monsters,
        other_agents: otherAgentsWithGear,
        exits,
      },
    };
    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
