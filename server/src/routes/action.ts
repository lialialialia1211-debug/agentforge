import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { runCombat } from '../game/combat.js';
import { rollLoot } from '../game/loot.js';
import { getCombatBonus, grantSkillExp } from '../game/skills.js';
import type { Agent, ActiveMonster, MonsterTemplate, Location, InventoryEntry, Item, ApiResponse } from '../types.js';

const router = Router();

// Helper: log a game event
function logEvent(
  agentId: string,
  eventType: 'combat' | 'death' | 'levelup' | 'move' | 'trade' | 'loot' | 'skill',
  message: string,
  locationId: string | null,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO game_log (agent_id, event_type, message, location_id)
    VALUES (?, ?, ?, ?)
  `).run(agentId, eventType, message, locationId);
}

// Helper: compute effective attack/defense by summing equipped item bonuses
function getEffectiveStats(agent: Agent): { effectiveAttack: number; effectiveDefense: number } {
  const db = getDb();
  const equipped = db.prepare(`
    SELECT it.attack_bonus, it.defense_bonus
    FROM inventory inv
    JOIN items it ON inv.item_id = it.id
    WHERE inv.agent_id = ? AND inv.equipped = 1
  `).all(agent.id) as { attack_bonus: number; defense_bonus: number }[];

  let bonusAttack = 0;
  let bonusDefense = 0;
  for (const item of equipped) {
    bonusAttack += item.attack_bonus;
    bonusDefense += item.defense_bonus;
  }
  return {
    effectiveAttack: agent.attack + bonusAttack,
    effectiveDefense: agent.defense + bonusDefense,
  };
}

// Helper: upsert an item into agent's inventory (add qty or create new row)
function addToInventory(agentId: string, itemId: string, quantity: number): void {
  const db = getDb();
  const existing = db.prepare(
    `SELECT id, quantity FROM inventory WHERE agent_id = ? AND item_id = ?`,
  ).get(agentId, itemId) as InventoryEntry | undefined;

  if (existing) {
    db.prepare(`UPDATE inventory SET quantity = quantity + ? WHERE id = ?`).run(quantity, existing.id);
  } else {
    db.prepare(`
      INSERT INTO inventory (id, agent_id, item_id, quantity, equipped)
      VALUES (?, ?, ?, ?, 0)
    `).run(crypto.randomUUID(), agentId, itemId, quantity);
  }
}

// POST /api/move — move agent to a connected location
router.post('/move', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const { destination } = req.body as { destination?: string };

    if (!destination) {
      const response: ApiResponse = { ok: false, error: 'destination is required' };
      res.status(400).json(response);
      return;
    }

    if (agent.status === 'dead') {
      const response: ApiResponse = { ok: false, error: 'You are dead and cannot move. Rest at a town to revive.' };
      res.status(400).json(response);
      return;
    }
    if (agent.status === 'combat') {
      const response: ApiResponse = { ok: false, error: 'You cannot move while in combat.' };
      res.status(400).json(response);
      return;
    }

    const db = getDb();
    const currentLocation = db.prepare('SELECT * FROM locations WHERE id = ?').get(agent.location_id) as Location | undefined;
    if (!currentLocation) {
      const response: ApiResponse = { ok: false, error: 'Current location not found' };
      res.status(500).json(response);
      return;
    }

    const connectedIds: string[] = JSON.parse(currentLocation.connected_to);
    if (!connectedIds.includes(destination)) {
      const response: ApiResponse = { ok: false, error: `Cannot move to '${destination}' from current location. Connected: ${connectedIds.join(', ')}` };
      res.status(400).json(response);
      return;
    }

    const destLocation = db.prepare('SELECT * FROM locations WHERE id = ?').get(destination) as Location | undefined;
    if (!destLocation) {
      const response: ApiResponse = { ok: false, error: 'Destination location not found' };
      res.status(404).json(response);
      return;
    }

    // Update agent location
    db.prepare(`UPDATE agents SET location_id = ?, updated_at = datetime('now') WHERE id = ?`).run(destination, agent.id);
    logEvent(agent.id, 'move', `${agent.name} moved from ${currentLocation.name} to ${destLocation.name}.`, destination);

    // Grant scout skill exp on successful move
    const scoutSkillResult = grantSkillExp(db, agent.id, 'scout', 1);
    if (scoutSkillResult?.leveled) {
      logEvent(agent.id, 'skill', `${agent.name}'s scout skill reached level ${scoutSkillResult.newLevel}!`, destination);
    }

    const response: ApiResponse = {
      ok: true,
      data: {
        message: `You traveled to ${destLocation.name}.`,
        location: destLocation,
      },
    };
    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

