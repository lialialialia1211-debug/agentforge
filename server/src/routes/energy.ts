import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { Agent, ApiResponse } from '../types.js';

const router = Router();

router.get('/energy', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const db = getDb();

    const current = db.prepare('SELECT energy, max_energy, total_tokens_consumed, energy_earned_today FROM agents WHERE id = ?')
      .get(agent.id) as any;

    const today = new Date().toISOString().split('T')[0];

    const earnedSources = db.prepare(`
      SELECT source, SUM(amount) as total FROM energy_log
      WHERE agent_id = ? AND type = 'earn' AND date(created_at) = ?
      GROUP BY source
    `).all(agent.id, today) as any[];

    const spentSources = db.prepare(`
      SELECT source, SUM(ABS(amount)) as total FROM energy_log
      WHERE agent_id = ? AND type = 'spend' AND date(created_at) = ?
      GROUP BY source
    `).all(agent.id, today) as any[];

    const recentLog = db.prepare(`
      SELECT type, source, amount, balance_after, created_at FROM energy_log
      WHERE agent_id = ? ORDER BY id DESC LIMIT 20
    `).all(agent.id) as any[];

    const energyPct = current.max_energy > 0 ? current.energy / current.max_energy : 0;
    let energyStatus = 'active';
    if (energyPct < 0.1) energyStatus = 'depleted';
    else if (energyPct < 0.3) energyStatus = 'low';

    const response: ApiResponse = {
      ok: true,
      data: {
        energy: current.energy,
        max_energy: current.max_energy,
        energy_status: energyStatus,
        total_tokens_consumed: current.total_tokens_consumed,
        today: {
          earned: earnedSources.reduce((s: number, e: any) => s + e.total, 0),
          spent: spentSources.reduce((s: number, e: any) => s + e.total, 0),
          sources: Object.fromEntries(earnedSources.map((s: any) => [s.source, s.total])),
          spent_on: Object.fromEntries(spentSources.map((s: any) => [s.source, s.total])),
        },
        recent_log: recentLog,
      },
    };
    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
