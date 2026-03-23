// Auto-tick engine — runs every 10 seconds and makes each active agent perform one action
import type { Database } from 'better-sqlite3';
import { runCombat } from './combat.js';
import { rollLoot } from './loot.js';
import { getCombatBonus, grantSkillExp, getTradeBonus } from './skills.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentWithStrategy {
  id: string;
  name: string;
  level: number;
  exp: number;
  exp_to_next: number;
  hp: number;
  max_hp: number;
  attack: number;
  defense: number;
  gold: number;
  location_id: string;
  status: string;
  auto_play: number;
  // strategy fields (may be null if no strategy row)
  combat_style: 'aggressive' | 'balanced' | 'cautious' | null;
  hp_retreat_threshold: number | null;
  target_priority: 'weakest' | 'strongest' | 'highest_exp' | 'highest_loot' | null;
  auto_equip: number | null;
  auto_potion: number | null;
  potion_threshold: number | null;
  preferred_zone: string | null;
  pvp_enabled: number | null;
  pvp_aggression: 'aggressive' | 'defensive' | 'passive' | null;
  sell_materials: number | null;
  buy_potions_when_low: number | null;
  explore_new_zones: number | null;
  trade_enabled: number | null;
}

interface MonsterRow {
  id: string;
  template_id: string;
  location_id: string;
  current_hp: number;
  name: string;
  level: number;
  attack: number;
  defense: number;
  max_hp: number;
  exp_reward: number;
  gold_reward_min: number;
  gold_reward_max: number;
  loot_table: string | null;
}

interface LocationRow {
  id: string;
  name: string;
  type: 'town' | 'wild' | 'dungeon';
  level_min: number;
  level_max: number;
  connected_to: string;
}

interface PvpChallengeRow {
  id: string;
  challenger_id: string;
}

// ---------------------------------------------------------------------------
// Log helper
// ---------------------------------------------------------------------------

function logEvent(
  db: Database,
  agentId: string,
  eventType: 'combat' | 'death' | 'levelup' | 'move' | 'trade' | 'loot' | 'pvp' | 'shop' | 'skill',
  message: string,
  locationId: string | null,
): void {
  db.prepare(`
    INSERT INTO game_log (agent_id, event_type, message, location_id)
    VALUES (?, ?, ?, ?)
  `).run(agentId, eventType, message, locationId);
}

// ---------------------------------------------------------------------------
// Inventory helper (upsert)
// ---------------------------------------------------------------------------

function addToInventory(db: Database, agentId: string, itemId: string, quantity: number): void {
  const existing = db.prepare(
    `SELECT id, quantity FROM inventory WHERE agent_id = ? AND item_id = ?`,
  ).get(agentId, itemId) as { id: string; quantity: number } | undefined;

  if (existing) {
    db.prepare(`UPDATE inventory SET quantity = quantity + ? WHERE id = ?`).run(quantity, existing.id);
  } else {
    db.prepare(`
      INSERT INTO inventory (id, agent_id, item_id, quantity, equipped)
      VALUES (?, ?, ?, ?, 0)
    `).run(crypto.randomUUID(), agentId, itemId, quantity);
  }
}

// ---------------------------------------------------------------------------
// Effective stats helper
// ---------------------------------------------------------------------------

function getEffectiveStats(db: Database, agent: AgentWithStrategy): { effectiveAttack: number; effectiveDefense: number } {
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
  const combatBonus = getCombatBonus(db, agent.id);
  return {
    effectiveAttack: agent.attack + bonusAttack + combatBonus.attackBonus,
    effectiveDefense: agent.defense + bonusDefense,
  };
}

// ---------------------------------------------------------------------------
// Helper: usePotion
// Returns true if a potion was used (consumed for this tick)
// ---------------------------------------------------------------------------

