import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { Agent, ApiResponse, Trade, InventoryEntry } from '../types.js';

const router = Router();

// Helper: log a game event
function logEvent(
  agentId: string,
  eventType: 'trade',
  message: string,
  locationId: string | null,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO game_log (agent_id, event_type, message, location_id)
    VALUES (?, ?, ?, ?)
  `).run(agentId, eventType, message, locationId);
}

// Helper: remove unequipped items from inventory; returns false if not enough stock
function removeFromInventory(db: any, agentId: string, itemId: string, quantity: number): boolean {
  const inv = db.prepare(
    'SELECT * FROM inventory WHERE agent_id = ? AND item_id = ? AND equipped = 0',
  ).get(agentId, itemId) as InventoryEntry | undefined;

  if (!inv || inv.quantity < quantity) return false;

  if (inv.quantity === quantity) {
    db.prepare('DELETE FROM inventory WHERE id = ?').run(inv.id);
  } else {
    db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE id = ?').run(quantity, inv.id);
  }
  return true;
}

// Helper: add items to inventory (upsert)
function addToInventory(db: any, agentId: string, itemId: string, quantity: number): void {
  const existing = db.prepare(
    'SELECT * FROM inventory WHERE agent_id = ? AND item_id = ?',
  ).get(agentId, itemId) as InventoryEntry | undefined;

  if (existing) {
    db.prepare('UPDATE inventory SET quantity = quantity + ? WHERE id = ?').run(quantity, existing.id);
  } else {
    db.prepare(
      'INSERT INTO inventory (id, agent_id, item_id, quantity, equipped) VALUES (?, ?, ?, ?, 0)',
    ).run(crypto.randomUUID(), agentId, itemId, quantity);
  }
}

// Helper: validate an agent has all the listed items (unequipped) and gold
interface TradeItem {
  item_id: string;
  quantity: number;
}

function validateHasItemsAndGold(
  db: any,
  agentId: string,
  items: TradeItem[],
  gold: number,
): string | null {
  const agent = db.prepare('SELECT gold FROM agents WHERE id = ?').get(agentId) as { gold: number } | undefined;
  if (!agent) return 'Agent not found.';

  if (agent.gold < gold) {
    return `Insufficient gold. Has ${agent.gold}, needs ${gold}.`;
  }

  for (const tradeItem of items) {
    const inv = db.prepare(
      'SELECT quantity FROM inventory WHERE agent_id = ? AND item_id = ? AND equipped = 0',
    ).get(agentId, tradeItem.item_id) as { quantity: number } | undefined;

    if (!inv || inv.quantity < tradeItem.quantity) {
      return `Insufficient quantity of item '${tradeItem.item_id}'. Has ${inv?.quantity ?? 0}, needs ${tradeItem.quantity}.`;
    }
  }
  return null;
}

// POST /api/trade
router.post('/trade', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const db = getDb();
    const { action } = req.body as { action?: string };

    if (!action) {
      const response: ApiResponse = { ok: false, error: 'action is required' };
      res.status(400).json(response);
      return;
    }

    // --- OFFER ---
    if (action === 'offer') {
      const {
        target_name,
        offer_items = [],
        offer_gold = 0,
        request_items = [],
        request_gold = 0,
      } = req.body as {
        target_name?: string;
        offer_items?: TradeItem[];
        offer_gold?: number;
        request_items?: TradeItem[];
        request_gold?: number;
      };

      if (!target_name) {
        const response: ApiResponse = { ok: false, error: 'target_name is required' };
        res.status(400).json(response);
        return;
      }

      const target = db.prepare('SELECT * FROM agents WHERE name = ?').get(target_name) as Agent | undefined;
      if (!target) {
        const response: ApiResponse = { ok: false, error: `Agent '${target_name}' not found.` };
        res.status(404).json(response);
        return;
      }

      if (target.id === agent.id) {
        const response: ApiResponse = { ok: false, error: 'You cannot trade with yourself.' };
        res.status(400).json(response);
        return;
      }

      // Both must be at same location
      if (agent.location_id !== target.location_id) {
        const response: ApiResponse = { ok: false, error: `${target_name} is not at your current location.` };
        res.status(400).json(response);
        return;
      }

      // Validate offerer has offered items and gold
      const validationError = validateHasItemsAndGold(db, agent.id, offer_items, offer_gold);
      if (validationError) {
        const response: ApiResponse = { ok: false, error: `Validation failed: ${validationError}` };
        res.status(400).json(response);
        return;
      }

      // Create trade record
      const tradeId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO trades (id, offerer_id, target_id, offer_items, offer_gold, request_items, request_gold, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
      `).run(
        tradeId,
        agent.id,
        target.id,
        JSON.stringify(offer_items),
        offer_gold,
        JSON.stringify(request_items),
        request_gold,
      );

      logEvent(agent.id, 'trade', `${agent.name} sent a trade offer to ${target.name}.`, agent.location_id);

      const response: ApiResponse = {
        ok: true,
        data: {
          trade_id: tradeId,
          message: `Trade offer sent to ${target.name}.`,
          expires_in: 120,
        },
      };
      res.json(response);
      return;
    }

    // --- ACCEPT ---
    if (action === 'accept') {
      const { trade_id } = req.body as { trade_id?: string };

      if (!trade_id) {
        const response: ApiResponse = { ok: false, error: 'trade_id is required' };
        res.status(400).json(response);
        return;
      }

      const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(trade_id) as Trade | undefined;
      if (!trade) {
        const response: ApiResponse = { ok: false, error: 'Trade not found.' };
        res.status(404).json(response);
        return;
      }

      // Must be the target
      if (trade.target_id !== agent.id) {
        const response: ApiResponse = { ok: false, error: 'You are not the target of this trade.' };
        res.status(403).json(response);
        return;
      }

      if (trade.status !== 'pending') {
        const response: ApiResponse = { ok: false, error: `Trade is already ${trade.status}.` };
        res.status(400).json(response);
        return;
      }

      // Check expiry (120 seconds)
      const createdAt = new Date(trade.created_at + 'Z').getTime();
      if (Date.now() - createdAt > 120 * 1000) {
        db.prepare(`UPDATE trades SET status = 'expired' WHERE id = ?`).run(trade_id);
        const response: ApiResponse = { ok: false, error: 'Trade offer has expired.' };
        res.status(400).json(response);
        return;
      }

      const offerer = db.prepare('SELECT * FROM agents WHERE id = ?').get(trade.offerer_id) as Agent | undefined;
      if (!offerer) {
        const response: ApiResponse = { ok: false, error: 'Offerer no longer exists.' };
        res.status(404).json(response);
        return;
      }

      // Both must still be at same location
      if (offerer.location_id !== agent.location_id) {
        const response: ApiResponse = { ok: false, error: 'Offerer has moved away. Cannot complete trade.' };
        res.status(400).json(response);
        return;
      }

      const offerItems: TradeItem[] = JSON.parse(trade.offer_items);
      const requestItems: TradeItem[] = JSON.parse(trade.request_items);

      // Re-validate both sides still have everything
      const offererValidation = validateHasItemsAndGold(db, offerer.id, offerItems, trade.offer_gold);
      if (offererValidation) {
        const response: ApiResponse = { ok: false, error: `Offerer can no longer fulfill the trade: ${offererValidation}` };
        res.status(400).json(response);
        return;
      }

      const targetValidation = validateHasItemsAndGold(db, agent.id, requestItems, trade.request_gold);
      if (targetValidation) {
        const response: ApiResponse = { ok: false, error: `You can no longer fulfill the trade: ${targetValidation}` };
        res.status(400).json(response);
        return;
      }

      // Execute swap in a transaction
      const executeSwap = db.transaction(() => {
        // Move offered items: offerer → target
        for (const item of offerItems) {
          removeFromInventory(db, offerer.id, item.item_id, item.quantity);
          addToInventory(db, agent.id, item.item_id, item.quantity);
        }

        // Move requested items: target → offerer
        for (const item of requestItems) {
          removeFromInventory(db, agent.id, item.item_id, item.quantity);
          addToInventory(db, offerer.id, item.item_id, item.quantity);
        }

        // Transfer gold both ways
        if (trade.offer_gold > 0) {
          db.prepare(`UPDATE agents SET gold = gold - ?, updated_at = datetime('now') WHERE id = ?`).run(trade.offer_gold, offerer.id);
          db.prepare(`UPDATE agents SET gold = gold + ?, updated_at = datetime('now') WHERE id = ?`).run(trade.offer_gold, agent.id);
        }
        if (trade.request_gold > 0) {
          db.prepare(`UPDATE agents SET gold = gold - ?, updated_at = datetime('now') WHERE id = ?`).run(trade.request_gold, agent.id);
          db.prepare(`UPDATE agents SET gold = gold + ?, updated_at = datetime('now') WHERE id = ?`).run(trade.request_gold, offerer.id);
        }

        // Mark trade as accepted
        db.prepare(`
          UPDATE trades SET status = 'accepted', resolved_at = datetime('now') WHERE id = ?
        `).run(trade_id);
      });

      executeSwap();

      const tradeMessage = `${offerer.name} and ${agent.name} completed a trade.`;
      logEvent(offerer.id, 'trade', tradeMessage, offerer.location_id);
      logEvent(agent.id, 'trade', tradeMessage, agent.location_id);

      const response: ApiResponse = {
        ok: true,
        data: {
          message: 'Trade completed successfully.',
          exchanged: {
            you_received: {
              items: offerItems,
              gold: trade.offer_gold,
            },
            you_gave: {
              items: requestItems,
              gold: trade.request_gold,
            },
          },
        },
      };
      res.json(response);
      return;
    }

    // --- DECLINE ---
    if (action === 'decline') {
      const { trade_id } = req.body as { trade_id?: string };

      if (!trade_id) {
        const response: ApiResponse = { ok: false, error: 'trade_id is required' };
        res.status(400).json(response);
        return;
      }

      const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(trade_id) as Trade | undefined;
      if (!trade) {
        const response: ApiResponse = { ok: false, error: 'Trade not found.' };
        res.status(404).json(response);
        return;
      }

      if (trade.target_id !== agent.id) {
        const response: ApiResponse = { ok: false, error: 'You are not the target of this trade.' };
        res.status(403).json(response);
        return;
      }

      if (trade.status !== 'pending') {
        const response: ApiResponse = { ok: false, error: `Trade is already ${trade.status}.` };
        res.status(400).json(response);
        return;
      }

      db.prepare(`UPDATE trades SET status = 'declined', resolved_at = datetime('now') WHERE id = ?`).run(trade_id);

      const offerer = db.prepare('SELECT name FROM agents WHERE id = ?').get(trade.offerer_id) as { name: string } | undefined;
      const offererName = offerer?.name ?? 'Unknown';

      const response: ApiResponse = {
        ok: true,
        data: {
          message: `You declined the trade offer from ${offererName}.`,
        },
      };
      res.json(response);
      return;
    }

    // Unknown action
    const response: ApiResponse = { ok: false, error: `Unknown action '${action}'. Valid: offer, accept, decline` };
    res.status(400).json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
