// Combat system — turn-based combat resolution

export interface CombatResult {
  result: 'victory' | 'defeat';
  combatLog: string[];
  agentHpAfter: number;
  monsterHpAfter: number;
}

export interface CombatStats {
  str?: number;
  agi?: number;
  spd?: number;
}

interface MonsterStats {
  name: string;
  hp: number;
  attack: number;
  defense: number;
  spd?: number; // monster SPD, defaults to 5
}

// Damage formula: max(1, (base_attack + STR * 2) - target_defense * 0.5) * random(0.8, 1.2)
// base_attack already includes weapon bonus from the caller
function calcDamage(attackerAttack: number, defenderDefense: number, str: number = 5, agi: number = 5): number {
  const base = (attackerAttack + str * 2) - defenderDefense * 0.5;
  const effective = Math.max(1, base);
  const variance = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
  let damage = Math.max(1, Math.round(effective * variance));

  // Crit check: if random() < agi * 0.02, damage *= 1.5
  if (Math.random() < agi * 0.02) {
    damage = Math.round(damage * 1.5);
  }

  return damage;
}

// Full combat: SPD determines who goes first. If agent SPD > monster SPD, agent attacks first (default).
// If monster SPD > agent SPD, monster attacks first.
export function runCombat(
  agentAttack: number,
  agentDefense: number,
  agentHp: number,
  monster: MonsterStats,
  agentStats?: CombatStats,
): CombatResult {
  const combatLog: string[] = [];
  let currentAgentHp = agentHp;
  let currentMonsterHp = monster.hp;
  let round = 1;

  const str = agentStats?.str ?? 5;
  const agi = agentStats?.agi ?? 5;
  const agentSpd = agentStats?.spd ?? 5;
  const monsterSpd = monster.spd ?? 5;

  const agentGoesFirst = agentSpd >= monsterSpd;

  while (currentAgentHp > 0 && currentMonsterHp > 0) {
    if (agentGoesFirst) {
      // Agent attacks first
      const playerDmg = calcDamage(agentAttack, monster.defense, str, agi);
      currentMonsterHp -= playerDmg;
      combatLog.push(
        `Round ${round}: You deal ${playerDmg} damage to ${monster.name}. (${monster.name} HP: ${Math.max(0, currentMonsterHp)})`,
      );

      if (currentMonsterHp <= 0) break;

      // Monster attacks
      const monsterDmg = calcDamage(monster.attack, agentDefense);
      currentAgentHp -= monsterDmg;
      combatLog.push(
        `Round ${round}: ${monster.name} deals ${monsterDmg} damage to you. (Your HP: ${Math.max(0, currentAgentHp)})`,
      );
    } else {
      // Monster attacks first
      const monsterDmg = calcDamage(monster.attack, agentDefense);
      currentAgentHp -= monsterDmg;
      combatLog.push(
        `Round ${round}: ${monster.name} attacks first and deals ${monsterDmg} damage to you. (Your HP: ${Math.max(0, currentAgentHp)})`,
      );

      if (currentAgentHp <= 0) break;

      // Agent attacks
      const playerDmg = calcDamage(agentAttack, monster.defense, str, agi);
      currentMonsterHp -= playerDmg;
      combatLog.push(
        `Round ${round}: You deal ${playerDmg} damage to ${monster.name}. (${monster.name} HP: ${Math.max(0, currentMonsterHp)})`,
      );
    }

    round++;
  }

  const result = currentMonsterHp <= 0 ? 'victory' : 'defeat';
  combatLog.push(result === 'victory' ? `Victory! You defeated ${monster.name}.` : `Defeat! You were slain by ${monster.name}.`);

  return {
    result,
    combatLog,
    agentHpAfter: Math.max(0, currentAgentHp),
    monsterHpAfter: Math.max(0, currentMonsterHp),
  };
}