function usePotion(db: Database, agent: AgentWithStrategy): boolean {
  // Prefer medium potion, fall back to small
  const potion = db.prepare(`
    SELECT inv.id, inv.quantity, inv.item_id, it.hp_restore, it.name
    FROM inventory inv
    JOIN items it ON inv.item_id = it.id
    WHERE inv.agent_id = ? AND inv.equipped = 0
      AND inv.item_id IN ('hp_potion_m', 'hp_potion_s')
    ORDER BY it.hp_restore DESC
    LIMIT 1
  `).get(agent.id) as { id: string; quantity: number; item_id: string; hp_restore: number; name: string } | undefined;

  if (!potion) return false;

  const newHp = Math.min(agent.max_hp, agent.hp + potion.hp_restore);

  // Consume one unit
  if (potion.quantity <= 1) {
    db.prepare('DELETE FROM inventory WHERE id = ?').run(potion.id);
  } else {
    db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(potion.id);
  }

  db.prepare(`UPDATE agents SET hp = ?, updated_at = datetime('now') WHERE id = ?`).run(newHp, agent.id);
  logEvent(db, agent.id, 'combat', `${agent.name} used ${potion.name} and restored ${newHp - agent.hp} HP. (HP: ${newHp}/${agent.max_hp})`, agent.location_id);
  return true;
}

// ---------------------------------------------------------------------------
// Helper: doRest — restore to full HP (town only)
// ---------------------------------------------------------------------------

function doRest(db: Database, agent: AgentWithStrategy): void {
  db.prepare(`UPDATE agents SET hp = max_hp, status = 'idle', updated_at = datetime('now') WHERE id = ?`).run(agent.id);
  logEvent(db, agent.id, 'combat', `${agent.name} rested and recovered to full HP.`, agent.location_id);
}

// ---------------------------------------------------------------------------
// Helper: moveTowardsTown — pick a connected location leading toward a town
// ---------------------------------------------------------------------------

function moveTowardsTown(db: Database, agent: AgentWithStrategy, currentLocation: LocationRow): void {
  const connectedIds: string[] = JSON.parse(currentLocation.connected_to);
  if (connectedIds.length === 0) return;

  // Priority: starter_village > town_market > any town
  let destination: string | null = null;

  if (connectedIds.includes('starter_village')) {
    destination = 'starter_village';
  } else if (connectedIds.includes('town_market')) {
    destination = 'town_market';
  } else {
    // Check if any connected location is a town
    for (const id of connectedIds) {
      const loc = db.prepare('SELECT type FROM locations WHERE id = ?').get(id) as { type: string } | undefined;
      if (loc?.type === 'town') {
        destination = id;
        break;
      }
    }
    // Otherwise just take the first connected location (moving toward safety)
    if (!destination) destination = connectedIds[0];
  }

  if (!destination) return;

  const destLocation = db.prepare('SELECT * FROM locations WHERE id = ?').get(destination) as LocationRow | undefined;
  if (!destLocation) return;

  db.prepare(`UPDATE agents SET location_id = ?, updated_at = datetime('now') WHERE id = ?`).run(destination, agent.id);

  const scoutResult = grantSkillExp(db, agent.id, 'scout', 1);
  if (scoutResult?.leveled) {
    logEvent(db, agent.id, 'skill', `${agent.name}'s scout skill reached level ${scoutResult.newLevel}!`, destination);
  }

  logEvent(db, agent.id, 'move', `${agent.name} retreated from ${currentLocation.name} to ${destLocation.name}.`, destination);
}

// ---------------------------------------------------------------------------
// Helper: doMove — move agent to a specific destination
// ---------------------------------------------------------------------------

function doMove(db: Database, agent: AgentWithStrategy, destinationId: string): void {
  const destLocation = db.prepare('SELECT * FROM locations WHERE id = ?').get(destinationId) as LocationRow | undefined;
  if (!destLocation) return;

  db.prepare(`UPDATE agents SET location_id = ?, updated_at = datetime('now') WHERE id = ?`).run(destinationId, agent.id);

  const scoutResult = grantSkillExp(db, agent.id, 'scout', 1);
  if (scoutResult?.leveled) {
    logEvent(db, agent.id, 'skill', `${agent.name}'s scout skill reached level ${scoutResult.newLevel}!`, destinationId);
  }

  logEvent(db, agent.id, 'move', `${agent.name} moved to ${destLocation.name}.`, destinationId);
}

// ---------------------------------------------------------------------------
// Helper: sellMaterials — sell all unequipped material items
// Returns true if anything was sold
// ---------------------------------------------------------------------------

