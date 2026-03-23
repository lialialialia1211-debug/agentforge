import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import type { ApiResponse } from '../types.js';

const router = Router();

// Room config for each location
const ROOM_CONFIG: Record<string, { width: number; height: number; theme: string }> = {
  spawn_terminal: { width: 800, height: 450, theme: 'terminal' },
  npm_commons: { width: 800, height: 450, theme: 'npm' },
  pypi_shores: { width: 800, height: 450, theme: 'pypi' },
  crates_peaks: { width: 800, height: 450, theme: 'crates' },
  maven_depths: { width: 800, height: 450, theme: 'maven' },
  package_bazaar: { width: 800, height: 450, theme: 'bazaar' },
};

// NPC definitions per location
const LOCATION_NPCS: Record<string, Array<{ id: string; name: string; type: string; x: number; y: number; dialogue: string }>> = {
  spawn_terminal: [
    { id: 'tutorial_npc', name: 'Terminal Guide', type: 'guide', x: 500, y: 200, dialogue: '> Welcome, developer. Type /help to begin.' },
  ],
  npm_commons: [
    { id: 'npm_shop', name: 'Package Manager', type: 'shop', x: 390, y: 130, dialogue: 'npm install gear --save' },
  ],
  package_bazaar: [
    { id: 'weapon_shop', name: 'Weapon Dealer', type: 'shop', x: 155, y: 175, dialogue: 'Finest weapons, forged in CI/CD pipelines.' },
    { id: 'potion_shop', name: 'Potion Brewer', type: 'shop', x: 585, y: 175, dialogue: 'Debug potions, freshly compiled.' },
  ],
};

// Exit definitions per location
const LOCATION_EXITS: Record<string, Array<{ id: string; name: string; type: string; x: number; y: number; edge: string }>> = {
  spawn_terminal: [
    { id: 'npm_commons', name: 'NPM Commons', type: 'wild', x: 750, y: 300, edge: 'right' },
    { id: 'package_bazaar', name: 'Package Bazaar', type: 'town', x: 400, y: 420, edge: 'bottom' },
  ],
  npm_commons: [
    { id: 'spawn_terminal', name: 'The Terminal', type: 'town', x: 400, y: 30, edge: 'top' },
    { id: 'crates_peaks', name: 'Crates Peaks', type: 'wild', x: 750, y: 80, edge: 'right' },
    { id: 'pypi_shores', name: 'PyPI Shores', type: 'wild', x: 50, y: 350, edge: 'left' },
    { id: 'package_bazaar', name: 'Package Bazaar', type: 'town', x: 400, y: 420, edge: 'bottom' },
  ],
  pypi_shores: [
    { id: 'npm_commons', name: 'NPM Commons', type: 'wild', x: 750, y: 150, edge: 'right' },
    { id: 'package_bazaar', name: 'Package Bazaar', type: 'town', x: 50, y: 200, edge: 'left' },
    { id: 'maven_depths', name: 'Maven Depths', type: 'wild', x: 750, y: 350, edge: 'right' },
  ],
  crates_peaks: [
    { id: 'npm_commons', name: 'NPM Commons', type: 'wild', x: 50, y: 300, edge: 'left' },
    { id: 'maven_depths', name: 'Maven Depths', type: 'wild', x: 400, y: 420, edge: 'bottom' },
  ],
  maven_depths: [
    { id: 'crates_peaks', name: 'Crates Peaks', type: 'wild', x: 400, y: 30, edge: 'top' },
    { id: 'pypi_shores', name: 'PyPI Shores', type: 'wild', x: 50, y: 250, edge: 'left' },
  ],
  package_bazaar: [
    { id: 'npm_commons', name: 'NPM Commons', type: 'wild', x: 400, y: 30, edge: 'top' },
    { id: 'pypi_shores', name: 'PyPI Shores', type: 'wild', x: 750, y: 250, edge: 'right' },
  ],
};

