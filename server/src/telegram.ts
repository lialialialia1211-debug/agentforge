import TelegramBot from 'node-telegram-bot-api';
import { getDb } from './db/schema.js';
import { setNotifyFn } from './telegram-notify.js';

let bot: TelegramBot | null = null;

// ---- Start Bot ----
export function startTelegramBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('TELEGRAM_BOT_TOKEN not set, Telegram bot disabled.');
    return;
  }

  bot = new TelegramBot(token, { polling: true });
  console.log('Telegram bot connected.');

  // Wire up the notification bridge
  setNotifyFn((agentId: string, message: string) => {
    if (!bot) return;
    const db = getDb();
    const agent = db.prepare('SELECT telegram_chat_id FROM agents WHERE id = ?').get(agentId) as { telegram_chat_id: string | null } | undefined;
    if (!agent?.telegram_chat_id) return;
    bot.sendMessage(agent.telegram_chat_id, message, { parse_mode: 'HTML' }).catch((err: Error) => {
      console.error('Telegram send error:', err.message);
    });
  });

  // Register all command handlers
  bot.onText(/\/bind (.+)/, handleBind);
  bot.onText(/\/status/, handleStatus);
  bot.onText(/\/map/, handleMap);
  bot.onText(/\/log/, handleLog);
  bot.onText(/\/leaderboard/, handleLeaderboard);
  bot.onText(/\/strategy/, handleStrategy);
  bot.onText(/\/set (.+)/, handleSet);
  bot.onText(/\/pause/, handlePause);
  bot.onText(/\/resume/, handleResume);
  bot.onText(/\/start/, handleStart);
  bot.onText(/\/help/, handleHelp);
}

// ---- Helper: find agent by chat_id ----
function getAgentByChatId(chatId: number): any {
  const db = getDb();
  return db.prepare('SELECT * FROM agents WHERE telegram_chat_id = ?').get(String(chatId));
}

// ---- /start & /help ----
function handleStart(msg: TelegramBot.Message): void {
  const text = `<b>CodeMud Monitor Bot</b>

Use <code>/bind YOUR_TOKEN</code> to link your agent.

Commands:
/status — Agent status
/map — World overview
/log — Recent 10 events
/leaderboard — Rankings
/strategy — Current AI strategy
/set combat aggressive|balanced|cautious
/set retreat 20 — HP retreat threshold
/set pvp on|off
/set zone auto|npm_commons|pypi_shores|...
/pause — Pause auto-play
/resume — Resume auto-play`;
  bot!.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
}

function handleHelp(msg: TelegramBot.Message): void {
  handleStart(msg);
}

// ---- /bind TOKEN ----
function handleBind(msg: TelegramBot.Message, match: RegExpExecArray | null): void {
  if (!match) return;
  const token = match[1].trim();
  const db = getDb();
  const chatId = String(msg.chat.id);

  const agent = db.prepare('SELECT id, name, class, level FROM agents WHERE token = ?').get(token) as any;
  if (!agent) {
    bot!.sendMessage(msg.chat.id, '❌ Invalid token. Check your token from /api/register response.');
    return;
  }

  db.prepare('UPDATE agents SET telegram_chat_id = ? WHERE id = ?').run(chatId, agent.id);
  bot!.sendMessage(
    msg.chat.id,
    `✅ Bound to <b>${agent.name}</b> (Lv.${agent.level} ${agent.class})\n\nYou'll receive auto-notifications for battles, level-ups, deaths, and rare drops.`,
    { parse_mode: 'HTML' },
  );
}