function sellMaterials(db: Database, agent: AgentWithStrategy): boolean {
  const materials = db.prepare(`
    SELECT inv.id, inv.item_id, inv.quantity, it.name, it.sell_price
    FROM inventory inv
    JOIN items it ON inv.item_id = it.id
    WHERE inv.agent_id = ? AND inv.equipped = 0 AND it.type = 'material' AND inv.quantity > 0
  `).all(agent.id) as { id: string; item_id: string; quantity: number; name: string; sell_price: number }[];

  if (materials.length === 0) return false;

  const tradeBonus = getTradeBonus(db, agent.id);

  let totalGold = 0;
  const sellAll = db.transaction(() => {
    for (const mat of materials) {
      const boostedPrice = Math.floor(mat.sell_price * (1 + tradeBonus.sellBonus));
      const earned = boostedPrice * mat.quantity;
      totalGold += earned;

      db.prepare('DELETE FROM inventory WHERE id = ?').run(mat.id);
      logEvent(db, agent.id, 'shop', `${agent.name} sold ${mat.quantity}x ${mat.name} for ${earned} gold.`, agent.location_id);
    }
    db.prepare(`UPDATE agents SET gold = gold + ?, updated_at = datetime('now') WHERE id = ?`).run(totalGold, agent.id);
  });

  sellAll();

  const tradeSkillResult = grantSkillExp(db, agent.id, 'trade', 1);
  if (tradeSkillResult?.leveled) {
    logEvent(db, agent.id, 'skill', `${agent.name}'s trade skill reached level ${tradeSkillResult.newLevel}!`, agent.location_id);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Helper: buyPotionsIfNeeded — buy potions if stock < 3
// Returns true if anything was bought
// ---------------------------------------------------------------------------

function buyPotionsIfNeeded(db: Database, agent: AgentWithStrategy): boolean {
  // Count all potions currently in inventory
  const potionCount = (db.prepare(`
    SELECT COALESCE(SUM(inv.quantity), 0) as total
    FROM inventory inv
    JOIN items it ON inv.item_id = it.id
    WHERE inv.agent_id = ? AND it.type = 'potion'
  `).get(agent.id) as { total: number }).total;

  if (potionCount >= 3) return false;

  // Try to buy hp_potion_s from current shop
  const shopEntry = db.prepare(`
    SELECT si.id, si.price, si.stock
    FROM shop_inventory si
    WHERE si.location_id = ? AND si.item_id = 'hp_potion_s'
  `).get(agent.location_id) as { id: string; price: number; stock: number } | undefined;

  if (!shopEntry) return false;

  const tradeBonus = getTradeBonus(db, agent.id);
  const discountedPrice = Math.floor(shopEntry.price * (1 - tradeBonus.buyDiscount));

  // Buy up to 5 total
  const toBuy = Math.min(5 - potionCount, shopEntry.stock === -1 ? 5 : shopEntry.stock);
  if (toBuy <= 0) return false;

  const totalCost = discountedPrice * toBuy;
  if (agent.gold < totalCost) {
    // Try buying just 1 if affordable
    if (agent.gold < discountedPrice) return false;
    const canAfford = Math.floor(agent.gold / discountedPrice);
    const buyQty = Math.min(canAfford, toBuy);
    if (buyQty <= 0) return false;

    const actualCost = discountedPrice * buyQty;
    const buyTx = db.transaction(() => {
      db.prepare(`UPDATE agents SET gold = gold - ?, updated_at = datetime('now') WHERE id = ?`).run(actualCost, agent.id);
      addToInventory(db, agent.id, 'hp_potion_s', buyQty);
      if (shopEntry.stock !== -1) {
        db.prepare(`UPDATE shop_inventory SET stock = stock - ? WHERE id = ?`).run(buyQty, shopEntry.id);
      }
      logEvent(db, agent.id, 'shop', `${agent.name} bought ${buyQty}x Small HP Potion for ${actualCost} gold.`, agent.location_id);
    });
    buyTx();
  } else {
    const buyTx = db.transaction(() => {
      db.prepare(`UPDATE agents SET gold = gold - ?, updated_at = datetime('now') WHERE id = ?`).run(totalCost, agent.id);
      addToInventory(db, agent.id, 'hp_potion_s', toBuy);
      if (shopEntry.stock !== -1) {
        db.prepare(`UPDATE shop_inventory SET stock = stock - ? WHERE id = ?`).run(toBuy, shopEntry.id);
      }
      logEvent(db, agent.id, 'shop', `${agent.name} bought ${toBuy}x Small HP Potion for ${totalCost} gold.`, agent.location_id);
    });
    buyTx();
  }

  const tradeSkillResult = grantSkillExp(db, agent.id, 'trade', 1);
  if (tradeSkillResult?.leveled) {
    logEvent(db, agent.id, 'skill', `${agent.name}'s trade skill reached level ${tradeSkillResult.newLevel}!`, agent.location_id);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Helper: pickZone — choose a hunting zone to move to
// Returns a connected location_id or null
// ---------------------------------------------------------------------------

function pickZone(db: Database, agent: AgentWithStrategy, currentLocation: LocationRow): string | null {
  const connectedIds: string[] = JSON.parse(currentLocation.connected_to);
  if (connectedIds.length === 0) return null;

  const preferred = agent.preferred_zone ?? 'auto';

  // Level-based zone selection for 'auto' or specific preferred zone
  let targetZoneId: string | null = null;

  if (preferred !== 'auto') {
    // Check if preferred zone is directly connected
    if (connectedIds.includes(preferred)) {
      targetZoneId = preferred;
    } else {
      // Check if it is 1 hop away — find an intermediate location
      for (const connId of connectedIds) {
        const connLoc = db.prepare('SELECT connected_to FROM locations WHERE id = ?').get(connId) as { connected_to: string } | undefined;
        if (!connLoc) continue;
        const nextIds: string[] = JSON.parse(connLoc.connected_to);
        if (nextIds.includes(preferred)) {
          targetZoneId = connId; // Move toward preferred zone via this intermediate
          break;
        }
      }
    }
  }

  if (!targetZoneId) {
    // Auto zone selection based on level
    if (agent.level <= 2) {
      targetZoneId = connectedIds.includes('dark_forest') ? 'dark_forest' : connectedIds[0];
    } else if (agent.level <= 4) {
      const candidates = connectedIds.filter((id) => id === 'dark_forest' || id === 'mine_entrance');
      targetZoneId = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : connectedIds[0];
    } else {
      const highZones = ['mine_entrance', 'abandoned_graveyard'];
      const candidates = connectedIds.filter((id) => highZones.includes(id));
      targetZoneId = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : connectedIds[0];
    }
  }

  if (!targetZoneId) return null;

  // Validate the destination is not a town (we want hunting zones when leaving town)
  const destLoc = db.prepare('SELECT type FROM locations WHERE id = ?').get(targetZoneId) as { type: string } | undefined;
  if (!destLoc || destLoc.type === 'town') {
    // Fallback: pick first non-town connected location
    for (const id of connectedIds) {
      const loc = db.prepare('SELECT type FROM locations WHERE id = ?').get(id) as { type: string } | undefined;
      if (loc && loc.type !== 'town') return id;
    }
    return null;
  }

  return targetZoneId;
}

// ---------------------------------------------------------------------------
// Helper: pickTarget — choose a monster to attack
// ---------------------------------------------------------------------------

function pickTarget(monsters: MonsterRow[], agent: AgentWithStrategy): MonsterRow | null {
  if (monsters.length === 0) return null;

  const combatStyle = agent.combat_style ?? 'balanced';
  const targetPriority = agent.target_priority ?? 'weakest';

  // Filter by combat style
  let candidates = monsters;
  if (combatStyle === 'cautious') {
    candidates = monsters.filter((m) => m.level <= agent.level);
  } else if (combatStyle === 'balanced') {
    candidates = monsters.filter((m) => m.level <= agent.level + 2);
    if (candidates.length === 0) candidates = monsters; // Fallback to all
  }

  if (candidates.length === 0) return null;

  // Sort by priority
  const sorted = [...candidates];
  if (targetPriority === 'weakest') {
    sorted.sort((a, b) => a.level - b.level);
  } else if (targetPriority === 'strongest') {
    sorted.sort((a, b) => b.level - a.level);
  } else if (targetPriority === 'highest_exp') {
    sorted.sort((a, b) => b.exp_reward - a.exp_reward);
  } else if (targetPriority === 'highest_loot') {
    sorted.sort((a, b) => b.gold_reward_max - a.gold_reward_max);
  }

  return sorted[0] ?? null;
}

// ---------------------------------------------------------------------------
// Helper: doAttack — fight a monster, resolve outcome
// ---------------------------------------------------------------------------

function doAttack(db: Database, agent: AgentWithStrategy, monster: MonsterRow): void {
  const { effectiveAttack, effectiveDefense } = getEffectiveStats(db, agent);

  const combatResult = runCombat(
    effectiveAttack,
    effectiveDefense,
    agent.hp,
    {
      name: monster.name,
      hp: monster.current_hp,
      attack: monster.attack,
      defense: monster.defense,
    },
  );

  db.prepare(`UPDATE agents SET status = 'combat', updated_at = datetime('now') WHERE id = ?`).run(agent.id);

  const resolveTx = db.transaction(() => {
    if (combatResult.result === 'victory') {
      // Remove monster
      db.prepare('DELETE FROM active_monsters WHERE id = ?').run(monster.id);

      // Gold reward
      const goldGained = monster.gold_reward_min + Math.floor(Math.random() * (monster.gold_reward_max - monster.gold_reward_min + 1));

      // Exp + level-up
      const expGained = monster.exp_reward;
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

      // Roll loot
      const drops = rollLoot(monster.loot_table);
      for (const drop of drops) {
        addToInventory(db, agent.id, drop.item_id, drop.quantity);
      }

      // Update agent
      db.prepare(`
        UPDATE agents
        SET hp = ?, max_hp = ?, attack = ?, defense = ?, gold = gold + ?,
            exp = ?, exp_to_next = ?, level = ?, status = 'idle', updated_at = datetime('now')
        WHERE id = ?
      `).run(newHp, newMaxHp, newAttack, newDefense, goldGained, newExp, expToNext, newLevel, agent.id);

      logEvent(db, agent.id, 'combat', `${agent.name} defeated ${monster.name}. Gained ${expGained} EXP, ${goldGained} gold.`, agent.location_id);

      if (drops.length > 0) {
        const dropNames = drops.map((d) => d.item_id).join(', ');
        logEvent(db, agent.id, 'loot', `${agent.name} looted: ${dropNames}.`, agent.location_id);
      }

      if (leveled) {
        logEvent(db, agent.id, 'levelup', `${agent.name} reached level ${newLevel}!`, agent.location_id);
      }

      // Combat skill exp
      const skillResult = grantSkillExp(db, agent.id, 'combat', 1);
      if (skillResult?.leveled) {
        logEvent(db, agent.id, 'skill', `${agent.name}'s combat skill reached level ${skillResult.newLevel}!`, agent.location_id);
      }

      // Auto-equip if enabled
      if (agent.auto_equip) {
        autoEquip(db, agent);
      }
    } else {
      // Defeat
      const goldLost = Math.min(100, Math.max(1, Math.floor(agent.gold * 0.1)));
      const respawnHp = Math.floor(agent.max_hp * 0.5);

      db.prepare(`
        UPDATE agents
        SET hp = ?, gold = gold - ?, location_id = 'starter_village',
            status = 'idle', updated_at = datetime('now')
        WHERE id = ?
      `).run(respawnHp, goldLost, agent.id);

      logEvent(db, agent.id, 'death', `${agent.name} was slain by ${monster.name}. Lost ${goldLost} gold. Respawned at starter_village.`, agent.location_id);
    }
  });

  resolveTx();
}

// ---------------------------------------------------------------------------
// Helper: autoEquip — equip better gear from inventory
// ---------------------------------------------------------------------------

function autoEquip(db: Database, agent: AgentWithStrategy): void {
  // Get currently equipped weapon and armor
  const equippedItems = db.prepare(`
    SELECT inv.id, inv.item_id, it.type, it.attack_bonus, it.defense_bonus
    FROM inventory inv
    JOIN items it ON inv.item_id = it.id
    WHERE inv.agent_id = ? AND inv.equipped = 1
  `).all(agent.id) as { id: string; item_id: string; type: string; attack_bonus: number; defense_bonus: number }[];

  const equippedWeapon = equippedItems.find((i) => i.type === 'weapon');
  const equippedArmor = equippedItems.find((i) => i.type === 'armor');

  // Get all unequipped weapons and armor
  const unequipped = db.prepare(`
    SELECT inv.id, inv.item_id, it.type, it.attack_bonus, it.defense_bonus, it.name
    FROM inventory inv
    JOIN items it ON inv.item_id = it.id
    WHERE inv.agent_id = ? AND inv.equipped = 0
      AND it.type IN ('weapon', 'armor')
  `).all(agent.id) as { id: string; item_id: string; type: string; attack_bonus: number; defense_bonus: number; name: string }[];

  for (const candidate of unequipped) {
    if (candidate.type === 'weapon') {
      const currentBonus = equippedWeapon?.attack_bonus ?? 0;
      if (candidate.attack_bonus > currentBonus) {
        // Unequip old weapon
        if (equippedWeapon) {
          db.prepare('UPDATE inventory SET equipped = 0 WHERE id = ?').run(equippedWeapon.id);
        }
        db.prepare('UPDATE inventory SET equipped = 1 WHERE id = ?').run(candidate.id);
        logEvent(db, agent.id, 'loot', `${agent.name} auto-equipped ${candidate.name} (ATK +${candidate.attack_bonus}).`, agent.location_id);
      }
    } else if (candidate.type === 'armor') {
      const currentBonus = equippedArmor?.defense_bonus ?? 0;
      if (candidate.defense_bonus > currentBonus) {
        if (equippedArmor) {
          db.prepare('UPDATE inventory SET equipped = 0 WHERE id = ?').run(equippedArmor.id);
        }
        db.prepare('UPDATE inventory SET equipped = 1 WHERE id = ?').run(candidate.id);
        logEvent(db, agent.id, 'loot', `${agent.name} auto-equipped ${candidate.name} (DEF +${candidate.defense_bonus}).`, agent.location_id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: pickNextZone — pick a connected wild/dungeon location to explore
// ---------------------------------------------------------------------------

function pickNextZone(db: Database, agent: AgentWithStrategy, currentLocation: LocationRow): string | null {
  const connectedIds: string[] = JSON.parse(currentLocation.connected_to);
  if (connectedIds.length === 0) return null;

  const wildConnected = connectedIds.filter((id) => {
    const loc = db.prepare('SELECT type FROM locations WHERE id = ?').get(id) as { type: string } | undefined;
    return loc && loc.type !== 'town';
  });

  if (wildConnected.length === 0) return null;

  // Pick a random one
  return wildConnected[Math.floor(Math.random() * wildConnected.length)];
}

// ---------------------------------------------------------------------------
// Helper: acceptPvpChallenge — auto-resolve PVP
// ---------------------------------------------------------------------------

function acceptPvpChallenge(db: Database, agent: AgentWithStrategy, challenge: PvpChallengeRow): void {
  const challenger = db.prepare('SELECT * FROM agents WHERE id = ?').get(challenge.challenger_id) as AgentWithStrategy | undefined;
  if (!challenger) {
    db.prepare("UPDATE pvp_challenges SET status = 'declined' WHERE id = ?").run(challenge.id);
    return;
  }

  const challengerStats = getEffectiveStats(db, challenger);
  const targetStats = getEffectiveStats(db, agent);

  // Challenger attacks first
  const combatResult = runCombat(
    challengerStats.effectiveAttack,
    challengerStats.effectiveDefense,
    challenger.hp,
    {
      name: agent.name,
      hp: agent.hp,
      attack: targetStats.effectiveAttack,
      defense: targetStats.effectiveDefense,
    },
  );

  const pvpTx = db.transaction(() => {
    const challengerWon = combatResult.result === 'victory';
    const winner = challengerWon ? challenger : agent;
    const loser = challengerWon ? agent : challenger;

    // Loser HP = 1, winner gets 10% of loser gold (min 1, max 100)
    const goldTransfer = Math.min(100, Math.max(1, Math.floor(loser.gold * 0.1)));

    db.prepare(`UPDATE agents SET hp = 1, gold = gold - ?, updated_at = datetime('now') WHERE id = ?`).run(goldTransfer, loser.id);
    db.prepare(`UPDATE agents SET gold = gold + ?, updated_at = datetime('now') WHERE id = ?`).run(goldTransfer, winner.id);

    db.prepare(`
      UPDATE pvp_challenges
      SET status = 'completed', result = ?, resolved_at = datetime('now')
      WHERE id = ?
    `).run(challengerWon ? 'challenger_win' : 'target_win', challenge.id);

    logEvent(db, winner.id, 'pvp', `${winner.name} defeated ${loser.name} in PVP and gained ${goldTransfer} gold.`, agent.location_id);
    logEvent(db, loser.id, 'pvp', `${loser.name} was defeated by ${winner.name} in PVP and lost ${goldTransfer} gold.`, agent.location_id);
  });

  pvpTx();
}

// ---------------------------------------------------------------------------
// Core per-agent tick logic
// ---------------------------------------------------------------------------

function tickAgent(db: Database, agent: AgentWithStrategy): void {
  const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(agent.location_id) as LocationRow | undefined;
  if (!location) return;

  const hpPercent = Math.floor((agent.hp / agent.max_hp) * 100);

  // Step 1: Auto-potion if HP below potion_threshold
  if (agent.auto_potion && hpPercent < (agent.potion_threshold ?? 50)) {
    if (usePotion(db, agent)) return;
  }

  // Step 2: HP below retreat threshold — go to town or rest
  if (hpPercent < (agent.hp_retreat_threshold ?? 30)) {
    if (location.type === 'town') {
      doRest(db, agent);
      return;
    } else {
      moveTowardsTown(db, agent, location);
      return;
    }
  }

  // Step 3: In town — sell, buy, rest, then leave
  if (location.type === 'town') {
    if (agent.sell_materials) {
      if (sellMaterials(db, agent)) return;
    }

    if (agent.buy_potions_when_low) {
      if (buyPotionsIfNeeded(db, agent)) return;
    }

    if (agent.hp < agent.max_hp) {
      doRest(db, agent);
      return;
    }

    // Head out to hunt
    const zone = pickZone(db, agent, location);
    if (zone) {
      doMove(db, agent, zone);
    }
    return;
  }

  // Step 4: Handle incoming PVP challenges
  const pendingChallenges = db.prepare(`
    SELECT id, challenger_id FROM pvp_challenges
    WHERE target_id = ? AND status = 'pending'
    AND datetime(created_at, '+60 seconds') > datetime('now')
  `).all(agent.id) as PvpChallengeRow[];

  if (pendingChallenges.length > 0) {
    const challenge = pendingChallenges[0];
    if (agent.pvp_enabled && agent.pvp_aggression !== 'passive') {
      if (agent.pvp_aggression === 'aggressive' || hpPercent > 60) {
        acceptPvpChallenge(db, agent, challenge);
        return;
      }
    }
    // Decline
    db.prepare("UPDATE pvp_challenges SET status = 'declined' WHERE id = ?").run(challenge.id);
    return;
  }

  // Step 5: In wild — find monsters and fight
  const monsters = db.prepare(`
    SELECT am.id, am.template_id, am.location_id, am.current_hp,
           mt.name, mt.level, mt.attack, mt.defense, mt.hp as max_hp,
           mt.exp_reward, mt.gold_reward_min, mt.gold_reward_max, mt.loot_table
    FROM active_monsters am
    JOIN monster_templates mt ON am.template_id = mt.id
    WHERE am.location_id = ?
  `).all(agent.location_id) as MonsterRow[];

  if (monsters.length > 0) {
    const target = pickTarget(monsters, agent);
    if (target) {
      doAttack(db, agent, target);
      return;
    }
  }

  // Step 6: No monsters — explore or idle
  if (agent.explore_new_zones) {
    const nextZone = pickNextZone(db, agent, location);
    if (nextZone) {
      doMove(db, agent, nextZone);
      return;
    }
  }

  // Idle — nothing to do this tick
}

// ---------------------------------------------------------------------------
// Main export — called every 10 seconds from index.ts
// ---------------------------------------------------------------------------

export function runAutoTick(db: Database): void {
  const agents = db.prepare(`
    SELECT a.*, s.combat_style, s.hp_retreat_threshold, s.target_priority,
           s.auto_equip, s.auto_potion, s.potion_threshold, s.preferred_zone,
           s.pvp_enabled, s.pvp_aggression, s.sell_materials, s.buy_potions_when_low,
           s.explore_new_zones, s.trade_enabled
    FROM agents a
    LEFT JOIN agent_strategies s ON a.id = s.agent_id
    WHERE a.auto_play = 1 AND a.status != 'dead'
  `).all() as AgentWithStrategy[];

  for (const agent of agents) {
    try {
      tickAgent(db, agent);
    } catch (err) {
      console.error(`Auto-tick error for ${agent.name}:`, (err as Error).message);
    }
  }
}
