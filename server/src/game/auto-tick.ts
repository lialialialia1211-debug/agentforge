// Auto-tick engine — runs every 10 seconds and makes each active agent perform one action
import type { Database } from 'better-sqlite3';
import { runCombat } from './combat.js';
import { rollLoot } from './loot.js';
import { getCombatBonus, grantSkillExp, getTradeBonus } from './skills.js';
import { notifyTelegram } from '../telegram-notify.js';

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
  class: string;
  primary_language: string;
  str: number;
  int_stat: number;
  agi: number;
  vit: number;
  spd: number;
  cha: number;
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

interface ActiveBattleRow {
  id: string;
  agent_id: string;
  monster_id: string | null;
  opponent_id: string | null;
  agent_hp: number;
  monster_hp: number;
  monster_hp_start: number | null;
  monster_name: string;
  monster_level: number;
  monster_attack: number;
  monster_defense: number;
  rounds: string;
  status: string;
  location_id: string;
  created_at: string;
}

interface BattleRound {
  attacker: 'agent' | 'monster';
  damage: number;
  crit: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Log helper
// ---------------------------------------------------------------------------

const NOTIFY_ICONS: Record<string, string> = {
  death: '💀', levelup: '🎉', pvp: '🏆', skill: '📈', buff: '🛡', loot: '💎',
};

function logEvent(
  db: Database,
  agentId: string,
  eventType: 'combat' | 'death' | 'levelup' | 'move' | 'trade' | 'loot' | 'pvp' | 'shop' | 'skill' | 'dev' | 'buff',
  message: string,
  locationId: string | null,
): void {
  db.prepare(`
    INSERT INTO game_log (agent_id, event_type, message, location_id)
    VALUES (?, ?, ?, ?)
  `).run(agentId, eventType, message, locationId);

  // Telegram push for important events
  const notifyTypes = ['death', 'levelup', 'pvp', 'skill', 'buff'];
  const isRareLoot = eventType === 'loot' && /blue|purple|legendary/i.test(message);

  if (notifyTypes.includes(eventType) || isRareLoot) {
    const icon = NOTIFY_ICONS[eventType] || '📌';
    notifyTelegram(agentId, `${icon} ${message}`);
  }
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
  let effectiveAttack = agent.attack + bonusAttack + combatBonus.attackBonus;
  let effectiveDefense = agent.defense + bonusDefense;

  // Apply active buffs
  const activeBuffs = db.prepare(
    "SELECT buff_name, effect FROM agent_buffs WHERE agent_id = ? AND expires_at > datetime('now')"
  ).all(agent.id) as { buff_name: string; effect: string }[];

  for (const buff of activeBuffs) {
    const eff = JSON.parse(buff.effect);
    if (eff.stat === 'attack') {
      effectiveAttack = Math.floor(effectiveAttack * (1 + eff.modifier));
    } else if (eff.stat === 'defense') {
      effectiveDefense = Math.floor(effectiveDefense * (1 + eff.modifier));
    }
  }

  return { effectiveAttack, effectiveDefense };
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
      AND inv.item_id IN ('hotfix_elixir', 'debug_potion')
    ORDER BY it.hp_restore DESC
    LIMIT 1
  `).get(agent.id) as { id: string; quantity: number; item_id: string; hp_restore: number; name: string } | undefined;

  if (!potion || potion.hp_restore === 0) return false;

  const newHp = Math.min(agent.max_hp, agent.hp + potion.hp_restore);

  // Consume one unit
  if (potion.quantity <= 1) {
    db.prepare('DELETE FROM inventory WHERE id = ?').run(potion.id);
  } else {
    db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(potion.id);
  }

  db.prepare(`UPDATE agents SET hp = ?, updated_at = datetime('now') WHERE id = ?`).run(newHp, agent.id);
  logEvent(db, agent.id, 'combat', `${agent.name} 使用了 ${potion.name}，恢復 ${newHp - agent.hp} HP（HP: ${newHp}/${agent.max_hp}）`, agent.location_id);
  return true;
}

// ---------------------------------------------------------------------------
// Helper: doRest — restore to full HP (town only)
// ---------------------------------------------------------------------------

function doRest(db: Database, agent: AgentWithStrategy): void {
  db.prepare(`UPDATE agents SET hp = max_hp, status = 'idle', current_action = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify({ type: 'idle' }), agent.id);
  logEvent(db, agent.id, 'combat', `${agent.name} 休息完畢，HP 全滿。`, agent.location_id);
}

