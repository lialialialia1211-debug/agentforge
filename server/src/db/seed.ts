import type { Database } from 'better-sqlite3';

// Seed all static game data into the database
export function seedDatabase(db: Database): void {
  seedLocations(db);
  seedMonsterTemplates(db);
  seedItems(db);
  seedShopInventory(db);
  seedAgentSkills(db);
  seedAgentStrategies(db);
}

function seedLocations(db: Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO locations (id, name, description, type, level_min, level_max, connected_to)
    VALUES (@id, @name, @description, @type, @level_min, @level_max, @connected_to)
  `);

  const locations = [
    {
      id: 'starter_village',
      name: '新手村',
      description: '寧靜的小村莊，是所有冒險者旅程的起點。村裡有旅館可以休息恢復體力。',
      type: 'town',
      level_min: 1,
      level_max: 3,
      connected_to: JSON.stringify(['dark_forest', 'town_market']),
    },
    {
      id: 'town_market',
      name: '城鎮市集',
      description: '熱鬧的市集，商人們在這裡買賣各種物資。',
      type: 'town',
      level_min: 1,
      level_max: 99,
      connected_to: JSON.stringify(['starter_village', 'abandoned_graveyard']),
    },
    {
      id: 'dark_forest',
      name: '幽暗森林',
      description: '陰暗的森林，樹木遮天蔽日。隱約能聽到野獸的嚎叫。',
      type: 'wild',
      level_min: 1,
      level_max: 3,
      connected_to: JSON.stringify(['starter_village', 'mine_entrance']),
    },
    {
      id: 'mine_entrance',
      name: '礦坑入口',
      description: '廢棄的礦坑入口，空氣中瀰漫著潮濕和鐵鏽的味道。',
      type: 'wild',
      level_min: 3,
      level_max: 5,
      connected_to: JSON.stringify(['dark_forest']),
    },
    {
      id: 'abandoned_graveyard',
      name: '荒廢墓地',
      description: '長滿雜草的古老墓地，不死生物在此遊蕩。',
      type: 'wild',
      level_min: 5,
      level_max: 8,
      connected_to: JSON.stringify(['town_market']),
    },
  ];

  const insertMany = db.transaction(() => {
    for (const loc of locations) {
      insert.run(loc);
    }
  });
  insertMany();
}

function seedMonsterTemplates(db: Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO monster_templates
      (id, name, level, hp, attack, defense, exp_reward, gold_reward_min, gold_reward_max, loot_table, location_ids)
    VALUES
      (@id, @name, @level, @hp, @attack, @defense, @exp_reward, @gold_reward_min, @gold_reward_max, @loot_table, @location_ids)
  `);

  const monsters = [
    {
      id: 'slime',
      name: 'Slime',
      level: 1,
      hp: 30,
      attack: 5,
      defense: 2,
      exp_reward: 15,
      gold_reward_min: 3,
      gold_reward_max: 8,
      loot_table: JSON.stringify([]),
      location_ids: JSON.stringify(['dark_forest']),
    },
    {
      id: 'wolf',
      name: 'Wolf',
      level: 2,
      hp: 50,
      attack: 12,
      defense: 4,
      exp_reward: 30,
      gold_reward_min: 5,
      gold_reward_max: 15,
      loot_table: JSON.stringify([{ item_id: 'wolf_fang', chance: 0.3, quantity: 1 }]),
      location_ids: JSON.stringify(['dark_forest']),
    },
    {
      id: 'goblin',
      name: 'Goblin',
      level: 3,
      hp: 70,
      attack: 15,
      defense: 6,
      exp_reward: 50,
      gold_reward_min: 10,
      gold_reward_max: 25,
      loot_table: JSON.stringify([{ item_id: 'goblin_ear', chance: 0.25, quantity: 1 }]),
      location_ids: JSON.stringify(['dark_forest', 'mine_entrance']),
    },
    {
      id: 'cave_bat',
      name: 'Cave Bat',
      level: 3,
      hp: 40,
      attack: 18,
      defense: 3,
      exp_reward: 35,
      gold_reward_min: 5,
      gold_reward_max: 12,
      loot_table: JSON.stringify([]),
      location_ids: JSON.stringify(['mine_entrance']),
    },
    {
      id: 'skeleton',
      name: 'Skeleton',
      level: 5,
      hp: 100,
      attack: 22,
      defense: 10,
      exp_reward: 80,
      gold_reward_min: 15,
      gold_reward_max: 40,
      loot_table: JSON.stringify([{ item_id: 'bone_fragment', chance: 0.35, quantity: 1 }]),
      location_ids: JSON.stringify(['abandoned_graveyard']),
    },
    {
      id: 'zombie',
      name: 'Zombie',
      level: 6,
      hp: 130,
      attack: 18,
      defense: 15,
      exp_reward: 100,
      gold_reward_min: 20,
      gold_reward_max: 50,
      loot_table: JSON.stringify([{ item_id: 'bone_fragment', chance: 0.2, quantity: 1 }]),
      location_ids: JSON.stringify(['abandoned_graveyard']),
    },
  ];

  const insertMany = db.transaction(() => {
    for (const m of monsters) {
      insert.run(m);
    }
  });
  insertMany();
}

