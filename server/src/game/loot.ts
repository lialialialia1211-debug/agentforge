// Loot generation — parse loot_table JSON and roll for drops

export interface LootEntry {
  item_id: string;
  chance: number;
  quantity: number;
}

export interface DroppedItem {
  item_id: string;
  quantity: number;
}

// Parse the monster template's loot_table JSON and roll each entry against drop_rate.
// Returns a list of items that actually dropped.
export function rollLoot(lootTableJson: string | null): DroppedItem[] {
  if (!lootTableJson) return [];

  let entries: LootEntry[];
  try {
    entries = JSON.parse(lootTableJson);
  } catch {
    return [];
  }

  if (!Array.isArray(entries)) return [];

  const drops: DroppedItem[] = [];
  for (const entry of entries) {
    const roll = Math.random();
    if (roll <= entry.chance) {
      drops.push({ item_id: entry.item_id, quantity: entry.quantity ?? 1 });
    }
  }
  return drops;
}