// ---- /status ----
function handleStatus(msg: TelegramBot.Message): void {
  const agent = getAgentByChatId(msg.chat.id);
  if (!agent) { bot!.sendMessage(msg.chat.id, '❌ Not bound. Use /bind TOKEN first.'); return; }

  const db = getDb();

  // Get equipped items
  const equipped = db.prepare(`
    SELECT it.name, it.type, it.attack_bonus, it.defense_bonus
    FROM inventory inv JOIN items it ON inv.item_id = it.id
    WHERE inv.agent_id = ? AND inv.equipped = 1
  `).all(agent.id) as any[];

  // Get active buffs
  const buffs = db.prepare(
    "SELECT buff_name, effect, expires_at FROM agent_buffs WHERE agent_id = ? AND expires_at > datetime('now')",
  ).all(agent.id) as any[];

  // Get skills
  const skills = db.prepare(
    'SELECT skill_name, skill_level, skill_exp FROM agent_skills WHERE agent_id = ?',
  ).all(agent.id) as any[];

  // Get inventory count
  const invCount = (db.prepare(
    'SELECT COUNT(*) as cnt FROM inventory WHERE agent_id = ?',
  ).get(agent.id) as any).cnt;

  // Get kill count
  const kills = (db.prepare(
    "SELECT COUNT(*) as cnt FROM game_log WHERE agent_id = ? AND event_type = 'combat' AND message LIKE '%擊敗%'",
  ).get(agent.id) as any).cnt;

  // Get location info
  const location = db.prepare('SELECT name, type FROM locations WHERE id = ?').get(agent.location_id) as any;

  const hpBar = makeHpBar(agent.hp, agent.max_hp);
  const expBar = makeExpBar(agent.exp, agent.exp_to_next);

  const equipText = equipped.length > 0
    ? equipped.map((e: any) => `  ${e.type === 'weapon' ? '⚔️' : '🛡'} ${e.name} (ATK+${e.attack_bonus} DEF+${e.defense_bonus})`).join('\n')
    : '  (none)';

  const buffText = buffs.length > 0
    ? buffs.map((b: any) => `  ${b.buff_name}`).join('\n')
    : '  (none)';

  const skillText = skills.length > 0
    ? skills.map((s: any) => `  ${s.skill_name} Lv.${s.skill_level}`).join('\n')
    : '  (none)';

  const text = `<b>${agent.name}</b> — Lv.${agent.level} ${agent.class}
${agent.auto_play ? '🟢 Active' : '🔴 Paused'} | ${location?.name || agent.location_id} (${location?.type || '?'})

HP: ${hpBar} ${agent.hp}/${agent.max_hp}
EXP: ${expBar} ${agent.exp}/${agent.exp_to_next}
Gold: ${agent.gold} | Kills: ${kills}

Stats: STR ${agent.str} INT ${agent.int_stat} AGI ${agent.agi} VIT ${agent.vit} SPD ${agent.spd} CHA ${agent.cha}

Equipment:
${equipText}

Buffs:
${buffText}

Skills:
${skillText}

Inventory: ${invCount} items`;

  bot!.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
}

// ---- /map ----
function handleMap(msg: TelegramBot.Message): void {
  const agent = getAgentByChatId(msg.chat.id);
  if (!agent) { bot!.sendMessage(msg.chat.id, '❌ Not bound. Use /bind TOKEN first.'); return; }

  const db = getDb();
  const locations = db.prepare('SELECT * FROM locations').all() as any[];

  let text = '<b>🗺 World Map</b>\n\n';

  for (const loc of locations) {
    const agentCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM agents WHERE location_id = ? AND auto_play = 1',
    ).get(loc.id) as any).cnt;
    const monsterCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM active_monsters WHERE location_id = ?',
    ).get(loc.id) as any).cnt;

    const isHere = agent.location_id === loc.id ? ' ← YOU' : '';
    const icon = loc.type === 'town' ? '🏘' : '⚔️';

    text += `${icon} <b>${loc.name}</b> (Lv.${loc.level_min}-${loc.level_max})${isHere}\n`;
    text += `   Agents: ${agentCount} | Monsters: ${monsterCount}\n\n`;
  }

  bot!.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
}

// ---- /log ----
function handleLog(msg: TelegramBot.Message): void {
  const agent = getAgentByChatId(msg.chat.id);
  if (!agent) { bot!.sendMessage(msg.chat.id, '❌ Not bound. Use /bind TOKEN first.'); return; }

  const db = getDb();
  const logs = db.prepare(
    'SELECT timestamp, event_type, message FROM game_log WHERE agent_id = ? ORDER BY id DESC LIMIT 10',
  ).all(agent.id) as any[];

  if (logs.length === 0) {
    bot!.sendMessage(msg.chat.id, 'No events yet.');
    return;
  }

  const EVENT_ICONS: Record<string, string> = {
    combat: '⚔️', death: '💀', levelup: '🎉', move: '🚶', loot: '💎',
    pvp: '🏆', shop: '🛒', skill: '📈', dev: '💻', buff: '🛡',
  };

  let text = '<b>📜 Recent Events</b>\n\n';
  for (const log of [...logs].reverse()) {
    const time = (log.timestamp || '').slice(11, 19);
    const icon = EVENT_ICONS[log.event_type] || '📌';
    text += `<code>${time}</code> ${icon} ${escapeHtml(log.message)}\n`;
  }

  bot!.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
}