router.get('/room/:locationId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const locationId = req.params.locationId;

    // Get location info
    const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(locationId) as any;
    if (!location) {
      const response: ApiResponse = { ok: false, error: 'Location not found' };
      res.status(404).json(response);
      return;
    }

    const roomConfig = ROOM_CONFIG[locationId] || { width: 800, height: 450, theme: 'default' };

    // Get agents at this location with their room positions
    const agentRows = db.prepare(`
      SELECT a.id, a.name, a.level, a.hp, a.max_hp, a.attack, a.defense,
             a.class, a.primary_language, a.status, a.room_x, a.room_y, a.direction,
             a.current_action
      FROM agents a
      WHERE a.location_id = ?
    `).all(locationId) as any[];

    const agents = agentRows.map((a: any) => {
      // Get equipped items
      const weapon = db.prepare(`
        SELECT it.name FROM inventory inv
        JOIN items it ON inv.item_id = it.id
        WHERE inv.agent_id = ? AND inv.equipped = 1 AND it.type = 'weapon'
      `).get(a.id) as any;
      const armor = db.prepare(`
        SELECT it.name FROM inventory inv
        JOIN items it ON inv.item_id = it.id
        WHERE inv.agent_id = ? AND inv.equipped = 1 AND it.type = 'armor'
      `).get(a.id) as any;

      // Get active buffs
      const buffs = db.prepare(
        "SELECT buff_name FROM agent_buffs WHERE agent_id = ? AND expires_at > datetime('now')"
      ).all(a.id) as any[];

      let currentAction: any = { type: 'idle' };
      try { if (a.current_action) currentAction = JSON.parse(a.current_action); } catch {}

      return {
        name: a.name,
        level: a.level,
        class: a.class,
        language: a.primary_language,
        hp: a.hp,
        max_hp: a.max_hp,
        status: a.status,
        x: a.room_x ?? 400,
        y: a.room_y ?? 250,
        direction: a.direction ?? 'right',
        equipped_weapon: weapon?.name ?? null,
        equipped_armor: armor?.name ?? null,
        active_buffs: buffs.map((b: any) => b.buff_name),
        current_action: currentAction,
      };
    });

    // Get monsters at this location
    const monsterRows = db.prepare(`
      SELECT am.id, am.current_hp, am.room_x, am.room_y, am.direction,
             mt.name, mt.level, mt.hp as max_hp
      FROM active_monsters am
      JOIN monster_templates mt ON am.template_id = mt.id
      WHERE am.location_id = ?
    `).all(locationId) as any[];

    const monsters = monsterRows.map((m: any) => ({
      id: m.id,
      name: m.name,
      level: m.level,
      hp: m.current_hp,
      max_hp: m.max_hp,
      x: m.room_x ?? (100 + Math.random() * 600),
      y: m.room_y ?? (100 + Math.random() * 250),
      status: m.current_hp <= 0 ? 'dead' : 'wandering',
      direction: m.direction ?? 'left',
    }));

    // Get active battles at this location
    const battleRows = db.prepare(`
      SELECT ab.id as battle_id, a.name as agent_name, a.room_x as agent_x, a.room_y as agent_y,
             ab.monster_id, ab.monster_name, ab.monster_hp, ab.monster_hp_start, ab.rounds
      FROM active_battles ab
      JOIN agents a ON ab.agent_id = a.id
      WHERE ab.location_id = ? AND ab.status = 'in_progress'
    `).all(locationId) as any[];

    const activeBattles = battleRows.map((b: any) => {
      // Find the monster's position
      const monster = monsters.find((m: any) => m.id === b.monster_id);
      let rounds: any[] = [];
      try { rounds = JSON.parse(b.rounds || '[]'); } catch {}
      const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;

      return {
        battle_id: b.battle_id,
        agent_name: b.agent_name,
        agent_x: b.agent_x ?? 400,
        agent_y: b.agent_y ?? 250,
        monster_id: b.monster_id,
        monster_name: b.monster_name,
        monster_x: monster?.x ?? 400,
        monster_y: monster?.y ?? 200,
        latest_round: latestRound ? {
          attacker: latestRound.attacker,
          damage: latestRound.damage,
          timestamp: new Date().toISOString(),
        } : null,
      };
    });

    // Recent events for this location
    const recentEvents = db.prepare(`
      SELECT timestamp, event_type, message, location_id
      FROM game_log
      WHERE location_id = ?
      ORDER BY id DESC LIMIT 10
    `).all(locationId) as any[];

    const npcs = LOCATION_NPCS[locationId] || [];
    const exits = LOCATION_EXITS[locationId] || [];

    const response: ApiResponse = {
      ok: true,
      data: {
        location: {
          id: location.id,
          name: location.name,
          type: location.type,
          level_min: location.level_min,
          level_max: location.level_max,
          description: location.description,
          width: roomConfig.width,
          height: roomConfig.height,
          theme: roomConfig.theme,
        },
        entities: { agents, monsters, npcs },
        exits,
        active_battles: activeBattles,
        recent_events: recentEvents.map((e: any) => ({
          timestamp: e.timestamp,
          event_type: e.event_type,
          message: e.message,
          x: 400 + (Math.random() - 0.5) * 200,
          y: 200 + (Math.random() - 0.5) * 100,
        })),
      },
    };

    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