// POST /api/attack — attack a monster at current location
router.post('/attack', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const { target } = req.body as { target?: string };

    if (!target) {
      const response: ApiResponse = { ok: false, error: 'target (monster id) is required' };
      res.status(400).json(response);
      return;
    }

    if (agent.status === 'dead') {
      const response: ApiResponse = { ok: false, error: 'You are dead. Rest at a town to revive.' };
      res.status(400).json(response);
      return;
    }

    const db = getDb();

    // Get the active monster (must be at same location)
    const activeMonster = db.prepare(`
      SELECT am.*, mt.name, mt.level, mt.attack, mt.defense, mt.exp_reward,
             mt.gold_reward_min, mt.gold_reward_max, mt.loot_table
      FROM active_monsters am
      JOIN monster_templates mt ON am.template_id = mt.id
      WHERE am.id = ? AND am.location_id = ?
    `).get(target, agent.location_id) as (ActiveMonster & MonsterTemplate & { loot_table: string | null }) | undefined;

    if (!activeMonster) {
      const response: ApiResponse = { ok: false, error: 'Monster not found at your current location.' };
      res.status(404).json(response);
      return;
    }

    const { effectiveAttack: baseEffectiveAttack, effectiveDefense } = getEffectiveStats(agent);
    const combatBonus = getCombatBonus(db, agent.id);
    const effectiveAttack = baseEffectiveAttack + combatBonus.attackBonus;

    // Run combat
    const combatResult = runCombat(
      effectiveAttack,
      effectiveDefense,
      agent.hp,
      {
        name: activeMonster.name,
        hp: activeMonster.current_hp,
        attack: activeMonster.attack,
        defense: activeMonster.defense,
      },
    );

    // Set agent to combat status during resolution, then back to idle
    db.prepare(`UPDATE agents SET status = 'combat', updated_at = datetime('now') WHERE id = ?`).run(agent.id);

    const resolveTransaction = db.transaction(() => {
      if (combatResult.result === 'victory') {
        // Remove dead monster
        db.prepare('DELETE FROM active_monsters WHERE id = ?').run(target);

        // Grant gold
        const goldMin = activeMonster.gold_reward_min;
        const goldMax = activeMonster.gold_reward_max;
        const goldGained = goldMin + Math.floor(Math.random() * (goldMax - goldMin + 1));

        // Grant exp + check level up
        const expGained = activeMonster.exp_reward;
        let newExp = agent.exp + expGained;
        let newLevel = agent.level;
        let newMaxHp = agent.max_hp;
        let newAttack = agent.attack;
        let newDefense = agent.defense;
        let newHp = combatResult.agentHpAfter;
        let leveled = false;

        let expToNext = agent.exp_to_next;
        while (newExp >= expToNext) {
          newExp -= expToNext;
          newLevel++;
          newMaxHp += 15;
          newAttack += 3;
          newDefense += 2;
          newHp = newMaxHp; // Full HP on level up
          leveled = true;
          expToNext = Math.floor(100 * newLevel * 1.5);
        }

        // Roll loot drops
        const drops = rollLoot(activeMonster.loot_table);
        for (const drop of drops) {
          addToInventory(agent.id, drop.item_id, drop.quantity);
        }

        // Update agent
        db.prepare(`
          UPDATE agents
          SET hp = ?, max_hp = ?, attack = ?, defense = ?, gold = gold + ?,
              exp = ?, exp_to_next = ?, level = ?, status = 'idle', updated_at = datetime('now')
          WHERE id = ?
        `).run(newHp, newMaxHp, newAttack, newDefense, goldGained, newExp, expToNext, newLevel, agent.id);

        logEvent(agent.id, 'combat', `${agent.name} defeated ${activeMonster.name}. Gained ${expGained} EXP, ${goldGained} gold.`, agent.location_id);

        if (drops.length > 0) {
          const dropNames = drops.map((d) => d.item_id).join(', ');
          logEvent(agent.id, 'loot', `${agent.name} looted: ${dropNames}.`, agent.location_id);
        }

        if (leveled) {
          logEvent(agent.id, 'levelup', `${agent.name} reached level ${newLevel}!`, agent.location_id);
        }

        // Grant combat skill exp on victory
        const combatSkillResult = grantSkillExp(db, agent.id, 'combat', 1);
        if (combatSkillResult?.leveled) {
          logEvent(agent.id, 'skill', `${agent.name}'s combat skill reached level ${combatSkillResult.newLevel}!`, agent.location_id);
        }

        return {
          result: 'victory',
          combatLog: combatResult.combatLog,
          expGained,
          goldGained,
          drops,
          leveledUp: leveled,
          newLevel,
          agentHpAfter: newHp,
        };
      } else {
        // Defeat — apply death penalty
        const goldLost = Math.max(1, Math.floor(agent.gold * 0.1));
        const respawnHp = Math.floor(agent.max_hp * 0.5);

        db.prepare(`
          UPDATE agents
          SET hp = ?, gold = gold - ?, location_id = 'starter_village',
              status = 'idle', updated_at = datetime('now')
          WHERE id = ?
        `).run(respawnHp, goldLost, agent.id);

        logEvent(agent.id, 'death', `${agent.name} was slain by ${activeMonster.name}. Lost ${goldLost} gold. Respawned at starter_village.`, agent.location_id);

        return {
          result: 'defeat',
          combatLog: combatResult.combatLog,
          goldLost,
          agentHpAfter: respawnHp,
        };
      }
    });

    const outcome = resolveTransaction();

    const response: ApiResponse = { ok: true, data: outcome };
    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

// POST /api/rest — restore HP to max (town only), also revives dead agents
router.post('/rest', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const db = getDb();

    const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(agent.location_id) as Location | undefined;
    if (!location || location.type !== 'town') {
      const response: ApiResponse = { ok: false, error: 'You can only rest in town locations.' };
      res.status(400).json(response);
      return;
    }

    db.prepare(`
      UPDATE agents
      SET hp = max_hp, status = 'idle', updated_at = datetime('now')
      WHERE id = ?
    `).run(agent.id);

    const updatedAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id) as Agent;

    const response: ApiResponse = {
      ok: true,
      data: {
        message: `You rest at ${location.name} and recover to full health.`,
        agent: updatedAgent,
      },
    };
    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

// POST /api/use — use or equip an item
router.post('/use', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const { item_id, action } = req.body as { item_id?: string; action?: 'use' | 'equip' };

    if (!item_id || !action) {
      const response: ApiResponse = { ok: false, error: 'item_id and action are required' };
      res.status(400).json(response);
      return;
    }
    if (action !== 'use' && action !== 'equip') {
      const response: ApiResponse = { ok: false, error: "action must be 'use' or 'equip'" };
      res.status(400).json(response);
      return;
    }

    const db = getDb();

    // Find item in inventory
    const invEntry = db.prepare(`
      SELECT inv.*, it.type, it.hp_restore, it.attack_bonus, it.defense_bonus, it.name
      FROM inventory inv
      JOIN items it ON inv.item_id = it.id
      WHERE inv.agent_id = ? AND inv.item_id = ?
    `).get(agent.id, item_id) as (InventoryEntry & Item) | undefined;

    if (!invEntry || invEntry.quantity <= 0) {
      const response: ApiResponse = { ok: false, error: `Item '${item_id}' not found in your inventory.` };
      res.status(404).json(response);
      return;
    }

    if (action === 'use') {
      if (invEntry.type !== 'potion') {
        const response: ApiResponse = { ok: false, error: 'Only potions can be used.' };
        res.status(400).json(response);
        return;
      }

      const healAmount = invEntry.hp_restore;
      const newHp = Math.min(agent.max_hp, agent.hp + healAmount);
      const actualHeal = newHp - agent.hp;

      // Consume one from inventory
      if (invEntry.quantity <= 1) {
        db.prepare('DELETE FROM inventory WHERE id = ?').run(invEntry.id);
      } else {
        db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(invEntry.id);
      }

      db.prepare(`UPDATE agents SET hp = ?, updated_at = datetime('now') WHERE id = ?`).run(newHp, agent.id);

      const response: ApiResponse = {
        ok: true,
        data: {
          message: `Used ${invEntry.name}. Restored ${actualHeal} HP. (HP: ${newHp}/${agent.max_hp})`,
          hp: newHp,
        },
      };
      res.json(response);
      return;
    }

    // action === 'equip'
    if (invEntry.type !== 'weapon' && invEntry.type !== 'armor') {
      const response: ApiResponse = { ok: false, error: 'Only weapons and armor can be equipped.' };
      res.status(400).json(response);
      return;
    }

    // Unequip any currently equipped item of the same type
    const currentlyEquipped = db.prepare(`
      SELECT inv.id FROM inventory inv
      JOIN items it ON inv.item_id = it.id
      WHERE inv.agent_id = ? AND inv.equipped = 1 AND it.type = ?
    `).all(agent.id, invEntry.type) as { id: string }[];

    for (const eq of currentlyEquipped) {
      db.prepare('UPDATE inventory SET equipped = 0 WHERE id = ?').run(eq.id);
    }

    // Equip the new item
    db.prepare('UPDATE inventory SET equipped = 1 WHERE id = ?').run(invEntry.id);

    const response: ApiResponse = {
      ok: true,
      data: {
        message: `Equipped ${invEntry.name}.`,
        item_id,
      },
    };
    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