// ---------------------------------------------------------------------------
// Helper: moveTowardsTown — pick a connected location leading toward a town
// ---------------------------------------------------------------------------

function moveTowardsTown(db: Database, agent: AgentWithStrategy, currentLocation: LocationRow): void {
  const connectedIds: string[] = JSON.parse(currentLocation.connected_to);
  if (connectedIds.length === 0) return;

  // Priority: spawn_terminal > package_bazaar > any town
  let destination: string | null = null;

  if (connectedIds.includes('spawn_terminal')) {
    destination = 'spawn_terminal';
  } else if (connectedIds.includes('package_bazaar')) {
    destination = 'package_bazaar';
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

  db.prepare(`UPDATE agents SET previous_location_id = location_id WHERE id = ?`).run(agent.id);
  db.prepare(`UPDATE agents SET location_id = ?, current_action = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(destination, JSON.stringify({ type: 'moving', from: currentLocation.name, to: destLocation.name }), agent.id);

  const scoutResult = grantSkillExp(db, agent.id, 'scout', 1);
  if (scoutResult?.leveled) {
    logEvent(db, agent.id, 'skill', `${agent.name} 的偵察技能升到 ${scoutResult.newLevel} 級！`, destination);
  }

  logEvent(db, agent.id, 'move', `${agent.name} 從 ${currentLocation.name} 撤退到 ${destLocation.name}。`, destination);
}

// ---------------------------------------------------------------------------
// Helper: doMove — move agent to a specific destination
// ---------------------------------------------------------------------------

function doMove(db: Database, agent: AgentWithStrategy, destinationId: string): void {
  const currentLocation = db.prepare('SELECT * FROM locations WHERE id = ?').get(agent.location_id) as LocationRow | undefined;
  const destLocation = db.prepare('SELECT * FROM locations WHERE id = ?').get(destinationId) as LocationRow | undefined;
  if (!destLocation) return;

  db.prepare(`UPDATE agents SET previous_location_id = location_id WHERE id = ?`).run(agent.id);
  db.prepare(`UPDATE agents SET location_id = ?, current_action = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(destinationId, JSON.stringify({ type: 'moving', from: currentLocation?.name ?? agent.location_id, to: destLocation.name }), agent.id);

  // Consume energy for moving to wild areas
  if (destLocation.type === 'wild' || destLocation.type === 'dungeon') {
    consumeEnergy(db, agent, 1, 'explore');
  }

  const scoutResult = grantSkillExp(db, agent.id, 'scout', 1);
  if (scoutResult?.leveled) {
    logEvent(db, agent.id, 'skill', `${agent.name} 的偵察技能升到 ${scoutResult.newLevel} 級！`, destinationId);
  }

  logEvent(db, agent.id, 'move', `${agent.name} 移動到 ${destLocation.name}。`, destinationId);
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
      logEvent(db, agent.id, 'shop', `${agent.name} 賣出 ${mat.quantity} 個 ${mat.name}，獲得 ${earned} 金幣。`, agent.location_id);
    }
    db.prepare(`UPDATE agents SET gold = gold + ?, updated_at = datetime('now') WHERE id = ?`).run(totalGold, agent.id);
  });

  sellAll();

  const tradeSkillResult = grantSkillExp(db, agent.id, 'trade', 1);
  if (tradeSkillResult?.leveled) {
    logEvent(db, agent.id, 'skill', `${agent.name} 的交易技能升到 ${tradeSkillResult.newLevel} 級！`, agent.location_id);
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

  // Try to buy debug_potion from current shop
  const shopEntry = db.prepare(`
    SELECT si.id, si.price, si.stock
    FROM shop_inventory si
    WHERE si.location_id = ? AND si.item_id = 'debug_potion'
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
      addToInventory(db, agent.id, 'debug_potion', buyQty);
      if (shopEntry.stock !== -1) {
        db.prepare(`UPDATE shop_inventory SET stock = stock - ? WHERE id = ?`).run(buyQty, shopEntry.id);
      }
      logEvent(db, agent.id, 'shop', `${agent.name} 買了 ${buyQty} 個 Debug Potion，花費 ${actualCost} 金幣。`, agent.location_id);
    });
    buyTx();
  } else {
    const buyTx = db.transaction(() => {
      db.prepare(`UPDATE agents SET gold = gold - ?, updated_at = datetime('now') WHERE id = ?`).run(totalCost, agent.id);
      addToInventory(db, agent.id, 'debug_potion', toBuy);
      if (shopEntry.stock !== -1) {
        db.prepare(`UPDATE shop_inventory SET stock = stock - ? WHERE id = ?`).run(toBuy, shopEntry.id);
      }
      logEvent(db, agent.id, 'shop', `${agent.name} 買了 ${toBuy} 個 Debug Potion，花費 ${totalCost} 金幣。`, agent.location_id);
    });
    buyTx();
  }

  const tradeSkillResult = grantSkillExp(db, agent.id, 'trade', 1);
  if (tradeSkillResult?.leveled) {
    logEvent(db, agent.id, 'skill', `${agent.name} 的交易技能升到 ${tradeSkillResult.newLevel} 級！`, agent.location_id);
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
      targetZoneId = connectedIds.includes('npm_commons') ? 'npm_commons' : connectedIds[0];
    } else if (agent.level <= 4) {
      const candidates = connectedIds.filter((id) => id === 'npm_commons' || id === 'pypi_shores');
      targetZoneId = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : connectedIds[0];
    } else if (agent.level <= 6) {
      const candidates = connectedIds.filter((id) => id === 'pypi_shores' || id === 'crates_peaks');
      targetZoneId = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : connectedIds[0];
    } else {
      const highZones = ['crates_peaks', 'maven_depths'];
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
// Helper: calcSingleHit — calculate damage for one hit
// ---------------------------------------------------------------------------

function calcSingleHit(attackPower: number, defense: number): number {
  const base = attackPower - defense * 0.5;
  const effective = Math.max(1, base);
  const variance = 0.8 + Math.random() * 0.4;
  return Math.max(1, Math.round(effective * variance));
}

// ---------------------------------------------------------------------------
// Helper: resolveVictory — end battle with agent winning
// ---------------------------------------------------------------------------

function resolveVictory(
  db: Database,
  agent: AgentWithStrategy,
  battle: ActiveBattleRow,
  rounds: BattleRound[],
  newAgentHp: number,
): void {
  // Look up the monster template for rewards (we need exp/gold from template)
  const monsterTemplate = battle.monster_id
    ? db.prepare(`
        SELECT mt.exp_reward, mt.gold_reward_min, mt.gold_reward_max, mt.loot_table
        FROM active_monsters am
        JOIN monster_templates mt ON am.template_id = mt.id
        WHERE am.id = ?
      `).get(battle.monster_id) as { exp_reward: number; gold_reward_min: number; gold_reward_max: number; loot_table: string | null } | undefined
    : undefined;

  const expGained = monsterTemplate?.exp_reward ?? 5;
  const goldGained = monsterTemplate
    ? monsterTemplate.gold_reward_min + Math.floor(Math.random() * (monsterTemplate.gold_reward_max - monsterTemplate.gold_reward_min + 1))
    : 3;
  const lootTable = monsterTemplate?.loot_table ?? null;

  const victoryTx = db.transaction(() => {
    // Mark battle as resolved (keep for 15s so client can see final state)
    db.prepare("UPDATE active_battles SET status = 'resolved', rounds = ? WHERE id = ?")
      .run(JSON.stringify(rounds), battle.id);

    // Delete active monster
    if (battle.monster_id) {
      db.prepare('DELETE FROM active_monsters WHERE id = ?').run(battle.monster_id);
    }

    // Roll loot
    const drops = rollLoot(lootTable);
    for (const drop of drops) {
      addToInventory(db, agent.id, drop.item_id, drop.quantity);
    }

    // Compute level-up
    let newExp = agent.exp + expGained;
    let newLevel = agent.level;
    let newMaxHp = agent.max_hp;
    let newAttack = agent.attack;
    let newDefense = agent.defense;
    let finalHp = newAgentHp;
    let leveled = false;
    let expToNext = agent.exp_to_next;

    while (newExp >= expToNext) {
      newExp -= expToNext;
      newLevel++;
      newMaxHp += 10 + (agent.vit || 5);
      newAttack += 3;
      newDefense += 2;
      finalHp = newMaxHp; // Full HP on level up
      leveled = true;
      expToNext = Math.floor(100 * newLevel * 1.5);
    }

    // Update agent
    const newMaxEnergy = 100 + newLevel * 10;
    db.prepare(`
      UPDATE agents
      SET hp = ?, max_hp = ?, attack = ?, defense = ?, gold = gold + ?,
          exp = ?, exp_to_next = ?, level = ?, max_energy = ?, status = 'idle',
          current_action = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      finalHp, newMaxHp, newAttack, newDefense, goldGained,
      newExp, expToNext, newLevel, newMaxEnergy,
      JSON.stringify({ type: 'idle' }),
      agent.id
    );

    logEvent(db, agent.id, 'combat', `${agent.name} 擊敗了 ${battle.monster_name}，獲得 ${expGained} EXP、${goldGained} 金幣。`, battle.location_id);

    if (drops.length > 0) {
      const dropNames = drops.map((d) => d.item_id).join(', ');
      logEvent(db, agent.id, 'loot', `${agent.name} 拾取了 ${dropNames}。`, battle.location_id);
    }

    if (leveled) {
      logEvent(db, agent.id, 'levelup', `${agent.name} 升級到 Lv.${newLevel}！`, battle.location_id);
    }
  });

  victoryTx();

  // Combat skill exp (outside transaction since it has its own logic)
  const skillResult = grantSkillExp(db, agent.id, 'combat', 1);
  if (skillResult?.leveled) {
    logEvent(db, agent.id, 'skill', `${agent.name} 的戰鬥技能升到 ${skillResult.newLevel} 級！`, battle.location_id);
  }

  // Auto-equip if enabled
  if (agent.auto_equip) {
    autoEquip(db, agent);
  }
}

