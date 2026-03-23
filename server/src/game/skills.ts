import { getDb } from '../db/schema.js';

// Returns buy discount and sell bonus percentages based on trade skill level
export function getTradeBonus(db: any, agentId: string): { buyDiscount: number; sellBonus: number } {
  const skill = db.prepare('SELECT level FROM agent_skills WHERE agent_id = ? AND skill_name = ?').get(agentId, 'trade');
  const level = skill?.level || 0;
  const tiers = Math.floor(level / 10);
  return { buyDiscount: tiers * 0.05, sellBonus: tiers * 0.05 };
}

// Returns attack bonus based on combat skill level (+2 ATK per 10 combat levels)
export function getCombatBonus(db: any, agentId: string): { attackBonus: number } {
  const skill = db.prepare('SELECT level FROM agent_skills WHERE agent_id = ? AND skill_name = ?').get(agentId, 'combat');
  const level = skill?.level || 0;
  const tiers = Math.floor(level / 10);
  return { attackBonus: tiers * 2 };
}

// Returns scout bonus — level >= 10 unlocks weakness visibility
export function getScoutBonus(db: any, agentId: string): { canSeeWeakness: boolean; level: number } {
  const skill = db.prepare('SELECT level FROM agent_skills WHERE agent_id = ? AND skill_name = ?').get(agentId, 'scout');
  const level = skill?.level || 0;
  return { canSeeWeakness: level >= 10, level };
}

// Add exp to a skill and handle level-ups
export function grantSkillExp(
  db: any,
  agentId: string,
  skillName: string,
  amount: number,
): { leveled: boolean; newLevel: number } | null {
  const skill = db.prepare('SELECT * FROM agent_skills WHERE agent_id = ? AND skill_name = ?').get(agentId, skillName);
  if (!skill) return null;

  let newExp = skill.exp + amount;
  let newLevel = skill.level;
  let leveled = false;
  let expToNext = 10 * (newLevel + 1);

  while (newExp >= expToNext) {
    newExp -= expToNext;
    newLevel++;
    leveled = true;
    expToNext = 10 * (newLevel + 1);
  }

  db.prepare('UPDATE agent_skills SET level = ?, exp = ? WHERE agent_id = ? AND skill_name = ?').run(
    newLevel,
    newExp,
    agentId,
    skillName,
  );
  return { leveled, newLevel };
}
