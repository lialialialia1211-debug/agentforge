export interface Agent {
  id: string;
  name: string;
  token: string;
  level: number;
  exp: number;
  exp_to_next: number;
  hp: number;
  max_hp: number;
  attack: number;
  defense: number;
  gold: number;
  location_id: string;
  status: 'idle' | 'combat' | 'traveling' | 'dead';
  created_at: string;
  updated_at: string;
  last_heartbeat: string | null;
  class: string;
  primary_language: string;
  str: number;
  int_stat: number;
  agi: number;
  vit: number;
  spd: number;
  cha: number;
}

export interface Location {
  id: string;
  name: string;
  description: string;
  type: 'town' | 'wild' | 'dungeon';
  level_min: number;
  level_max: number;
  connected_to: string; // JSON array
}

export interface MonsterTemplate {
  id: string;
  name: string;
  level: number;
  hp: number;
  attack: number;
  defense: number;
  exp_reward: number;
  gold_reward_min: number;
  gold_reward_max: number;
  loot_table: string | null; // JSON
  location_ids: string; // JSON array
}

export interface ActiveMonster {
  id: string;
  template_id: string;
  location_id: string;
  current_hp: number;
  spawned_at: string;
}

export interface Item {
  id: string;
  name: string;
  type: 'weapon' | 'armor' | 'potion' | 'material';
  rarity: 'white' | 'green' | 'blue' | 'purple';
  attack_bonus: number;
  defense_bonus: number;
  hp_restore: number;
  description: string;
  sell_price: number;
}

export interface InventoryEntry {
  id: string;
  agent_id: string;
  item_id: string;
  quantity: number;
  equipped: number; // 0 or 1
}

export interface GameLogEntry {
  id: number;
  timestamp: string;
  agent_id: string | null;
  event_type: 'combat' | 'death' | 'levelup' | 'move' | 'trade' | 'loot' | 'pvp' | 'shop' | 'skill' | 'strategy' | 'dev' | 'buff';
  message: string;
  location_id: string | null;
}

export interface ShopEntry {
  id: string;
  location_id: string;
  item_id: string;
  price: number;
  stock: number;
}

export interface PvpChallenge {
  id: string;
  challenger_id: string;
  target_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'completed';
  result: 'challenger_win' | 'target_win' | null;
  created_at: string;
  resolved_at: string | null;
}

export interface Trade {
  id: string;
  offerer_id: string;
  target_id: string;
  offer_items: string;
  offer_gold: number;
  request_items: string;
  request_gold: number;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  created_at: string;
  resolved_at: string | null;
}

export interface AgentSkill {
  agent_id: string;
  skill_name: 'combat' | 'scout' | 'trade';
  level: number;
  exp: number;
}

export interface AgentStrategy {
  agent_id: string;
  combat_style: 'aggressive' | 'balanced' | 'cautious';
  hp_retreat_threshold: number;
  target_priority: 'weakest' | 'strongest' | 'highest_exp' | 'highest_loot';
  auto_equip: number;
  auto_potion: number;
  potion_threshold: number;
  preferred_zone: string;
  pvp_enabled: number;
  pvp_aggression: 'aggressive' | 'defensive' | 'passive';
  trade_enabled: number;
  sell_materials: number;
  buy_potions_when_low: number;
  explore_new_zones: number;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
