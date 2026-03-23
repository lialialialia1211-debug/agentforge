import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { runCombat } from '../game/combat.js';
import type { Agent, ApiResponse, PvpChallenge } from '../types.js';

const router = Router();

// Helper: log a game event
function logEvent(
  agentId: string,
  eventType: 'pvp',
  message: string,
  locationId: string | null,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO game_log (agent_id, event_type, message, location_id)
    VALUES (?, ?, ?, ?)
  `).run(agentId, eventType, message, locationId);
}

// Helper: get effective attack/defense including equipped item bonuses
function getEffectiveStats(db: any, agentId: string): { attack: number; defense: number } {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as Agent;
  const equipped = db.prepare(`
    SELECT it.attack_bonus, it.defense_bonus FROM inventory inv
    JOIN items it ON inv.item_id = it.id
    WHERE inv.agent_id = ? AND inv.equipped = 1
  `).all(agentId) as { attack_bonus: number; defense_bonus: number }[];

  let atk = agent.attack;
  let def = agent.defense;
  for (const e of equipped) {
    atk += e.attack_bonus;
    def += e.defense_bonus;
  }
  return { attack: atk, defense: def };
}

// POST /api/pvp
router.post('/pvp', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const db = getDb();
    const { action } = req.body as { action?: string };

    if (!action) {
      const response: ApiResponse = { ok: false, error: 'action is required' };
      res.status(400).json(response);
      return;
    }

    // --- CHALLENGE ---
    if (action === 'challenge') {
      const { target_name } = req.body as { target_name?: string };

      if (!target_name) {
        const response: ApiResponse = { ok: false, error: 'target_name is required' };
        res.status(400).json(response);
        return;
      }

      if (agent.status === 'dead') {
        const response: ApiResponse = { ok: false, error: 'You are dead and cannot challenge anyone.' };
        res.status(400).json(response);
        return;
      }

      // Check PVP cooldown (5 minutes)
      const challenger = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id) as Agent & { last_pvp_at?: string | null };
      if (challenger.last_pvp_at) {
        const lastPvp = new Date(challenger.last_pvp_at + 'Z').getTime();
        const now = Date.now();
        const cooldownMs = 5 * 60 * 1000;
        if (now - lastPvp < cooldownMs) {
          const remainingSeconds = Math.ceil((cooldownMs - (now - lastPvp)) / 1000);
          const response: ApiResponse = { ok: false, error: `PVP cooldown active. Wait ${remainingSeconds} more seconds.` };
          res.status(400).json(response);
          return;
        }
      }

      // Find target
      const target = db.prepare('SELECT * FROM agents WHERE name = ?').get(target_name) as Agent | undefined;
      if (!target) {
        const response: ApiResponse = { ok: false, error: `Agent '${target_name}' not found.` };
        res.status(404).json(response);
        return;
      }

      if (target.id === agent.id) {
        const response: ApiResponse = { ok: false, error: 'You cannot challenge yourself.' };
        res.status(400).json(response);
        return;
      }

      if (target.status === 'dead') {
        const response: ApiResponse = { ok: false, error: `${target_name} is dead and cannot be challenged.` };
        res.status(400).json(response);
        return;
      }

      // Both must be at same location
      if (agent.location_id !== target.location_id) {
        const response: ApiResponse = { ok: false, error: `${target_name} is not at your current location.` };
        res.status(400).json(response);
        return;
      }

      // Check no pending challenge already exists between these two
      const existing = db.prepare(`
        SELECT id FROM pvp_challenges
        WHERE status = 'pending'
          AND ((challenger_id = ? AND target_id = ?) OR (challenger_id = ? AND target_id = ?))
      `).get(agent.id, target.id, target.id, agent.id) as { id: string } | undefined;

      if (existing) {
        const response: ApiResponse = { ok: false, error: 'A pending challenge already exists between you and this agent.' };
        res.status(400).json(response);
        return;
      }

      // Create challenge
      const challengeId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO pvp_challenges (id, challenger_id, target_id, status, result, created_at)
        VALUES (?, ?, ?, 'pending', NULL, datetime('now'))
      `).run(challengeId, agent.id, target.id);

      logEvent(agent.id, 'pvp', `${agent.name} challenged ${target.name} to a duel!`, agent.location_id);

      const response: ApiResponse = {
        ok: true,
        data: {
          challenge_id: challengeId,
          message: `You challenged ${target.name} to a duel!`,
          expires_in: 60,
        },
      };
      res.json(response);
      return;
    }

    // --- ACCEPT ---
    if (action === 'accept') {
      const { challenge_id } = req.body as { challenge_id?: string };

      if (!challenge_id) {
        const response: ApiResponse = { ok: false, error: 'challenge_id is required' };
        res.status(400).json(response);
        return;
      }

      const challenge = db.prepare('SELECT * FROM pvp_challenges WHERE id = ?').get(challenge_id) as PvpChallenge | undefined;
      if (!challenge) {
        const response: ApiResponse = { ok: false, error: 'Challenge not found.' };
        res.status(404).json(response);
        return;
      }

      // Must be the target
      if (challenge.target_id !== agent.id) {
        const response: ApiResponse = { ok: false, error: 'You are not the target of this challenge.' };
        res.status(403).json(response);
        return;
      }

      if (challenge.status !== 'pending') {
        const response: ApiResponse = { ok: false, error: `Challenge is already ${challenge.status}.` };
        res.status(400).json(response);
        return;
      }

      // Check expiry (60 seconds) — append 'Z' so JS treats SQLite UTC string as UTC
      const createdAt = new Date(challenge.created_at + 'Z').getTime();
      if (Date.now() - createdAt > 60 * 1000) {
        db.prepare(`UPDATE pvp_challenges SET status = 'expired' WHERE id = ?`).run(challenge_id);
        const response: ApiResponse = { ok: false, error: 'Challenge has expired.' };
        res.status(400).json(response);
        return;
      }

      const challenger = db.prepare('SELECT * FROM agents WHERE id = ?').get(challenge.challenger_id) as Agent | undefined;
      if (!challenger) {
        const response: ApiResponse = { ok: false, error: 'Challenger no longer exists.' };
        res.status(404).json(response);
        return;
      }

      // Both must still be at same location
      if (challenger.location_id !== agent.location_id) {
        const response: ApiResponse = { ok: false, error: 'Challenger has moved away. Cannot start duel.' };
        res.status(400).json(response);
        return;
      }

      // Get effective stats for both sides
      const challengerStats = getEffectiveStats(db, challenger.id);
      const targetStats = getEffectiveStats(db, agent.id);

      // Run PVP combat — challenger attacks first
      const combatResult = runCombat(
        challengerStats.attack,
        challengerStats.defense,
        challenger.hp,
        {
          name: agent.name,
          hp: agent.hp,
          attack: targetStats.attack,
          defense: targetStats.defense,
        },
      );

      // Determine winner/loser
      // runCombat returns 'victory' if first attacker (challenger) wins
      const challengerWon = combatResult.result === 'victory';
      const winner = challengerWon ? challenger : agent;
      const loser = challengerWon ? agent : challenger;

      const pvpResult = challengerWon ? 'challenger_win' : 'target_win';

      // Gold transfer: 10% of loser's gold, min 1, max 100
      const loserAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(loser.id) as Agent;
      const goldAmount = Math.min(100, Math.max(1, Math.floor(loserAgent.gold * 0.1)));

      const resolveTransaction = db.transaction(() => {
        // PVP death: loser HP set to 1, status stays 'idle'
        db.prepare(`
          UPDATE agents SET hp = 1, updated_at = datetime('now') WHERE id = ?
        `).run(loser.id);

        // Winner's HP after combat (from runCombat perspective, winner is the surviving side)
        const winnerHpAfter = challengerWon ? combatResult.agentHpAfter : combatResult.monsterHpAfter;
        db.prepare(`
          UPDATE agents SET hp = ?, updated_at = datetime('now') WHERE id = ?
        `).run(Math.max(1, winnerHpAfter), winner.id);

        // Gold transfer
        db.prepare(`UPDATE agents SET gold = gold - ?, last_pvp_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(goldAmount, loser.id);
        db.prepare(`UPDATE agents SET gold = gold + ?, last_pvp_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(goldAmount, winner.id);

        // Update challenge record
        db.prepare(`
          UPDATE pvp_challenges
          SET status = 'completed', result = ?, resolved_at = datetime('now')
          WHERE id = ?
        `).run(pvpResult, challenge_id);
      });

      resolveTransaction();

      const resultMessage = `${winner.name} defeated ${loser.name} in a duel! ${winner.name} gained ${goldAmount} gold.`;
      logEvent(challenger.id, 'pvp', resultMessage, challenger.location_id);
      logEvent(agent.id, 'pvp', resultMessage, agent.location_id);

      const response: ApiResponse = {
        ok: true,
        data: {
          result: pvpResult,
          combat_log: combatResult.combatLog,
          winner: winner.name,
          loser: loser.name,
          rewards: {
            gold_transferred: goldAmount,
          },
          hp_after: {
            [challenger.name]: challengerWon ? Math.max(1, combatResult.agentHpAfter) : 1,
            [agent.name]: challengerWon ? 1 : Math.max(1, combatResult.monsterHpAfter),
          },
        },
      };
      res.json(response);
      return;
    }

    // --- DECLINE ---
    if (action === 'decline') {
      const { challenge_id } = req.body as { challenge_id?: string };

      if (!challenge_id) {
        const response: ApiResponse = { ok: false, error: 'challenge_id is required' };
        res.status(400).json(response);
        return;
      }

      const challenge = db.prepare('SELECT * FROM pvp_challenges WHERE id = ?').get(challenge_id) as PvpChallenge | undefined;
      if (!challenge) {
        const response: ApiResponse = { ok: false, error: 'Challenge not found.' };
        res.status(404).json(response);
        return;
      }

      if (challenge.target_id !== agent.id) {
        const response: ApiResponse = { ok: false, error: 'You are not the target of this challenge.' };
        res.status(403).json(response);
        return;
      }

      if (challenge.status !== 'pending') {
        const response: ApiResponse = { ok: false, error: `Challenge is already ${challenge.status}.` };
        res.status(400).json(response);
        return;
      }

      db.prepare(`UPDATE pvp_challenges SET status = 'declined', resolved_at = datetime('now') WHERE id = ?`).run(challenge_id);

      const challenger = db.prepare('SELECT name FROM agents WHERE id = ?').get(challenge.challenger_id) as { name: string } | undefined;
      const challengerName = challenger?.name ?? 'Unknown';

      const response: ApiResponse = {
        ok: true,
        data: {
          message: `You declined the duel challenge from ${challengerName}.`,
        },
      };
      res.json(response);
      return;
    }

    // Unknown action
    const response: ApiResponse = { ok: false, error: `Unknown action '${action}'. Valid: challenge, accept, decline` };
    res.status(400).json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