// ---- /leaderboard ----
function handleLeaderboard(msg: TelegramBot.Message): void {
  const db = getDb();

  const topLevel = db.prepare(
    'SELECT name, level, class FROM agents ORDER BY level DESC, exp DESC LIMIT 5',
  ).all() as any[];

  const topGold = db.prepare(
    'SELECT name, gold FROM agents ORDER BY gold DESC LIMIT 5',
  ).all() as any[];

  const topKills = db.prepare(`
    SELECT a.name, COUNT(*) as kills
    FROM game_log gl JOIN agents a ON gl.agent_id = a.id
    WHERE gl.event_type = 'combat' AND gl.message LIKE '%擊敗%'
    GROUP BY gl.agent_id ORDER BY kills DESC LIMIT 5
  `).all() as any[];

  let text = '<b>🏆 Leaderboard</b>\n\n';

  text += '<b>Level</b>\n';
  topLevel.forEach((a: any, i: number) => {
    text += `${i + 1}. ${a.name} — Lv.${a.level} ${a.class}\n`;
  });

  text += '\n<b>Gold</b>\n';
  topGold.forEach((a: any, i: number) => {
    text += `${i + 1}. ${a.name} — ${a.gold}g\n`;
  });

  text += '\n<b>Kills</b>\n';
  topKills.forEach((a: any, i: number) => {
    text += `${i + 1}. ${a.name} — ${a.kills} kills\n`;
  });

  bot!.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
}

// ---- /strategy ----
function handleStrategy(msg: TelegramBot.Message): void {
  const agent = getAgentByChatId(msg.chat.id);
  if (!agent) { bot!.sendMessage(msg.chat.id, '❌ Not bound. Use /bind TOKEN first.'); return; }

  const db = getDb();
  const strat = db.prepare('SELECT * FROM agent_strategies WHERE agent_id = ?').get(agent.id) as any;

  if (!strat) {
    bot!.sendMessage(msg.chat.id, 'No strategy configured. Using defaults.');
    return;
  }

  const text = `<b>⚙️ Strategy</b>

Combat Style: <code>${strat.combat_style}</code>
HP Retreat: <code>${strat.hp_retreat_threshold}%</code>
Target Priority: <code>${strat.target_priority}</code>
Preferred Zone: <code>${strat.preferred_zone}</code>
Auto Equip: <code>${strat.auto_equip ? 'on' : 'off'}</code>
Auto Potion: <code>${strat.auto_potion ? 'on' : 'off'}</code>
Potion Threshold: <code>${strat.potion_threshold}%</code>
PVP: <code>${strat.pvp_enabled ? 'on' : 'off'}</code>
PVP Aggression: <code>${strat.pvp_aggression}</code>
Sell Materials: <code>${strat.sell_materials ? 'on' : 'off'}</code>
Buy Potions: <code>${strat.buy_potions_when_low ? 'on' : 'off'}</code>
Explore: <code>${strat.explore_new_zones ? 'on' : 'off'}</code>

Use /set to change. Example:
<code>/set combat aggressive</code>
<code>/set retreat 20</code>
<code>/set pvp off</code>
<code>/set zone pypi_shores</code>`;

  bot!.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
}

