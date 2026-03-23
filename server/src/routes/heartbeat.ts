import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { Agent, ApiResponse } from '../types.js';

const router = Router();

router.post('/heartbeat', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const { status } = req.body as { status?: string };
    const db = getDb();

    if (status === 'online' || status === 'heartbeat') {
      db.prepare(`
        UPDATE agents SET
          auto_play = 1,
          last_heartbeat = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ? AND status != 'dead'
      `).run(agent.id);
    }

    if (status === 'offline') {
      db.prepare(`
        UPDATE agents SET
          auto_play = 0,
          last_heartbeat = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(agent.id);

      db.prepare(`
        INSERT INTO game_log (agent_id, event_type, message, location_id)
        VALUES (?, 'dev', ?, ?)
      `).run(agent.id, `${agent.name} 的開發者離線了。Agent 進入休眠模式。`, agent.location_id);
    }

    if (status === 'online') {
      db.prepare(`
        INSERT INTO game_log (agent_id, event_type, message, location_id)
        VALUES (?, 'dev', ?, ?)
      `).run(agent.id, `${agent.name} 的開發者上線了！Agent 甦醒開始行動。`, agent.location_id);
    }

    const response: ApiResponse = { ok: true, data: { status } };
    res.json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
