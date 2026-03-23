// Battle effects for CodeMud Room View
'use strict';

var roomEffects = [];

function addSlashEffect(x, y) {
  roomEffects.push({ type: 'slash', x: x, y: y, life: 12, maxLife: 12 });
}

function addDamageFloat(x, y, damage, isAgentDamage) {
  roomEffects.push({
    type: 'damageFloat',
    x: x + (Math.random() - 0.5) * 10,
    y: y,
    damage: damage,
    color: isAgentDamage ? '#3fb950' : '#f85149',
    life: 40,
    maxLife: 40
  });
}

function addVictoryBurst(x, y) {
  roomEffects.push({ type: 'victoryBurst', x: x, y: y, life: 30, maxLife: 30 });
}

function addDeathFade(x, y) {
  roomEffects.push({ type: 'deathFade', x: x, y: y, life: 25, maxLife: 25 });
}

function updateEffects() {
  for (var i = roomEffects.length - 1; i >= 0; i--) {
    roomEffects[i].life--;
    if (roomEffects[i].type === 'damageFloat') {
      roomEffects[i].y -= 0.8;
    }
    if (roomEffects[i].life <= 0) {
      roomEffects.splice(i, 1);
    }
  }
}

function drawEffects(ctx) {
  for (var i = 0; i < roomEffects.length; i++) {
    var e = roomEffects[i];
    var t = 1 - e.life / e.maxLife;

    if (e.type === 'slash') {
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = '#f0883e';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      var size = 8 + t * 4;
      ctx.beginPath();
      ctx.moveTo(e.x - size, e.y - size);
      ctx.lineTo(e.x + size, e.y + size);
      ctx.moveTo(e.x + size, e.y - size);
      ctx.lineTo(e.x - size, e.y + size);
      ctx.stroke();
      ctx.restore();
    }

    else if (e.type === 'damageFloat') {
      ctx.save();
      ctx.globalAlpha = Math.min(1, e.life / 15);
      ctx.fillStyle = e.color;
      ctx.font = (e.damage > 20 ? '700 12px' : '700 10px') + ' monospace';
      ctx.textAlign = 'center';
      ctx.fillText('-' + e.damage, e.x, e.y);
      ctx.restore();
    }

    else if (e.type === 'victoryBurst') {
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = '#e3b341';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 5 + t * 30, 0, Math.PI * 2);
      ctx.stroke();
      // Inner glow
      ctx.strokeStyle = '#f0883e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 3 + t * 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    else if (e.type === 'deathFade') {
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.6;
      ctx.fillStyle = '#f85149';
      // Particles flying outward
      for (var p = 0; p < 6; p++) {
        var angle = (Math.PI * 2 * p / 6) + t * 0.5;
        var dist = t * 20;
        var px = e.x + Math.cos(angle) * dist;
        var py = e.y + Math.sin(angle) * dist;
        ctx.fillRect(px - 1, py - 1, 2, 2);
      }
      ctx.restore();
    }
  }
}

// Draw battle connection lines
function drawBattleLinks(ctx, battles, agents, monsters) {
  if (!battles || battles.length === 0) return;

  ctx.save();
  for (var i = 0; i < battles.length; i++) {
    var b = battles[i];
    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(Date.now() / 300);
    ctx.setLineDash([4, 3]);

    ctx.beginPath();
    ctx.moveTo(b.agent_x, b.agent_y);
    ctx.lineTo(b.monster_x, b.monster_y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.restore();
}
