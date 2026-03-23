// Monster spawning and management

import type { Database } from 'better-sqlite3';
import type { Location, MonsterTemplate } from '../types.js';

const SPAWN_CAP = 4; // max active monsters per location

// Spawn monsters for all wild/dungeon locations that are below cap.
// Called on server start and on a timer.
export function spawnMonsters(db: Database): void {
  const wildLocations = db
    .prepare(`SELECT * FROM locations WHERE type IN ('wild', 'dungeon')`)
    .all() as Location[];

  const insertMonster = db.prepare(`
    INSERT INTO active_monsters (id, template_id, location_id, current_hp)
    VALUES (?, ?, ?, ?)
  `);

  const countAtLocation = db.prepare(
    `SELECT COUNT(*) as count FROM active_monsters WHERE location_id = ?`,
  );

  const templatesForLocation = db.prepare(`
    SELECT * FROM monster_templates WHERE location_ids LIKE ?
  `);

  const spawnAll = db.transaction(() => {
    for (const location of wildLocations) {
      const { count } = countAtLocation.get(location.id) as { count: number };
      const toSpawn = SPAWN_CAP - count;
      if (toSpawn <= 0) continue;

      // Find templates that include this location
      const templates = templatesForLocation.all(`%${location.id}%`) as MonsterTemplate[];
      if (templates.length === 0) continue;

      for (let i = 0; i < toSpawn; i++) {
        const template = templates[Math.floor(Math.random() * templates.length)];
        const monsterId = crypto.randomUUID();
        insertMonster.run(monsterId, template.id, location.id, template.hp);
      }
    }
  });

  spawnAll();
}
