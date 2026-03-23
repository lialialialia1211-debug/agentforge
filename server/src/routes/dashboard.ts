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

    // All agents — public info only (fog of war: hide combat stats, gold, equipment)
    const agentRows = db.prepare(`
      SELECT a.id, a.name, a.level, a.location_id, l.name as location_name, a.status
      FROM agents a
      JOIN locations l ON a.location_id = l.id
    `).all() as any[];

    const agents = agentRows.map((agent) => ({
      name: agent.name,
      level: agent.level,
      location_id: agent.location_id,
      location_name: agent.location_name,
      status: agent.status,
    }));

    // Location summary with description, level range, monsters, connected_to
    const locationRows = db.prepare(`
      SELECT l.id, l.name, l.description, l.type, l.level_min, l.level_max, l.connected_to,
             (SELECT COUNT(*) FROM agents WHERE location_id = l.id) as agent_count,
             (SELECT COUNT(*) FROM active_monsters WHERE location_id = l.id) as monster_count
      FROM locations l
    `).all() as any[];

    // Location summary — fog of war: hide individual monster details
    const locations = locationRows.map((loc) => {
      let connectedTo: string[] = [];
      try {
        connectedTo = JSON.parse(loc.connected_to ?? '[]');
      } catch {
        connectedTo = [];
      }

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
      };
    });

    // Recent events with agent_id and location_id
    const recentEvents = db.prepare(`
      SELECT timestamp, event_type, agent_id, message, location_id
      FROM game_log
      ORDER BY id DESC LIMIT 20
    `).all();

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
        },
        agents,
        locations,
        recent_events: recentEvents,
      },
    };
    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
