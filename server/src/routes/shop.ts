import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { getTradeBonus, grantSkillExp } from '../game/skills.js';
import type { Agent, Location, InventoryEntry, ApiResponse } from '../types.js';

const router = Router();

// Helper: log a game event
function logEvent(
  agentId: string,
  eventType: 'shop' | 'skill',
  message: string,
  locationId: string | null,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO game_log (agent_id, event_type, message, location_id)
    VALUES (?, ?, ?, ?)
  `).run(agentId, eventType, message, locationId);
}

// POST /api/shop — list, buy, or sell items at current town location
router.post('/shop', authMiddleware, (req: Request, res: Response) => {
  try {
    const agent = (req as any).agent as Agent;
    const { action } = req.body as { action?: string };

    if (!action) {
      const response: ApiResponse = { ok: false, error: 'action is required (list, buy, sell)' };
      res.status(400).json(response);
      return;
    }

    const db = getDb();

    // All shop actions require a town location
    const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(agent.location_id) as Location | undefined;
    if (!location || location.type !== 'town') {
      const response: ApiResponse = { ok: false, error: 'You must be in a town to use the shop.' };
      res.status(400).json(response);
      return;
    }

    // --- LIST ---
    if (action === 'list') {
      const items = db.prepare(`
        SELECT si.item_id, it.name, it.type, it.rarity, si.price, si.stock,
               it.description, it.attack_bonus, it.defense_bonus, it.hp_restore
        FROM shop_inventory si
        JOIN items it ON si.item_id = it.id
        WHERE si.location_id = ?
      `).all(agent.location_id) as {
        item_id: string;
        name: string;
        type: string;
        rarity: string;
        price: number;
        stock: number;
        description: string;
        attack_bonus: number;
        defense_bonus: number;
        hp_restore: number;
      }[];

      // Display stock: -1 means infinite, show as 99
      const displayItems = items.map((item) => ({
        ...item,
        stock: item.stock === -1 ? 99 : item.stock,
      }));

      const response: ApiResponse = { ok: true, data: { items: displayItems } };
      res.json(response);
      return;
    }

    // --- BUY ---
    if (action === 'buy') {
      const { item_id, quantity } = req.body as { item_id?: string; quantity?: number };

      if (!item_id || !quantity || quantity < 1) {
        const response: ApiResponse = { ok: false, error: 'item_id and quantity (>= 1) are required for buy' };
        res.status(400).json(response);
        return;
      }

      const shopEntry = db.prepare(`
        SELECT si.id, si.price, si.stock, it.name
        FROM shop_inventory si
        JOIN items it ON si.item_id = it.id
        WHERE si.location_id = ? AND si.item_id = ?
      `).get(agent.location_id, item_id) as { id: string; price: number; stock: number; name: string } | undefined;

      if (!shopEntry) {
        const response: ApiResponse = { ok: false, error: `Item '${item_id}' is not available in this shop.` };
        res.status(404).json(response);
        return;
      }

      // Check stock (stock -1 = infinite)
      if (shopEntry.stock !== -1 && shopEntry.stock < quantity) {
        const response: ApiResponse = {
          ok: false,
          error: `Not enough stock. Available: ${shopEntry.stock}`,
        };
        res.status(400).json(response);
        return;
      }

      // Apply trade skill discount
      const tradeBonus = getTradeBonus(db, agent.id);
      const discountedPrice = Math.floor(shopEntry.price * (1 - tradeBonus.buyDiscount));
      const totalCost = discountedPrice * quantity;

      if (agent.gold < totalCost) {
        const response: ApiResponse = {
          ok: false,
          error: `Not enough gold. Need ${totalCost}, have ${agent.gold}.`,
        };
        res.status(400).json(response);
        return;
      }

      const buyTransaction = db.transaction(() => {
        // Deduct gold
        db.prepare(`UPDATE agents SET gold = gold - ?, updated_at = datetime('now') WHERE id = ?`).run(
          totalCost,
          agent.id,
        );

        // Add item to inventory (upsert)
        const existing = db.prepare(
          `SELECT id, quantity FROM inventory WHERE agent_id = ? AND item_id = ?`,
        ).get(agent.id, item_id) as { id: string; quantity: number } | undefined;

        if (existing) {
          db.prepare(`UPDATE inventory SET quantity = quantity + ? WHERE id = ?`).run(quantity, existing.id);
        } else {
          db.prepare(`
            INSERT INTO inventory (id, agent_id, item_id, quantity, equipped)
            VALUES (?, ?, ?, ?, 0)
          `).run(crypto.randomUUID(), agent.id, item_id, quantity);
        }

        // Reduce stock if finite
        if (shopEntry.stock !== -1) {
          db.prepare(`UPDATE shop_inventory SET stock = stock - ? WHERE id = ?`).run(quantity, shopEntry.id);
        }

        logEvent(
          agent.id,
          'shop',
          `${agent.name} bought ${quantity}x ${shopEntry.name} for ${totalCost} gold.`,
          agent.location_id,
        );

        // Grant trade skill exp
        const skillResult = grantSkillExp(db, agent.id, 'trade', 1);
        if (skillResult?.leveled) {
          logEvent(
            agent.id,
            'skill',
            `${agent.name}'s trade skill reached level ${skillResult.newLevel}!`,
            agent.location_id,
          );
        }
      });

      buyTransaction();

      const response: ApiResponse = {
        ok: true,
        data: {
          message: `Bought ${quantity}x ${shopEntry.name} for ${totalCost} gold.`,
          total_cost: totalCost,
          discounted_price: discountedPrice,
        },
      };
      res.json(response);
      return;
    }

    // --- SELL ---
    if (action === 'sell') {
      const { item_id, quantity } = req.body as { item_id?: string; quantity?: number };

      if (!item_id || !quantity || quantity < 1) {
        const response: ApiResponse = { ok: false, error: 'item_id and quantity (>= 1) are required for sell' };
        res.status(400).json(response);
        return;
      }

      // Check agent has item and sufficient quantity
      const invEntry = db.prepare(`
        SELECT inv.id, inv.quantity, inv.equipped, it.name, it.sell_price
        FROM inventory inv
        JOIN items it ON inv.item_id = it.id
        WHERE inv.agent_id = ? AND inv.item_id = ?
      `).get(agent.id, item_id) as
        | (InventoryEntry & { name: string; sell_price: number })
        | undefined;

      if (!invEntry || invEntry.quantity < quantity) {
        const response: ApiResponse = {
          ok: false,
          error: `You don't have ${quantity}x '${item_id}' in your inventory.`,
        };
        res.status(400).json(response);
        return;
      }

      // Cannot sell equipped items
      if (invEntry.equipped === 1) {
        const response: ApiResponse = {
          ok: false,
          error: `Cannot sell equipped item '${invEntry.name}'. Unequip it first.`,
        };
        res.status(400).json(response);
        return;
      }

      // Apply trade skill sell bonus
      const tradeBonus = getTradeBonus(db, agent.id);
      const boostedSellPrice = Math.floor(invEntry.sell_price * (1 + tradeBonus.sellBonus));
      const totalGold = boostedSellPrice * quantity;

      const sellTransaction = db.transaction(() => {
        // Remove from inventory
        if (invEntry.quantity <= quantity) {
          db.prepare('DELETE FROM inventory WHERE id = ?').run(invEntry.id);
        } else {
          db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE id = ?').run(quantity, invEntry.id);
        }

        // Add gold
        db.prepare(`UPDATE agents SET gold = gold + ?, updated_at = datetime('now') WHERE id = ?`).run(
          totalGold,
          agent.id,
        );

        logEvent(
          agent.id,
          'shop',
          `${agent.name} sold ${quantity}x ${invEntry.name} for ${totalGold} gold.`,
          agent.location_id,
        );

        // Grant trade skill exp
        const skillResult = grantSkillExp(db, agent.id, 'trade', 1);
        if (skillResult?.leveled) {
          logEvent(
            agent.id,
            'skill',
            `${agent.name}'s trade skill reached level ${skillResult.newLevel}!`,
            agent.location_id,
          );
        }
      });

      sellTransaction();

      const response: ApiResponse = {
        ok: true,
        data: {
          message: `Sold ${quantity}x ${invEntry.name} for ${totalGold} gold.`,
          total_gold: totalGold,
          boosted_sell_price: boostedSellPrice,
        },
      };
      res.json(response);
      return;
    }

    // Unknown action
    const response: ApiResponse = { ok: false, error: `Unknown action '${action}'. Use: list, buy, sell` };
    res.status(400).json(response);
  } catch (err) {
    const response: ApiResponse = { ok: false, error: (err as Error).message };
    res.status(500).json(response);
  }
});

export default router;
