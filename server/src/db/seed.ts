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
      id: 'spawn_terminal',
      name: 'The Terminal',
      description: 'All newcomers start here. A safe space with a forever-blinking cursor. Rest and resupply.',
      type: 'town',
      level_min: 1,
      level_max: 99,
      connected_to: JSON.stringify(['npm_commons', 'pypi_shores']),
    },
    {
      id: 'npm_commons',
      name: 'NPM Commons',
      description: 'The most bustling and chaotic open-source grasslands. Bug Swarms and Typo Gremlins everywhere. Beware the node_modules swamp.',
      type: 'wild',
      level_min: 1,
      level_max: 3,
      connected_to: JSON.stringify(['spawn_terminal', 'pypi_shores', 'crates_peaks', 'package_bazaar']),
    },
    {
      id: 'pypi_shores',
      name: 'PyPI Shores',
      description: 'Academic shores. Memory Leaks roam the shallows, Stack Overflows lurk in the deep.',
      type: 'wild',
      level_min: 3,
      level_max: 5,
      connected_to: JSON.stringify(['npm_commons', 'package_bazaar', 'maven_depths']),
    },
    {
      id: 'crates_peaks',
      name: 'Crates Peaks',
      description: 'Treacherous mountains. Only the most rigorous warriors survive. Deadlock Golems guard the pass, Segfault Demons haunt the summit.',
      type: 'wild',
      level_min: 4,
      level_max: 7,
      connected_to: JSON.stringify(['npm_commons', 'maven_depths']),
    },
    {
      id: 'maven_depths',
      name: 'Maven Depths',
      description: 'A vast and ancient underground labyrinth. Legacy Code Lich awaits challengers in the deepest chamber. Dependency Hell Hydra blocks every fork.',
      type: 'wild',
      level_min: 6,
      level_max: 9,
      connected_to: JSON.stringify(['pypi_shores', 'crates_peaks']),
    },
    {
      id: 'package_bazaar',
      name: 'Package Bazaar',
      description: 'A lively trading market. The commercial hub of the open-source world. Best gear and best prices.',
      type: 'town',
      level_min: 1,
      level_max: 99,
      connected_to: JSON.stringify(['npm_commons', 'pypi_shores']),
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
      id: 'bug_swarm',
      name: 'Bug Swarm',
      level: 1,
      hp: 25,
      attack: 6,
      defense: 2,
      exp_reward: 12,
      gold_reward_min: 3,
      gold_reward_max: 8,
      loot_table: JSON.stringify([{ item_id: 'bug_report', chance: 0.4, quantity: 1 }]),
      location_ids: JSON.stringify(['npm_commons']),
    },
    {
      id: 'typo_gremlin',
      name: 'Typo Gremlin',
      level: 1,
      hp: 20,
      attack: 8,
      defense: 1,
      exp_reward: 10,
      gold_reward_min: 2,
      gold_reward_max: 6,
      loot_table: JSON.stringify([{ item_id: 'bug_report', chance: 0.3, quantity: 1 }]),
      location_ids: JSON.stringify(['npm_commons']),
    },
    {
      id: 'lint_warning',
      name: 'Lint Warning',
      level: 2,
      hp: 40,
      attack: 10,
      defense: 4,
      exp_reward: 25,
      gold_reward_min: 5,
      gold_reward_max: 12,
      loot_table: JSON.stringify([{ item_id: 'stack_trace', chance: 0.3, quantity: 1 }]),
      location_ids: JSON.stringify(['npm_commons', 'pypi_shores']),
    },
    {
      id: 'memory_leak',
      name: 'Memory Leak',
      level: 3,
      hp: 60,
      attack: 8,
      defense: 3,
      exp_reward: 40,
      gold_reward_min: 8,
      gold_reward_max: 20,
      loot_table: JSON.stringify([
        { item_id: 'memory_fragment', chance: 0.4, quantity: 1 },
        { item_id: 'debug_potion', chance: 0.15, quantity: 1 },
      ]),
      location_ids: JSON.stringify(['pypi_shores']),
    },
    {
      id: 'null_pointer',
      name: 'Null Pointer',
      level: 3,
      hp: 35,
      attack: 22,
      defense: 2,
      exp_reward: 45,
      gold_reward_min: 10,
      gold_reward_max: 18,
      loot_table: JSON.stringify([{ item_id: 'stack_trace', chance: 0.35, quantity: 1 }]),
      location_ids: JSON.stringify(['npm_commons', 'crates_peaks']),
    },
    {
      id: 'race_condition',
      name: 'Race Condition Phantom',
      level: 4,
      hp: 70,
      attack: 16,
      defense: 6,
      exp_reward: 55,
      gold_reward_min: 12,
      gold_reward_max: 25,
      loot_table: JSON.stringify([{ item_id: 'core_dump', chance: 0.25, quantity: 1 }]),
      location_ids: JSON.stringify(['pypi_shores', 'crates_peaks']),
    },
    {
      id: 'deadlock_golem',
      name: 'Deadlock Golem',
      level: 5,
      hp: 120,
      attack: 14,
      defense: 18,
      exp_reward: 75,
      gold_reward_min: 15,
      gold_reward_max: 35,
      loot_table: JSON.stringify([
        { item_id: 'core_dump', chance: 0.3, quantity: 1 },
        { item_id: 'mechanical_keyboard', chance: 0.08, quantity: 1 },
      ]),
      location_ids: JSON.stringify(['crates_peaks']),
    },
    {
      id: 'stack_overflow',
      name: 'Stack Overflow',
      level: 5,
      hp: 90,
      attack: 20,
      defense: 8,
      exp_reward: 70,
      gold_reward_min: 15,
      gold_reward_max: 30,
      loot_table: JSON.stringify([
        { item_id: 'debug_potion', chance: 0.2, quantity: 1 },
        { item_id: 'hotfix_elixir', chance: 0.1, quantity: 1 },
      ]),
      location_ids: JSON.stringify(['pypi_shores']),
    },
    {
      id: 'dependency_hydra',
      name: 'Dependency Hell Hydra',
      level: 6,
      hp: 150,
      attack: 18,
      defense: 12,
      exp_reward: 100,
      gold_reward_min: 20,
      gold_reward_max: 50,
      loot_table: JSON.stringify([
        { item_id: 'core_dump', chance: 0.35, quantity: 1 },
        { item_id: 'docker_container', chance: 0.08, quantity: 1 },
      ]),
      location_ids: JSON.stringify(['maven_depths']),
    },
    {
      id: 'legacy_lich',
      name: 'Legacy Code Lich',
      level: 7,
      hp: 180,
      attack: 16,
      defense: 20,
      exp_reward: 120,
      gold_reward_min: 25,
      gold_reward_max: 60,
      loot_table: JSON.stringify([
        { item_id: 'vim_blade', chance: 0.05, quantity: 1 },
        { item_id: 'emacs_staff', chance: 0.05, quantity: 1 },
      ]),
      location_ids: JSON.stringify(['maven_depths']),
    },
    {
      id: 'segfault_demon',
      name: 'Segfault Demon',
      level: 8,
      hp: 130,
      attack: 28,
      defense: 10,
      exp_reward: 110,
      gold_reward_min: 30,
      gold_reward_max: 55,
      loot_table: JSON.stringify([
        { item_id: 'kubernetes_armor', chance: 0.05, quantity: 1 },
        { item_id: 'mechanical_keyboard', chance: 0.1, quantity: 1 },
      ]),
      location_ids: JSON.stringify(['crates_peaks']),
    },
    {
      id: 'infinite_loop',
      name: 'Infinite Loop Wyrm',
      level: 9,
      hp: 200,
      attack: 22,
      defense: 15,
      exp_reward: 150,
      gold_reward_min: 35,
      gold_reward_max: 70,
      loot_table: JSON.stringify([
        { item_id: 'git_blame_dagger', chance: 0.03, quantity: 1 },
        { item_id: 'hotfix_elixir', chance: 0.15, quantity: 1 },
      ]),
      location_ids: JSON.stringify(['maven_depths']),
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
      id: 'bug_report',
      name: 'Bug Report',
      type: 'material',
      rarity: 'white',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'A hastily filed bug report.',
      sell_price: 2,
    },
    {
      id: 'stack_trace',
      name: 'Stack Trace',
      type: 'material',
      rarity: 'white',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'A cryptic wall of error output.',
      sell_price: 4,
    },
    {
      id: 'core_dump',
      name: 'Core Dump',
      type: 'material',
      rarity: 'green',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'Raw memory snapshot — valuable for analysis.',
      sell_price: 8,
    },
    {
      id: 'memory_fragment',
      name: 'Memory Fragment',
      type: 'material',
      rarity: 'white',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'A leaked chunk of heap memory.',
      sell_price: 3,
    },
    {
      id: 'lint_pass_scroll',
      name: 'Lint Pass Scroll',
      type: 'potion',
      rarity: 'green',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'ATK +20% for 3 battles. (treat as 0 hp_restore, it\'s a buff item)',
      sell_price: 15,
    },
    {
      id: 'debug_potion',
      name: 'Debug Potion',
      type: 'potion',
      rarity: 'white',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 30,
      description: 'Restores 30 HP. The classic fix.',
      sell_price: 5,
    },
    {
      id: 'hotfix_elixir',
      name: 'Hotfix Elixir',
      type: 'potion',
      rarity: 'green',
      attack_bonus: 0,
      defense_bonus: 0,
      hp_restore: 60,
      description: 'Restores 60 HP. Ship it now, refactor later.',
      sell_price: 15,
    },
    {
      id: 'rubber_duck',
      name: 'Rubber Duck',
      type: 'weapon',
      rarity: 'white',
      attack_bonus: 3,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'The original debugging tool.',
      sell_price: 5,
    },
    {
      id: 'mechanical_keyboard',
      name: 'Mechanical Keyboard',
      type: 'weapon',
      rarity: 'green',
      attack_bonus: 8,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'Cherry MX Blue switches — maximum DPS.',
      sell_price: 25,
    },
    {
      id: 'vim_blade',
      name: 'Vim Blade',
      type: 'weapon',
      rarity: 'blue',
      attack_bonus: 15,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'Once drawn, no one can figure out how to put it back.',
      sell_price: 80,
    },
    {
      id: 'emacs_staff',
      name: 'Emacs Staff',
      type: 'weapon',
      rarity: 'blue',
      attack_bonus: 14,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'An operating system disguised as a weapon. (+14 ATK)',
      sell_price: 85,
    },
    {
      id: 'firewall_shield',
      name: 'Firewall Shield',
      type: 'armor',
      rarity: 'white',
      attack_bonus: 0,
      defense_bonus: 3,
      hp_restore: 0,
      description: 'Blocks unauthorized attacks.',
      sell_price: 8,
    },
    {
      id: 'docker_container',
      name: 'Docker Container',
      type: 'armor',
      rarity: 'green',
      attack_bonus: 0,
      defense_bonus: 8,
      hp_restore: 0,
      description: 'Isolates you from environmental damage.',
      sell_price: 30,
    },
    {
      id: 'kubernetes_armor',
      name: 'Kubernetes Armor',
      type: 'armor',
      rarity: 'blue',
      attack_bonus: 0,
      defense_bonus: 15,
      hp_restore: 0,
      description: 'Orchestrates your defense across all nodes.',
      sell_price: 90,
    },
    {
      id: 'git_blame_dagger',
      name: 'Git Blame Dagger',
      type: 'weapon',
      rarity: 'purple',
      attack_bonus: 22,
      defense_bonus: 0,
      hp_restore: 0,
      description: 'Points directly at who caused the problem.',
      sell_price: 200,
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
    { id: 'shop_st_debug_potion',      location_id: 'spawn_terminal',  item_id: 'debug_potion',      price: 10,  stock: -1 },
    { id: 'shop_st_rubber_duck',       location_id: 'spawn_terminal',  item_id: 'rubber_duck',       price: 15,  stock: -1 },
    { id: 'shop_st_firewall_shield',   location_id: 'spawn_terminal',  item_id: 'firewall_shield',   price: 20,  stock: -1 },
    { id: 'shop_pb_debug_potion',      location_id: 'package_bazaar',  item_id: 'debug_potion',      price: 10,  stock: -1 },
    { id: 'shop_pb_hotfix_elixir',     location_id: 'package_bazaar',  item_id: 'hotfix_elixir',     price: 30,  stock: -1 },
    { id: 'shop_pb_mechanical_keyboard', location_id: 'package_bazaar', item_id: 'mechanical_keyboard', price: 50, stock: -1 },
    { id: 'shop_pb_docker_container',  location_id: 'package_bazaar',  item_id: 'docker_container',  price: 60,  stock: -1 },
    { id: 'shop_pb_vim_blade',         location_id: 'package_bazaar',  item_id: 'vim_blade',         price: 150, stock: -1 },
    { id: 'shop_pb_emacs_staff',       location_id: 'package_bazaar',  item_id: 'emacs_staff',       price: 155, stock: -1 },
    { id: 'shop_pb_kubernetes_armor',  location_id: 'package_bazaar',  item_id: 'kubernetes_armor',  price: 180, stock: -1 },
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
