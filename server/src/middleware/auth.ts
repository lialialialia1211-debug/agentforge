import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/schema.js';
import type { Agent } from '../types.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ ok: false, error: 'Missing or invalid Authorization header' });
    return;
  }
  const token = authHeader.slice(7);
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE token = ?').get(token) as Agent | undefined;
  if (!agent) {
    res.status(401).json({ ok: false, error: 'Invalid token' });
    return;
  }
  (req as any).agent = agent;
  next();
}
