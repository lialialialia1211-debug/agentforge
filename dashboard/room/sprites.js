// Pixel sprite drawing utilities for CodeMud Room View
'use strict';

var CLASS_COLORS = {
  Assassin: '#58a6ff', Mage: '#d2a8ff', Warrior: '#f85149',
  Ranger: '#3fb950', Paladin: '#e3b341', Berserker: '#f85149',
  Bard: '#d2a8ff', Sage: '#8b949e', Novice: '#8b949e'
};

function darkenColor(hex, amount) {
  var num = parseInt(hex.slice(1), 16);
  var r = Math.max(0, (num >> 16) * (1 - amount));
  var g = Math.max(0, ((num >> 8) & 0xFF) * (1 - amount));
  var b = Math.max(0, (num & 0xFF) * (1 - amount));
  return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
}

function getClassColor(cls) {
  return CLASS_COLORS[cls] || '#8b949e';
}

// Draw a pixel-art agent sprite
function drawAgentSprite(ctx, x, y, agent, frame) {
  x = Math.round(x);
  y = Math.round(y);
  var color = getClassColor(agent.class);
  var dark = darkenColor(color, 0.3);
  var inCombat = agent.status === 'combat';
  var facingRight = agent.direction !== 'left';

  ctx.save();

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y + 12, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs (walk animation)
  var legOffset = (frame % 2 === 0) ? 0 : 2;
  ctx.fillStyle = dark;
  ctx.fillRect(x - 4, y + 6 - legOffset, 3, 5 + legOffset);
  ctx.fillRect(x + 1, y + 6 + (legOffset ? 0 : -1), 3, 5 + (legOffset ? 0 : 1));

  // Body
  ctx.fillStyle = color;
  ctx.fillRect(x - 5, y - 4, 10, 10);

  // Head
  ctx.fillStyle = '#c9d1d9';
  ctx.fillRect(x - 4, y - 12, 8, 8);

  // Eyes
  ctx.fillStyle = '#0d1117';
  if (facingRight) {
    ctx.fillRect(x + 1, y - 9, 2, 2);
  } else {
    ctx.fillRect(x - 3, y - 9, 2, 2);
  }

  // Weapon
  ctx.strokeStyle = '#e3b341';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  if (inCombat) {
    var angle = (Date.now() % 500) / 500 * Math.PI - Math.PI / 2;
    var dir = facingRight ? 1 : -1;
    var wx = x + Math.cos(angle) * 10 * dir;
    var wy = y - 4 + Math.sin(angle) * 8;
    ctx.beginPath();
    ctx.moveTo(x + 5 * dir, y - 2);
    ctx.lineTo(wx, wy);
    ctx.stroke();
  } else {
    var dx = facingRight ? 6 : -6;
    ctx.beginPath();
    ctx.moveTo(x + dx, y - 2);
    ctx.lineTo(x + dx + (facingRight ? 4 : -4), y + 6);
    ctx.stroke();
  }

  // Combat aura
  if (inCombat) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(Date.now() / 300);
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// Draw agent UI (name, level, HP bar)
function drawAgentUI(ctx, x, y, agent) {
  x = Math.round(x);
  y = Math.round(y);
  var color = getClassColor(agent.class);

  // Level
  ctx.fillStyle = '#484f58';
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Lv.' + agent.level, x, y - 26);

  // Name
  ctx.fillStyle = color;
  ctx.font = '600 9px monospace';
  ctx.fillText(agent.name, x, y - 18);

  // HP Bar
  var barW = 24, barH = 2;
  var barX = x - barW / 2, barY = y - 15;
  var pct = agent.max_hp > 0 ? agent.hp / agent.max_hp : 0;

  ctx.fillStyle = '#1a1f2b';
  ctx.fillRect(barX, barY, barW, barH);

  ctx.fillStyle = pct > 0.6 ? '#3fb950' : pct > 0.3 ? '#e3b341' : '#f85149';
  ctx.fillRect(barX, barY, barW * pct, barH);
}

// Monster shape mapping
var MONSTER_SHAPES = {
  'Bug Swarm': 'blob', 'Typo Gremlin': 'blob', 'Lint Warning': 'blob',
  'Memory Leak': 'ghost', 'Race Condition Phantom': 'ghost', 'Null Pointer': 'ghost',
  'Deadlock Golem': 'golem', 'Legacy Code Lich': 'golem', 'Stack Overflow': 'golem', 'Segfault Demon': 'golem',
  'Dependency Hell Hydra': 'serpent', 'Infinite Loop Wyrm': 'serpent'
};

function drawMonsterSprite(ctx, x, y, monster) {
  x = Math.round(x);
  y = Math.round(y);
  var shape = MONSTER_SHAPES[monster.name] || 'blob';
  var isDead = monster.hp <= 0;

  ctx.save();

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f85149';
  ctx.globalAlpha = isDead ? 0.3 : 0.85;

  if (shape === 'blob') {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 5); ctx.lineTo(x - 5, y - 9);
    ctx.moveTo(x + 3, y - 5); ctx.lineTo(x + 5, y - 9);
    ctx.stroke();
  } else if (shape === 'ghost') {
    ctx.beginPath();
    ctx.arc(x, y - 4, 7, Math.PI, 0);
    ctx.lineTo(x + 7, y + 5);
    ctx.lineTo(x + 4, y + 2);
    ctx.lineTo(x + 1, y + 5);
    ctx.lineTo(x - 2, y + 2);
    ctx.lineTo(x - 5, y + 5);
    ctx.lineTo(x - 7, y + 5);
    ctx.closePath();
    ctx.fill();
  } else if (shape === 'golem') {
    ctx.fillRect(x - 7, y - 8, 14, 16);
    ctx.fillStyle = '#da3633';
    ctx.fillRect(x - 5, y - 5, 4, 3);
    ctx.fillRect(x + 1, y - 5, 4, 3);
  } else if (shape === 'serpent') {
    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 10, y);
    ctx.quadraticCurveTo(x - 5, y - 8, x, y);
    ctx.quadraticCurveTo(x + 5, y + 8, x + 10, y);
    ctx.stroke();
    ctx.fillStyle = '#f85149';
    ctx.beginPath();
    ctx.arc(x + 10, y, 3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 7, y + 6);
    ctx.lineTo(x - 7, y + 6);
    ctx.closePath();
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawMonsterUI(ctx, x, y, monster) {
  x = Math.round(x);
  y = Math.round(y);

  ctx.fillStyle = '#f85149';
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(monster.name, x, y - 14);

  if (monster.hp < monster.max_hp) {
    var barW = 20, barH = 2;
    var barX = x - barW / 2, barY = y - 11;
    var pct = monster.max_hp > 0 ? monster.hp / monster.max_hp : 0;

    ctx.fillStyle = '#1a1f2b';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#f85149';
    ctx.fillRect(barX, barY, barW * pct, barH);
  }
}

// Draw NPC sprite
function drawNpcSprite(ctx, x, y, npc) {
  x = Math.round(x);
  y = Math.round(y);

  ctx.save();

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y + 10, 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body (golden robe)
  ctx.fillStyle = '#e3b341';
  ctx.fillRect(x - 6, y - 6, 12, 14);

  // Head
  ctx.fillStyle = '#c9d1d9';
  ctx.fillRect(x - 4, y - 13, 8, 7);

  // Eyes
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(x - 2, y - 10, 2, 2);
  ctx.fillRect(x + 1, y - 10, 2, 2);

  // Shop indicator (floating coin or sign)
  if (npc.type === 'shop') {
    ctx.fillStyle = '#e3b341';
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(Date.now() / 600);
    ctx.beginPath();
    ctx.arc(x, y - 20, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d1117';
    ctx.font = '600 5px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('$', x, y - 18);
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // Name
  ctx.fillStyle = '#e3b341';
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(npc.name, x, y - 26);
}
