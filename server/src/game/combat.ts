// Combat system — turn-based combat resolution

export interface CombatResult {
  result: 'victory' | 'defeat';
  combatLog: string[];
  agentHpAfter: number;
  monsterHpAfter: number;
}

interface MonsterStats {
  name: string;
  hp: number;
  attack: number;
  defense: number;
}

// Damage formula: max(1, attacker_attack - defender_defense * 0.5) * random(0.8, 1.2)
function calcDamage(attackerAttack: number, defenderDefense: number): number {
  const base = attackerAttack - defenderDefense * 0.5;
  const effective = Math.max(1, base);
  const variance = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
  return Math.max(1, Math.round(effective * variance));
}

// Full combat: player attacks first, then monster, repeat until one side reaches 0 HP.
export function runCombat(
  agentAttack: number,
  agentDefense: number,
  agentHp: number,
  monster: MonsterStats,
): CombatResult {
  const combatLog: string[] = [];
  let currentAgentHp = agentHp;
  let currentMonsterHp = monster.hp;
  let round = 1;

  while (currentAgentHp > 0 && currentMonsterHp > 0) {
    // Player attacks first
    const playerDmg = calcDamage(agentAttack, monster.defense);
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