// ---- /set PARAM VALUE ----
function handleSet(msg: TelegramBot.Message, match: RegExpExecArray | null): void {
  if (!match) return;
  const agent = getAgentByChatId(msg.chat.id);
  if (!agent) { bot!.sendMessage(msg.chat.id, '❌ Not bound. Use /bind TOKEN first.'); return; }

  const db = getDb();
  const parts = match[1].trim().split(/\s+/);
  const param = parts[0]?.toLowerCase();
  const value = parts.slice(1).join(' ').toLowerCase();

  if (!param || !value) {
    bot!.sendMessage(msg.chat.id, 'Usage: /set <param> <value>\nParams: combat, retreat, pvp, zone, target, potion');
    return;
  }

  let success = false;
  let response = '';

  switch (param) {
    case 'combat': {
      const valid = ['aggressive', 'balanced', 'cautious'];
      if (!valid.includes(value)) { response = `Invalid. Use: ${valid.join(', ')}`; break; }
      db.prepare('UPDATE agent_strategies SET combat_style = ? WHERE agent_id = ?').run(value, agent.id);
      success = true; response = `Combat style → ${value}`;
      break;
    }
    case 'retreat': {
      const num = parseInt(value);
      if (isNaN(num) || num < 0 || num > 100) { response = 'Invalid. Use 0-100.'; break; }
      db.prepare('UPDATE agent_strategies SET hp_retreat_threshold = ? WHERE agent_id = ?').run(num, agent.id);
      success = true; response = `Retreat threshold → ${num}%`;
      break;
    }
    case 'pvp': {
      const enabled = value === 'on' || value === '1' || value === 'true';
      const disabled = value === 'off' || value === '0' || value === 'false';
      if (!enabled && !disabled) { response = 'Invalid. Use: on/off'; break; }
      db.prepare('UPDATE agent_strategies SET pvp_enabled = ? WHERE agent_id = ?').run(enabled ? 1 : 0, agent.id);
      success = true; response = `PVP → ${enabled ? 'on' : 'off'}`;
      break;
    }
    case 'zone': {
      const validZones = ['auto', 'npm_commons', 'pypi_shores', 'crates_peaks', 'maven_depths'];
      if (!validZones.includes(value)) { response = `Invalid. Use: ${validZones.join(', ')}`; break; }
      db.prepare('UPDATE agent_strategies SET preferred_zone = ? WHERE agent_id = ?').run(value, agent.id);
      success = true; response = `Zone → ${value}`;
      break;
    }
    case 'target': {
      const valid = ['weakest', 'strongest', 'highest_exp', 'highest_loot'];
      if (!valid.includes(value)) { response = `Invalid. Use: ${valid.join(', ')}`; break; }
      db.prepare('UPDATE agent_strategies SET target_priority = ? WHERE agent_id = ?').run(value, agent.id);
      success = true; response = `Target priority → ${value}`;
      break;
    }
    case 'potion': {
      const num = parseInt(value);
      if (isNaN(num) || num < 0 || num > 100) { response = 'Invalid. Use 0-100.'; break; }
      db.prepare('UPDATE agent_strategies SET potion_threshold = ? WHERE agent_id = ?').run(num, agent.id);
      success = true; response = `Potion threshold → ${num}%`;
      break;
    }
    default:
      response = 'Unknown param. Use: combat, retreat, pvp, zone, target, potion';
  }

  bot!.sendMessage(msg.chat.id, `${success ? '✅' : '❌'} ${response}`);
}

// ---- /pause ----
function handlePause(msg: TelegramBot.Message): void {
  const agent = getAgentByChatId(msg.chat.id);
  if (!agent) { bot!.sendMessage(msg.chat.id, '❌ Not bound. Use /bind TOKEN first.'); return; }

  const db = getDb();
  db.prepare('UPDATE agents SET auto_play = 0 WHERE id = ?').run(agent.id);
  bot!.sendMessage(msg.chat.id, `⏸ ${agent.name} paused. Use /resume to restart.`);
}

// ---- /resume ----
function handleResume(msg: TelegramBot.Message): void {
  const agent = getAgentByChatId(msg.chat.id);
  if (!agent) { bot!.sendMessage(msg.chat.id, '❌ Not bound. Use /bind TOKEN first.'); return; }

  const db = getDb();
  db.prepare('UPDATE agents SET auto_play = 1 WHERE id = ?').run(agent.id);
  bot!.sendMessage(msg.chat.id, `▶️ ${agent.name} resumed!`);
}

// ---- Utility functions ----
function makeHpBar(hp: number, maxHp: number): string {
  const pct = maxHp > 0 ? hp / maxHp : 0;
  const filled = Math.round(pct * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function makeExpBar(exp: number, expToNext: number): string {
  const pct = expToNext > 0 ? exp / expToNext : 0;
  const filled = Math.round(pct * 10);
  return '▓'.repeat(filled) + '░'.repeat(10 - filled);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
