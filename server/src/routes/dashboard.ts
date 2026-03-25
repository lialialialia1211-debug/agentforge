import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import type { ApiResponse } from '../types.js';

const router = Router();

router.get('/dashboard', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // World stats
    const totalAgents = (db.prepare('SELECT COUNT(*) as count FROM agents').get() as any).count;
    const onlineAgents = (db.prepare("SELECT COUNT(*) as count FROM agents WHERE status != 'dead'").get() as any).count;
    const totalMonsters = (db.prepare('SELECT COUNT(*) as count FROM active_monsters').get() as any).count;
    const totalKills = (db.prepare("SELECT COUNT(*) as count FROM game_log WHERE event_type = 'combat'").get() as any).count;
    const highestLevelAgent = db.prepare(
      'SELECT name, level FROM agents ORDER BY level DESC LIMIT 1'
    ).get() as { name: string; level: number } | undefined;
    const totalEnergyInWorld = (db.prepare('SELECT COALESCE(SUM(energy), 0) as total FROM agents').get() as any).total;
    const totalTokensConsumed = (db.prepare('SELECT COALESCE(SUM(total_tokens_consumed), 0) as total FROM agents').get() as any).total;

    // All agents — show HP, stats, class for dashboard display
    const agentRows = db.prepare(`
      SELECT a.id, a.name, a.level, a.hp, a.max_hp, a.attack, a.defense, a.gold,
             a.location_id, l.name as location_name, a.status,
             a.class, a.primary_language,
             a.str, a.int_stat, a.agi, a.vit, a.spd, a.cha,
             a.current_action, a.previous_location_id, a.auto_play, a.last_heartbeat,
             a.energy, a.max_energy
      FROM agents a
      JOIN locations l ON a.location_id = l.id
    `).all() as any[];

    const agents = agentRows.map((agent: any) => {
      // Get active buffs
      const buffs = db.prepare(
        "SELECT buff_name, buff_type, effect, expires_at FROM agent_buffs WHERE agent_id = ? AND expires_at > datetime('now')"
      ).all(agent.id) as any[];

      // Parse current_action safely
      let currentAction: any = { type: 'idle' };
      try {
        if (agent.current_action) {
          currentAction = JSON.parse(agent.current_action);
        }
      } catch {}

      // Get equipped weapon
      const weapon = db.prepare(`
        SELECT it.name, it.rarity FROM inventory inv
        JOIN items it ON inv.item_id = it.id
        WHERE inv.agent_id = ? AND inv.equipped = 1 AND it.type = 'weapon'
      `).get(agent.id) as any;

      // Get equipped armor
      const armor = db.prepare(`
        SELECT it.name, it.rarity FROM inventory inv
        JOIN items it ON inv.item_id = it.id
        WHERE inv.agent_id = ? AND inv.equipped = 1 AND it.type = 'armor'
      `).get(agent.id) as any;

      return {
        id: agent.id,
        name: agent.name,
        level: agent.level,
        hp: agent.hp,
        max_hp: agent.max_hp,
        attack: agent.attack,
        defense: agent.defense,
        gold: agent.gold,
        location_id: agent.location_id,
        location_name: agent.location_name,
        status: agent.status,
        class: agent.class,
        primary_language: agent.primary_language,
        stats: {
          str: agent.str, int: agent.int_stat, agi: agent.agi,
          vit: agent.vit, spd: agent.spd, cha: agent.cha,
        },
        active_buffs: buffs.map((b: any) => ({ name: b.buff_name, type: b.buff_type })),
        current_action: currentAction,
        previous_location_id: agent.previous_location_id ?? null,
        equipped_weapon: weapon ? { name: weapon.name, rarity: weapon.rarity } : null,
        equipped_armor: armor ? { name: armor.name, rarity: armor.rarity } : null,
        last_heartbeat: agent.last_heartbeat ?? null,
        online: agent.last_heartbeat ?
          (new Date(agent.last_heartbeat + 'Z').getTime() > Date.now() - 120000) :
          agent.auto_play === 1,
        energy: agent.energy,
        max_energy: agent.max_energy,
      };
    });

    // Location summary with description, level range, monsters, connected_to
    const locationRows = db.prepare(`
      SELECT l.id, l.name, l.description, l.type, l.level_min, l.level_max, l.connected_to,
             (SELECT COUNT(*) FROM agents WHERE location_id = l.id) as agent_count,
             (SELECT COUNT(*) FROM active_monsters WHERE location_id = l.id) as monster_count
      FROM locations l
    `).all() as any[];

    // Location summary with monster details for dashboard
    const locations = locationRows.map((loc: any) => {
      let connectedTo: string[] = [];
      try {
        connectedTo = JSON.parse(loc.connected_to ?? '[]');
      } catch {
        connectedTo = [];
      }

      // Get active monsters at this location
      const monsters = db.prepare(`
        SELECT am.id, am.current_hp, mt.name, mt.level, mt.hp as max_hp
        FROM active_monsters am
        JOIN monster_templates mt ON am.template_id = mt.id
        WHERE am.location_id = ?
      `).all(loc.id) as any[];

      return {
        id: loc.id,
        name: loc.name,
        description: loc.description,
        type: loc.type,
        level_min: loc.level_min,
        level_max: loc.level_max,
        agent_count: loc.agent_count,
        monster_count: loc.monster_count,
        connected_to: connectedTo,
        monsters: monsters.map((m: any) => ({
          id: m.id, name: m.name, level: m.level, hp: m.current_hp, max_hp: m.max_hp,
        })),
      };
    });

    // Recent events with agent_id and location_id
    const recentEvents = db.prepare(`
      SELECT timestamp, event_type, agent_id, message, location_id
      FROM game_log
      ORDER BY id DESC LIMIT 20
    `).all();

    // Active battles
    const activeBattleRows = db.prepare(`
      SELECT ab.*, a.name as agent_name, a.class as agent_class, a.level as agent_level, a.max_hp as agent_max_hp
      FROM active_battles ab
      JOIN agents a ON ab.agent_id = a.id
      WHERE ab.status = 'in_progress'
    `).all() as any[];

    const activeBattles = activeBattleRows.map((b: any) => ({
      battle_id: b.id,
      agent_name: b.agent_name,
      agent_hp: b.agent_hp,
      agent_max_hp: b.agent_max_hp,
      agent_class: b.agent_class,
      agent_level: b.agent_level,
      monster_name: b.monster_name,
      monster_hp: b.monster_hp,
      monster_max_hp: b.monster_hp_start ?? b.monster_hp,
      monster_level: b.monster_level,
      location_id: b.location_id,
      rounds: (() => {
        try { return JSON.parse(b.rounds || '[]'); } catch { return []; }
      })(),
      status: b.status,
      started_at: b.created_at,
    }));

    const response: ApiResponse = {
      ok: true,
      data: {
        fog: true,
        world_stats: {
          total_agents: totalAgents,
          online_agents: onlineAgents,
          total_monsters: totalMonsters,
          total_kills: totalKills,
          highest_level_agent: highestLevelAgent ?? null,
          total_energy_in_world: totalEnergyInWorld,
          total_tokens_consumed: totalTokensConsumed,
        },
        agents,
        locations,
        recent_events: recentEvents,
        active_battles: activeBattles,
      },
    };
    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