function seedItems(db: Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO items
      (id, name, type, rarity, attack_bonus, defense_bonus, hp_restore, description, sell_price)
    VALUES
      (@id, @name, @type, @rarity, @attack_bonus, @defense_bonus, @hp_restore, @description, @sell_price)
  `);

  const items = [
    {
      id: 'wooden_sword',
      name: 'Wooden Sword',
      type: 'weapon',
      rarity: 'white',
      attack_bonus: 3,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'A basic wooden sword for beginners.',
      sell_price: 5,
    },
    {
      id: 'iron_sword',
      name: 'Iron Sword',
      type: 'weapon',
      rarity: 'green',
      attack_bonus: 8,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'A sturdy iron sword with decent cutting power.',
      sell_price: 25,
    },
    {
      id: 'steel_sword',
      name: 'Steel Sword',
      type: 'weapon',
      rarity: 'blue',
      attack_bonus: 15,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'A finely crafted steel sword.',
      sell_price: 80,
    },
    {
      id: 'leather_armor',
      name: 'Leather Armor',
      type: 'armor',
      rarity: 'white',
      attack_bonus: 0,
      defense_bonus: 3,
      hp_restore: 0,
      description: 'Basic leather armor providing minimal protection.',
      sell_price: 8,
    },
    {
      id: 'chain_mail',
      name: 'Chain Mail',
      type: 'armor',
      rarity: 'green',
      attack_bonus: 0,
      defense_bonus: 8,
      hp_restore: 0,
      description: 'Interlocking metal rings offer solid defense.',
      sell_price: 30,
    },
    {
      id: 'hp_potion_s',
      name: 'Small HP Potion',
      type: 'potion',
      rarity: 'white',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 30,
      description: 'Restores 30 HP.',
      sell_price: 5,
    },
    {
      id: 'hp_potion_m',
      name: 'Medium HP Potion',
      type: 'potion',
      rarity: 'green',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 60,
      description: 'Restores 60 HP.',
      sell_price: 15,
    },
    {
      id: 'wolf_fang',
      name: 'Wolf Fang',
      type: 'material',
      rarity: 'white',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'A sharp fang from a wolf.',
      sell_price: 3,
    },
    {
      id: 'goblin_ear',
      name: 'Goblin Ear',
      type: 'material',
      rarity: 'white',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'A pointed ear severed from a goblin.',
      sell_price: 5,
    },
    {
      id: 'bone_fragment',
      name: 'Bone Fragment',
      type: 'material',
      rarity: 'white',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'A piece of bone from an undead creature.',
      sell_price: 4,
    },
  ];

  const insertMany = db.transaction(() => {
    for (const item of items) {
      insert.run(item);
    }
  });
  insertMany();
}

function seedShopInventory(db: Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO shop_inventory (id, location_id, item_id, price, stock)
    VALUES (@id, @location_id, @item_id, @price, @stock)
  `);

  const entries = [
    { id: 'shop_sv_hp_potion_s',  location_id: 'starter_village', item_id: 'hp_potion_s',   price: 10,  stock: -1 },
    { id: 'shop_sv_wooden_sword', location_id: 'starter_village', item_id: 'wooden_sword',   price: 15,  stock: -1 },
    { id: 'shop_sv_leather_armor',location_id: 'starter_village', item_id: 'leather_armor',  price: 20,  stock: -1 },
    { id: 'shop_tm_hp_potion_s',  location_id: 'town_market',     item_id: 'hp_potion_s',    price: 10,  stock: -1 },
    { id: 'shop_tm_hp_potion_m',  location_id: 'town_market',     item_id: 'hp_potion_m',    price: 30,  stock: -1 },
    { id: 'shop_tm_iron_sword',   location_id: 'town_market',     item_id: 'iron_sword',     price: 50,  stock: -1 },
    { id: 'shop_tm_chain_mail',   location_id: 'town_market',     item_id: 'chain_mail',     price: 60,  stock: -1 },
    { id: 'shop_tm_steel_sword',  location_id: 'town_market',     item_id: 'steel_sword',    price: 150, stock: -1 },
  ];

  const insertMany = db.transaction(() => {
    for (const entry of entries) {
      insert.run(entry);
    }
  });
  insertMany();
}

function seedAgentSkills(db: Database): void {
  const agents = db.prepare('SELECT id FROM agents').all() as { id: string }[];
  const insertSkill = db.prepare('INSERT OR IGNORE INTO agent_skills (agent_id, skill_name, level, exp) VALUES (?, ?, 0, 0)');
  const insertMany = db.transaction(() => {
    for (const agent of agents) {
      insertSkill.run(agent.id, 'combat');
      insertSkill.run(agent.id, 'scout');
      insertSkill.run(agent.id, 'trade');
    }
  });
  insertMany();
}

function seedAgentStrategies(db: Database): void {
  const agents = db.prepare('SELECT id FROM agents').all() as { id: string }[];
  const insert = db.prepare('INSERT OR IGNORE INTO agent_strategies (agent_id) VALUES (?)');
  const insertMany = db.transaction(() => {
    for (const agent of agents) {
      insert.run(agent.id);
    }
  });
  insertMany();
}