// ---------------------------------------------------------------------------
// Helper: resolveDefeat — end battle with agent losing
// ---------------------------------------------------------------------------

function resolveDefeat(
  db: Database,
  agent: AgentWithStrategy,
  battle: ActiveBattleRow,
): void {
  const goldLost = Math.min(100, Math.max(1, Math.floor(agent.gold * 0.1)));
  const respawnHp = Math.floor(agent.max_hp * 0.5);

  const defeatTx = db.transaction(() => {
    // Mark battle as resolved (keep for 15s so client can see final state)
    db.prepare("UPDATE active_battles SET status = 'resolved' WHERE id = ?").run(battle.id);

    db.prepare(`
      UPDATE agents
      SET hp = ?, gold = gold - ?, location_id = 'spawn_terminal',
          status = 'idle', current_action = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(respawnHp, goldLost, JSON.stringify({ type: 'idle' }), agent.id);

    logEvent(db, agent.id, 'death', `${agent.name} 被 ${battle.monster_name} 擊殺，損失 ${goldLost} 金幣，在 The Terminal 重生。`, battle.location_id);
  });

  defeatTx();
}

// ---------------------------------------------------------------------------
// Helper: tickBattle — execute ONE round of an active battle
// ---------------------------------------------------------------------------

function tickBattle(db: Database, agent: AgentWithStrategy, battle: ActiveBattleRow): void {
  const rounds: BattleRound[] = JSON.parse(battle.rounds);

  // Get effective stats (with buffs)
  const { effectiveAttack, effectiveDefense } = getEffectiveStats(db, agent);

  // Agent attacks monster
  let agentDmg = calcSingleHit(effectiveAttack + (agent.str || 5) * 2, battle.monster_defense);

  // Check crit
  const agi = agent.agi || 5;
  let isCrit = false;
  if (Math.random() < agi * 0.02) {
    isCrit = true;
    agentDmg = Math.floor(agentDmg * 1.5);
  }

  const newMonsterHp = Math.max(0, battle.monster_hp - agentDmg);

  rounds.push({
    attacker: 'agent',
    damage: agentDmg,
    crit: isCrit,
    message: `${agent.name} 攻擊 ${battle.monster_name}，造成 ${agentDmg} 傷害${isCrit ? '（暴擊！）' : ''}！`,
  });

  // Check if monster died
  if (newMonsterHp <= 0) {
    resolveVictory(db, agent, battle, rounds, agent.hp);
    return;
  }

  // Monster attacks agent
  const monsterDmg = calcSingleHit(battle.monster_attack, effectiveDefense);
  const newAgentHp = Math.max(0, agent.hp - monsterDmg);

  rounds.push({
    attacker: 'monster',
    damage: monsterDmg,
    crit: false,
    message: `${battle.monster_name} 反擊，造成 ${monsterDmg} 傷害。`,
  });

  // Check if agent died
  if (newAgentHp <= 0) {
    resolveDefeat(db, agent, battle);
    return;
  }

  // Battle continues — update state
  db.prepare(`UPDATE active_battles SET agent_hp = ?, monster_hp = ?, rounds = ? WHERE id = ?`)
    .run(newAgentHp, newMonsterHp, JSON.stringify(rounds), battle.id);
  db.prepare(`UPDATE agents SET hp = ?, status = 'combat', current_action = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(newAgentHp, JSON.stringify({
      type: 'attacking',
      target: battle.monster_name,
      target_hp: newMonsterHp,
      target_max_hp: battle.monster_hp_start ?? battle.monster_hp,
    }), agent.id);
}

// ---------------------------------------------------------------------------
// Helper: startBattle — create a new active_battle and execute first round
// ---------------------------------------------------------------------------

function startBattle(db: Database, agent: AgentWithStrategy, monster: MonsterRow): void {
  const battleId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO active_battles (id, agent_id, monster_id, agent_hp, monster_hp, monster_hp_start, monster_name, monster_level, monster_attack, monster_defense, rounds, status, location_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'in_progress', ?)
  `).run(battleId, agent.id, monster.id, agent.hp, monster.current_hp, monster.current_hp, monster.name, monster.level, monster.attack, monster.defense, agent.location_id);

  db.prepare(`UPDATE agents SET status = 'combat', current_action = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify({ type: 'attacking', target: monster.name, target_hp: monster.current_hp, target_max_hp: monster.current_hp }), agent.id);

  // Move agent near the monster for visual proximity
  const monsterPos = db.prepare('SELECT room_x, room_y FROM active_monsters WHERE id = ?').get(monster.id) as { room_x: number | null; room_y: number | null } | undefined;
  if (monsterPos && monsterPos.room_x != null && monsterPos.room_y != null) {
    // Position agent 30px to the left of the monster
    const agentX = monsterPos.room_x - 30;
    const agentY = monsterPos.room_y;
    const direction = 'right';
    db.prepare('UPDATE agents SET room_x = ?, room_y = ?, direction = ? WHERE id = ?')
      .run(Math.round(agentX * 10) / 10, Math.round(agentY * 10) / 10, direction, agent.id);
  }

  // Snapshot combat positions into the battle record
  const agentPos = db.prepare('SELECT room_x, room_y FROM agents WHERE id = ?').get(agent.id) as { room_x: number; room_y: number };
  const combatAgentX = agentPos?.room_x ?? 400;
  const combatAgentY = agentPos?.room_y ?? 250;
  const combatMonsterX = monsterPos?.room_x ?? 400;
  const combatMonsterY = monsterPos?.room_y ?? 250;
  db.prepare('UPDATE active_battles SET combat_agent_x = ?, combat_agent_y = ?, combat_monster_x = ?, combat_monster_y = ? WHERE id = ?')
    .run(combatAgentX, combatAgentY, combatMonsterX, combatMonsterY, battleId);

  logEvent(db, agent.id, 'combat', `${agent.name} 向 ${monster.name} 發起攻擊！`, agent.location_id);

  // Execute first round immediately so client can see damage
  const freshBattle = db.prepare("SELECT * FROM active_battles WHERE id = ?").get(battleId) as ActiveBattleRow;
  if (freshBattle) {
    tickBattle(db, agent, freshBattle);
  }
}

// ---------------------------------------------------------------------------
// Helper: doAttack (legacy) — kept for compatibility with manual API calls
// Resolves entire combat instantly (used by /api/attack route)
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
    { str: agent.str, agi: agent.agi, spd: agent.spd },
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
        newMaxHp += 10 + (agent.vit || 5);
        newAttack += 3;
        newDefense += 2;
        newHp = newMaxHp;
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

      logEvent(db, agent.id, 'combat', `${agent.name} 擊敗了 ${monster.name}，獲得 ${expGained} EXP、${goldGained} 金幣。`, agent.location_id);

      if (drops.length > 0) {
        const dropNames = drops.map((d) => d.item_id).join(', ');
        logEvent(db, agent.id, 'loot', `${agent.name} 拾取了 ${dropNames}。`, agent.location_id);
      }

      if (leveled) {
        logEvent(db, agent.id, 'levelup', `${agent.name} 升級到 Lv.${newLevel}！`, agent.location_id);
      }

      // Combat skill exp
      const skillResult = grantSkillExp(db, agent.id, 'combat', 1);
      if (skillResult?.leveled) {
        logEvent(db, agent.id, 'skill', `${agent.name} 的戰鬥技能升到 ${skillResult.newLevel} 級！`, agent.location_id);
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
        SET hp = ?, gold = gold - ?, location_id = 'spawn_terminal',
            status = 'idle', updated_at = datetime('now')
        WHERE id = ?
      `).run(respawnHp, goldLost, agent.id);

      logEvent(db, agent.id, 'death', `${agent.name} 被 ${monster.name} 擊殺，損失 ${goldLost} 金幣，在 The Terminal 重生。`, agent.location_id);
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
        logEvent(db, agent.id, 'loot', `${agent.name} 自動裝備了 ${candidate.name}（ATK +${candidate.attack_bonus}）。`, agent.location_id);
      }
    } else if (candidate.type === 'armor') {
      const currentBonus = equippedArmor?.defense_bonus ?? 0;
      if (candidate.defense_bonus > currentBonus) {
        if (equippedArmor) {
          db.prepare('UPDATE inventory SET equipped = 0 WHERE id = ?').run(equippedArmor.id);
        }
        db.prepare('UPDATE inventory SET equipped = 1 WHERE id = ?').run(candidate.id);
        logEvent(db, agent.id, 'loot', `${agent.name} 自動裝備了 ${candidate.name}（DEF +${candidate.defense_bonus}）。`, agent.location_id);
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
    { str: challenger.str, agi: challenger.agi, spd: challenger.spd },
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

    logEvent(db, winner.id, 'pvp', `${winner.name} 在 PVP 中擊敗了 ${loser.name}，獲得 ${goldTransfer} 金幣。`, agent.location_id);
    logEvent(db, loser.id, 'pvp', `${loser.name} 在 PVP 中被 ${winner.name} 擊敗，損失 ${goldTransfer} 金幣。`, agent.location_id);
  });

  pvpTx();
}

// ---------------------------------------------------------------------------
// Helper: consumeEnergy — deduct energy and log it
// ---------------------------------------------------------------------------

function consumeEnergy(db: Database, agent: AgentWithStrategy, amount: number, source: string): void {
  const current = (db.prepare('SELECT energy FROM agents WHERE id = ?').get(agent.id) as any)?.energy ?? 0;
  const newEnergy = Math.max(0, current - amount);
  db.prepare('UPDATE agents SET energy = ? WHERE id = ?').run(newEnergy, agent.id);
  db.prepare(`INSERT INTO energy_log (agent_id, type, source, amount, balance_after) VALUES (?, 'spend', ?, ?, ?)`)
    .run(agent.id, source, -amount, newEnergy);
}

// ---------------------------------------------------------------------------
// Core per-agent tick logic
// ---------------------------------------------------------------------------

function tickAgent(db: Database, agent: AgentWithStrategy): void {
  // Check for Chaos debuff — 20% chance to waste this turn
  const chaosDebuff = db.prepare(
    "SELECT id FROM agent_buffs WHERE agent_id = ? AND buff_name = 'Chaos' AND expires_at > datetime('now')"
  ).get(agent.id) as { id: string } | undefined;
  if (chaosDebuff && Math.random() < 0.2) {
    logEvent(db, agent.id, 'buff', `${agent.name} 被 Chaos 干擾，本回合浪費了！`, agent.location_id);
    return;
  }

  const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(agent.location_id) as LocationRow | undefined;
  if (!location) return;

  // === Energy System: check energy ===
  const currentEnergy = (db.prepare('SELECT energy FROM agents WHERE id = ?').get(agent.id) as any)?.energy ?? 0;

  if (currentEnergy <= 0) {
    // No energy — can only rest in town or retreat to town
    if (location.type === 'town') {
      if (agent.hp < agent.max_hp) {
        doRest(db, agent);
        return;
      }
      // Idle in town waiting for energy
      db.prepare(`UPDATE agents SET current_action = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(JSON.stringify({ type: 'idle', reason: 'no_energy' }), agent.id);
      logEvent(db, agent.id, 'move', `${agent.name} 能量耗盡，在 ${location.name} 等待能量補充...`, agent.location_id);
      return;
    }
    // Not in town — retreat to nearest town (free)
    moveTowardsTown(db, agent, location);
    logEvent(db, agent.id, 'move', `${agent.name} 能量耗盡，緊急返回安全區！`, agent.location_id);
    return;
  }

  // Check for active battle FIRST — one round per tick
  const activeBattle = db.prepare(
    "SELECT * FROM active_battles WHERE agent_id = ? AND status = 'in_progress'"
  ).get(agent.id) as ActiveBattleRow | undefined;

  if (activeBattle) {
    tickBattle(db, agent, activeBattle);
    return; // Battle takes priority — one round per tick
  }

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

  // Step 5: In wild — find monsters and start a battle
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
      consumeEnergy(db, agent, 1, 'combat');
      startBattle(db, agent, target);
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
  db.prepare(`UPDATE agents SET current_action = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify({ type: 'idle' }), agent.id);
}

// ---------------------------------------------------------------------------
// Entity position updates for Room View
// ---------------------------------------------------------------------------

function updateEntityPositions(db: Database): void {
  const AGENT_SPEED = 20;
  const MONSTER_SPEED = 8;
  const ROOM_WIDTH = 800;
  const ROOM_HEIGHT = 450;
  const ROOM_MARGIN = 40;

  // Update agent positions - idle agents wander randomly
  const agents = db.prepare(`
    SELECT id, room_x, room_y, direction, status, current_action FROM agents
    WHERE auto_play = 1 AND status != 'dead'
  `).all() as any[];

  for (const agent of agents) {
    let x = agent.room_x ?? 400;
    let y = agent.room_y ?? 250;

    if (agent.status === 'combat') {
      // In combat: stay put (minor jitter for visual effect)
      continue;
    }

    // Skip wander if agent has a recent battle (resolved or in_progress)
    const recentBattle = db.prepare(
      "SELECT id FROM active_battles WHERE agent_id = ? AND status IN ('in_progress', 'resolved')"
    ).get(agent.id);
    if (recentBattle) continue;

    // 30% chance to pick a new wander destination each tick
    if (Math.random() < 0.3) {
      const targetX = 120 + Math.random() * 560;  // 120-680
      const targetY = 130 + Math.random() * 210;  // 130-340
      const dx = targetX - x;
      const dy = targetY - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > AGENT_SPEED) {
        x += (dx / dist) * AGENT_SPEED;
        y += (dy / dist) * AGENT_SPEED;
      } else {
        x = targetX;
        y = targetY;
      }

      const direction = dx > 0 ? 'right' : 'left';
      db.prepare('UPDATE agents SET room_x = ?, room_y = ?, direction = ? WHERE id = ?')
        .run(Math.round(x * 10) / 10, Math.round(y * 10) / 10, direction, agent.id);
    }
  }

  // Update monster positions - wandering monsters move slowly
  const monsters = db.prepare(`
    SELECT am.id, am.room_x, am.room_y, am.direction, am.wander_target_x, am.wander_target_y
    FROM active_monsters am
  `).all() as any[];

  for (const monster of monsters) {
    let x = monster.room_x;
    let y = monster.room_y;

    // Initialize or reset position if null or out of bounds
    if (x == null || y == null || x < 150 || x > 650 || y < 150 || y > 320) {
      x = 150 + Math.random() * 500;  // 150-650
      y = 150 + Math.random() * 170;  // 150-320
      db.prepare('UPDATE active_monsters SET room_x = ?, room_y = ?, wander_target_x = NULL, wander_target_y = NULL WHERE id = ?')
        .run(Math.round(x * 10) / 10, Math.round(y * 10) / 10, monster.id);
      continue;
    }

    let targetX = monster.wander_target_x;
    let targetY = monster.wander_target_y;

    // Pick new wander target if none or reached
    if (targetX == null || targetY == null || (Math.abs(x - targetX) < MONSTER_SPEED && Math.abs(y - targetY) < MONSTER_SPEED)) {
      // Wander within a small radius of current position
      targetX = Math.max(150, Math.min(650, x + (Math.random() - 0.5) * 120));
      targetY = Math.max(150, Math.min(320, y + (Math.random() - 0.5) * 80));
    }

    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > MONSTER_SPEED) {
      x += (dx / dist) * MONSTER_SPEED;
      y += (dy / dist) * MONSTER_SPEED;
    } else {
      x = targetX;
      y = targetY;
    }

    // Clamp to room bounds
    x = Math.max(150, Math.min(650, x));
    y = Math.max(150, Math.min(320, y));

    const direction = dx > 0 ? 'right' : 'left';
    db.prepare('UPDATE active_monsters SET room_x = ?, room_y = ?, direction = ?, wander_target_x = ?, wander_target_y = ? WHERE id = ?')
      .run(Math.round(x * 10) / 10, Math.round(y * 10) / 10, direction, Math.round(targetX * 10) / 10, Math.round(targetY * 10) / 10, monster.id);
  }
}

// ---------------------------------------------------------------------------
// Main export — called every 10 seconds from index.ts
// ---------------------------------------------------------------------------

export function runAutoTick(db: Database): void {
  // Clean expired buffs
  db.prepare("DELETE FROM agent_buffs WHERE expires_at < datetime('now')").run();

  // Clean stale battles from previous server sessions (older than 5 minutes)
  db.prepare("DELETE FROM active_battles WHERE status = 'in_progress' AND datetime(created_at, '+5 minutes') < datetime('now')").run();

  // Clean up resolved battles older than 15 seconds
  db.prepare("DELETE FROM active_battles WHERE status = 'resolved' AND datetime(created_at, '+15 seconds') < datetime('now')").run();

  const agents = db.prepare(`
    SELECT a.id, a.name, a.level, a.exp, a.exp_to_next, a.hp, a.max_hp, a.attack, a.defense,
           a.gold, a.location_id, a.status, a.auto_play,
           a.class, a.primary_language, a.str, a.int_stat, a.agi, a.vit, a.spd, a.cha,
           s.combat_style, s.hp_retreat_threshold, s.target_priority,
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

  // Update entity positions for Room View
  updateEntityPositions(db);
}

// Export doAttack for use by action routes (instant combat for manual API calls)
export { doAttack };
