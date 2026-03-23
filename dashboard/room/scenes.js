// Room scene configurations for CodeMud Room View
'use strict';

var ROOM_SCENES = {
  spawn_terminal: {
    background: '#080c10',
    ground: { y: 350, color: '#0d1117', lineColor: '#1a2030' },
    decorations: [
      { type: 'cursor', x: 80, y: 180 },
      { type: 'sign', x: 350, y: 140, text: 'Welcome to\nCodeMud' },
      { type: 'campfire', x: 560, y: 260 },
      { type: 'bench', x: 510, y: 275 },
      { type: 'bench', x: 600, y: 275 }
    ],
    flavorText: '> Home sweet home. Rest here, plan your next move.'
  },
  npm_commons: {
    background: '#080c12',
    ground: { y: 350, color: '#0f1419', lineColor: '#1a2030' },
    decorations: [
      { type: 'box_stack', x: 60, y: 200, label: 'node_\nmodules' },
      { type: 'box', x: 140, y: 230, label: 'pkg.json' },
      { type: 'tree', x: 620, y: 160, height: 80 },
      { type: 'tree', x: 670, y: 185, height: 55 },
      { type: 'rock', x: 250, y: 320, size: 4 },
      { type: 'rock', x: 420, y: 340, size: 3 },
      { type: 'rock', x: 560, y: 310, size: 5 }
    ],
    flavorText: '// NPM Commons. Watch your step — node_modules is deeper than it looks.'
  },
  pypi_shores: {
    background: '#080c14',
    ground: { y: 330, color: '#0d1220', lineColor: '#1a2540' },
    decorations: [
      { type: 'water', y: 370 },
      { type: 'waves', y: 365 },
      { type: 'boat', x: 120, y: 350 },
      { type: 'boat', x: 200, y: 355 },
      { type: 'bookshelf', x: 400, y: 180 },
      { type: 'rock', x: 300, y: 335, size: 3 },
      { type: 'rock', x: 520, y: 340, size: 2 }
    ],
    flavorText: '# PyPI Shores. Academic waters. Memory Leaks lurk beneath.'
  },
  crates_peaks: {
    background: '#0a0a10',
    ground: { y: 350, color: '#15151f', lineColor: '#252530' },
    decorations: [
      { type: 'mountain', x: 100, y: 80, width: 200, height: 150 },
      { type: 'mountain', x: 420, y: 60, width: 180, height: 170 },
      { type: 'bridge', x: 280, y: 260, width: 120 },
      { type: 'forge', x: 100, y: 240 },
      { type: 'cave', x: 640, y: 210 },
      { type: 'rock', x: 350, y: 300, size: 8 },
      { type: 'rock', x: 510, y: 320, size: 6 }
    ],
    flavorText: '// Crates Peaks. Only the strictest warriors survive here.'
  },
  maven_depths: {
    background: '#0a0808',
    ground: { y: 350, color: '#120e0e', lineColor: '#251a1a' },
    decorations: [
      { type: 'pillar', x: 80, y: 100, height: 250 },
      { type: 'pillar', x: 250, y: 100, height: 250 },
      { type: 'pillar', x: 450, y: 100, height: 250 },
      { type: 'pillar', x: 620, y: 100, height: 250 },
      { type: 'altar', x: 350, y: 210 },
      { type: 'rune', x: 150, y: 280 },
      { type: 'rune', x: 550, y: 265 },
      { type: 'cobweb', x: 50, y: 80 },
      { type: 'bones', x: 500, y: 325 }
    ],
    flavorText: '// Maven Depths. The Legacy Code Lich waits in the darkness...'
  },
  package_bazaar: {
    background: '#0c0a08',
    ground: { y: 350, color: '#141210', lineColor: '#252018' },
    decorations: [
      { type: 'stall', x: 120, y: 150, label: 'Weapons', color: '#f0883e' },
      { type: 'stall', x: 560, y: 150, label: 'Potions', color: '#3fb950' },
      { type: 'fountain', x: 350, y: 240 },
      { type: 'sign', x: 350, y: 110, text: 'Package\nBazaar' },
      { type: 'crate', x: 200, y: 290, size: 12 },
      { type: 'crate', x: 490, y: 310, size: 10 },
      { type: 'flag', x: 300, y: 100, color: '#e3b341' },
      { type: 'flag', x: 400, y: 100, color: '#f0883e' }
    ],
    flavorText: '// Package Bazaar. Buy low, sell high.'
  }
};

// Draw scene background and decorations
function drawScene(ctx, locationId, canvasW, canvasH) {
  var scene = ROOM_SCENES[locationId];
  if (!scene) return;

  var scaleX = canvasW / 800;
  var scaleY = canvasH / 450;

  // Background fill
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Ground plane
  if (scene.ground) {
    ctx.fillStyle = scene.ground.color;
    ctx.fillRect(0, scene.ground.y * scaleY, canvasW, canvasH - scene.ground.y * scaleY);

    // Ground line
    ctx.strokeStyle = scene.ground.lineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, scene.ground.y * scaleY);
    ctx.lineTo(canvasW, scene.ground.y * scaleY);
    ctx.stroke();

    // Grid dots on ground
    ctx.fillStyle = scene.ground.lineColor;
    for (var gx = 20; gx < canvasW; gx += 40) {
      for (var gy = scene.ground.y * scaleY + 15; gy < canvasH; gy += 30) {
        ctx.fillRect(gx, gy, 1, 1);
      }
    }
  }

  // Draw each decoration
  var decos = scene.decorations || [];
  for (var i = 0; i < decos.length; i++) {
    var d = decos[i];
    var dx = (d.x || 0) * scaleX;
    var dy = (d.y || 0) * scaleY;

    drawDecoration(ctx, d, dx, dy, scaleX, scaleY);
  }

  // Flavor text
  if (scene.flavorText) {
    ctx.save();
    ctx.fillStyle = 'rgba(138,148,158,0.25)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(scene.flavorText, 12 * scaleX, (canvasH - 10));
    ctx.restore();
  }
}

function drawDecoration(ctx, d, x, y, sx, sy) {
  ctx.save();

  switch (d.type) {
    case 'rock':
      ctx.fillStyle = '#1a2030';
      ctx.beginPath();
      var rs = (d.size || 4) * sx;
      ctx.arc(x, y, rs, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'tree':
      var th = (d.height || 60) * sy;
      ctx.fillStyle = '#1a2030';
      ctx.fillRect(x - 2 * sx, y, 4 * sx, th * 0.4);
      ctx.fillStyle = '#15201a';
      ctx.beginPath();
      ctx.moveTo(x, y - th * 0.3);
      ctx.lineTo(x + 18 * sx, y + th * 0.1);
      ctx.lineTo(x - 18 * sx, y + th * 0.1);
      ctx.closePath();
      ctx.fill();
      break;

    case 'box_stack':
      ctx.fillStyle = '#111820';
      ctx.strokeStyle = '#1a2030';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, 45 * sx, 35 * sy);
      ctx.strokeRect(x, y, 45 * sx, 35 * sy);
      ctx.fillRect(x + 5 * sx, y - 25 * sy, 35 * sx, 28 * sy);
      ctx.strokeRect(x + 5 * sx, y - 25 * sy, 35 * sx, 28 * sy);
      ctx.fillRect(x + 10 * sx, y - 45 * sy, 25 * sx, 22 * sy);
      ctx.strokeRect(x + 10 * sx, y - 45 * sy, 25 * sx, 22 * sy);
      if (d.label) {
        ctx.fillStyle = '#484f58';
        ctx.font = (7 * sx) + 'px monospace';
        ctx.textAlign = 'center';
        var lines = d.label.split('\n');
        for (var li = 0; li < lines.length; li++) {
          ctx.fillText(lines[li], x + 22 * sx, y + 12 * sy + li * 9 * sy);
        }
      }
      break;

    case 'box':
      ctx.fillStyle = '#111820';
      ctx.strokeStyle = '#1a2030';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, 30 * sx, 20 * sy);
      ctx.strokeRect(x, y, 30 * sx, 20 * sy);
      if (d.label) {
        ctx.fillStyle = '#484f58';
        ctx.font = (6 * sx) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(d.label, x + 15 * sx, y + 12 * sy);
      }
      break;

    case 'sign':
      ctx.fillStyle = '#1a2030';
      ctx.fillRect(x - 1 * sx, y, 2 * sx, 25 * sy);
      ctx.fillStyle = '#111820';
      ctx.strokeStyle = '#e3b341';
      ctx.lineWidth = 1;
      ctx.fillRect(x - 35 * sx, y - 20 * sy, 70 * sx, 25 * sy);
      ctx.strokeRect(x - 35 * sx, y - 20 * sy, 70 * sx, 25 * sy);
      if (d.text) {
        ctx.fillStyle = '#e3b341';
        ctx.font = '600 ' + (8 * sx) + 'px monospace';
        ctx.textAlign = 'center';
        var signLines = d.text.split('\n');
        for (var si = 0; si < signLines.length; si++) {
          ctx.fillText(signLines[si], x, y - 7 * sy + si * 10 * sy);
        }
      }
      break;

    case 'campfire':
      // Base stones
      ctx.fillStyle = '#1a1a20';
      ctx.beginPath();
      ctx.ellipse(x, y + 4 * sy, 10 * sx, 4 * sy, 0, 0, Math.PI * 2);
      ctx.fill();
      // Fire (animated)
      var fTime = Date.now() / 200;
      var fH = (12 + Math.sin(fTime) * 3) * sy;
      ctx.fillStyle = '#f0883e';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(x - 5 * sx, y);
      ctx.quadraticCurveTo(x - 3 * sx, y - fH, x, y - fH - 4 * sy);
      ctx.quadraticCurveTo(x + 3 * sx, y - fH, x + 5 * sx, y);
      ctx.closePath();
      ctx.fill();
      // Inner flame
      ctx.fillStyle = '#e3b341';
      ctx.beginPath();
      var fH2 = fH * 0.6;
      ctx.moveTo(x - 3 * sx, y);
      ctx.quadraticCurveTo(x - 1 * sx, y - fH2, x, y - fH2 - 2 * sy);
      ctx.quadraticCurveTo(x + 1 * sx, y - fH2, x + 3 * sx, y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      // Glow
      ctx.fillStyle = 'rgba(240,136,62,0.06)';
      ctx.beginPath();
      ctx.arc(x, y - 5 * sy, 30 * sx, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'bench':
      ctx.fillStyle = '#1a1510';
      ctx.fillRect(x - 12 * sx, y, 24 * sx, 3 * sy);
      ctx.fillRect(x - 10 * sx, y + 3 * sy, 3 * sx, 5 * sy);
      ctx.fillRect(x + 7 * sx, y + 3 * sy, 3 * sx, 5 * sy);
      break;

    case 'cursor':
      // Blinking terminal cursor
      var blink = Math.sin(Date.now() / 500) > 0;
      if (blink) {
        ctx.fillStyle = '#3fb950';
        ctx.font = '600 ' + (32 * sx) + 'px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('>_', x, y);
      }
      ctx.fillStyle = 'rgba(63,185,80,0.04)';
      ctx.beginPath();
      ctx.arc(x + 20 * sx, y - 10 * sy, 35 * sx, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'mountain':
      var mw = (d.width || 150) * sx;
      var mh = (d.height || 120) * sy;
      ctx.fillStyle = '#151520';
      ctx.beginPath();
      ctx.moveTo(x, y + mh);
      ctx.lineTo(x + mw / 2, y);
      ctx.lineTo(x + mw, y + mh);
      ctx.closePath();
      ctx.fill();
      // Snow cap
      ctx.fillStyle = '#1a1a28';
      ctx.beginPath();
      ctx.moveTo(x + mw * 0.35, y + mh * 0.25);
      ctx.lineTo(x + mw / 2, y);
      ctx.lineTo(x + mw * 0.65, y + mh * 0.25);
      ctx.closePath();
      ctx.fill();
      break;

    case 'bridge':
      var bw = (d.width || 100) * sx;
      ctx.fillStyle = '#1a1510';
      ctx.fillRect(x, y, bw, 4 * sy);
      ctx.fillRect(x, y - 10 * sy, 3 * sx, 10 * sy);
      ctx.fillRect(x + bw - 3 * sx, y - 10 * sy, 3 * sx, 10 * sy);
      // Rope
      ctx.strokeStyle = '#252018';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 8 * sy);
      ctx.quadraticCurveTo(x + bw / 2, y - 3 * sy, x + bw, y - 8 * sy);
      ctx.stroke();
      break;

    case 'forge':
      ctx.fillStyle = '#1a1210';
      ctx.fillRect(x, y, 50 * sx, 35 * sy);
      ctx.strokeStyle = '#302018';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, 50 * sx, 35 * sy);
      // Chimney glow
      var fglow = 0.5 + 0.3 * Math.sin(Date.now() / 400);
      ctx.fillStyle = 'rgba(248,81,73,' + (fglow * 0.3) + ')';
      ctx.fillRect(x + 20 * sx, y - 5 * sy, 10 * sx, 8 * sy);
      break;

    case 'cave':
      ctx.fillStyle = '#0a0a0f';
      ctx.beginPath();
      ctx.arc(x + 25 * sx, y + 20 * sy, 30 * sx, Math.PI, 0);
      ctx.lineTo(x + 55 * sx, y + 45 * sy);
      ctx.lineTo(x - 5 * sx, y + 45 * sy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#050508';
      ctx.beginPath();
      ctx.ellipse(x + 25 * sx, y + 30 * sy, 15 * sx, 15 * sy, 0, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'pillar':
      var ph = (d.height || 200) * sy;
      ctx.fillStyle = '#1a1515';
      ctx.fillRect(x - 6 * sx, y, 12 * sx, ph);
      ctx.fillStyle = '#201818';
      ctx.fillRect(x - 8 * sx, y, 16 * sx, 5 * sy);
      ctx.fillRect(x - 8 * sx, y + ph - 5 * sy, 16 * sx, 5 * sy);
      break;

    case 'altar':
      ctx.fillStyle = '#1a1210';
      ctx.fillRect(x - 25 * sx, y, 50 * sx, 20 * sy);
      ctx.strokeStyle = '#f8514933';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 25 * sx, y, 50 * sx, 20 * sy);
      // Glowing symbol
      var aGlow = 0.3 + 0.2 * Math.sin(Date.now() / 800);
      ctx.fillStyle = 'rgba(248,81,73,' + aGlow + ')';
      ctx.beginPath();
      ctx.arc(x, y - 5 * sy, 4 * sx, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'rune':
      var rGlow = 0.15 + 0.1 * Math.sin(Date.now() / 1000 + x);
      ctx.fillStyle = 'rgba(248,81,73,' + rGlow + ')';
      ctx.beginPath();
      ctx.arc(x, y, 8 * sx, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(248,81,73,' + (rGlow + 0.1) + ')';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(x, y, 12 * sx, 0, Math.PI * 2);
      ctx.stroke();
      break;

    case 'cobweb':
      ctx.strokeStyle = 'rgba(138,148,158,0.12)';
      ctx.lineWidth = 0.5;
      for (var wi = 0; wi < 5; wi++) {
        var wa = Math.PI * 0.5 * wi / 5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(wa) * 30 * sx, y + Math.sin(wa) * 30 * sy);
        ctx.stroke();
      }
      break;

    case 'bones':
      ctx.fillStyle = '#2a2520';
      ctx.fillRect(x, y, 12 * sx, 2 * sy);
      ctx.fillRect(x + 3 * sx, y - 4 * sy, 2 * sx, 10 * sy);
      ctx.beginPath();
      ctx.arc(x + 8 * sx, y - 4 * sy, 3 * sx, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'water':
      ctx.fillStyle = '#0a1525';
      ctx.fillRect(0, (d.y || 370) * sy, 800 * sx, 80 * sy);
      break;

    case 'waves':
      var waveY = (d.y || 365) * sy;
      ctx.strokeStyle = '#15253a';
      ctx.lineWidth = 1.5;
      var waveOffset = (Date.now() / 1500) % 1;
      ctx.beginPath();
      for (var wx = 0; wx < 800 * sx; wx += 2) {
        var wy = waveY + Math.sin(wx * 0.02 + waveOffset * Math.PI * 2) * 3;
        if (wx === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.stroke();
      break;

    case 'boat':
      ctx.fillStyle = '#1a1510';
      ctx.beginPath();
      ctx.moveTo(x - 12 * sx, y);
      ctx.lineTo(x + 12 * sx, y);
      ctx.lineTo(x + 8 * sx, y + 6 * sy);
      ctx.lineTo(x - 8 * sx, y + 6 * sy);
      ctx.closePath();
      ctx.fill();
      // Mast
      ctx.fillRect(x - 1 * sx, y - 12 * sy, 2 * sx, 12 * sy);
      break;

    case 'bookshelf':
      ctx.fillStyle = '#111820';
      ctx.fillRect(x - 25 * sx, y, 50 * sx, 55 * sy);
      ctx.strokeStyle = '#1a2030';
      ctx.lineWidth = 1;
      for (var shelf = 0; shelf < 4; shelf++) {
        var sy2 = y + shelf * 14 * sy;
        ctx.beginPath();
        ctx.moveTo(x - 25 * sx, sy2);
        ctx.lineTo(x + 25 * sx, sy2);
        ctx.stroke();
        // Books
        var bookColors = ['#58a6ff33', '#d2a8ff33', '#3fb95033', '#f0883e33'];
        for (var bk = 0; bk < 5; bk++) {
          ctx.fillStyle = bookColors[bk % bookColors.length];
          ctx.fillRect(x + (-22 + bk * 9) * sx, sy2 + 2 * sy, 7 * sx, 11 * sy);
        }
      }
      break;

    case 'stall':
      var stallW = 70 * sx, stallH = 45 * sy;
      var stallColor = d.color || '#e3b341';
      ctx.fillStyle = '#111820';
      ctx.fillRect(x - stallW / 2, y, stallW, stallH);
      ctx.strokeStyle = stallColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - stallW / 2, y, stallW, stallH);
      // Awning
      ctx.fillStyle = stallColor + '33';
      ctx.beginPath();
      ctx.moveTo(x - stallW / 2 - 5 * sx, y);
      ctx.lineTo(x + stallW / 2 + 5 * sx, y);
      ctx.lineTo(x + stallW / 2, y - 10 * sy);
      ctx.lineTo(x - stallW / 2, y - 10 * sy);
      ctx.closePath();
      ctx.fill();
      if (d.label) {
        ctx.fillStyle = stallColor;
        ctx.font = '600 ' + (8 * sx) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(d.label, x, y - 2 * sy);
      }
      break;

    case 'fountain':
      // Base
      ctx.fillStyle = '#1a1a20';
      ctx.beginPath();
      ctx.ellipse(x, y + 8 * sy, 16 * sx, 6 * sy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#252530';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Center pillar
      ctx.fillStyle = '#1a1a20';
      ctx.fillRect(x - 3 * sx, y - 10 * sy, 6 * sx, 18 * sy);
      // Water spray (animated)
      var sprayT = Date.now() / 300;
      ctx.fillStyle = 'rgba(88,166,255,0.3)';
      for (var sp = 0; sp < 5; sp++) {
        var spAngle = sprayT + sp * Math.PI * 2 / 5;
        var spX = x + Math.cos(spAngle) * 5 * sx;
        var spY = y - 12 * sy + Math.abs(Math.sin(spAngle)) * -6 * sy;
        ctx.beginPath();
        ctx.arc(spX, spY, 1.5 * sx, 0, Math.PI * 2);
        ctx.fill();
      }
      break;

    case 'crate':
      var cs = (d.size || 10) * sx;
      ctx.fillStyle = '#1a1510';
      ctx.fillRect(x - cs / 2, y - cs / 2, cs, cs);
      ctx.strokeStyle = '#252018';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x - cs / 2, y - cs / 2, cs, cs);
      // Cross
      ctx.beginPath();
      ctx.moveTo(x - cs / 2, y - cs / 2);
      ctx.lineTo(x + cs / 2, y + cs / 2);
      ctx.moveTo(x + cs / 2, y - cs / 2);
      ctx.lineTo(x - cs / 2, y + cs / 2);
      ctx.stroke();
      break;

    case 'flag':
      var fc = d.color || '#e3b341';
      ctx.fillStyle = '#1a1a20';
      ctx.fillRect(x - 1 * sx, y, 2 * sx, 40 * sy);
      ctx.fillStyle = fc + '88';
      var fWave = Math.sin(Date.now() / 400 + x * 0.01) * 2;
      ctx.beginPath();
      ctx.moveTo(x + 2 * sx, y + 2 * sy);
      ctx.lineTo(x + 18 * sx + fWave, y + 5 * sy);
      ctx.lineTo(x + 16 * sx + fWave, y + 14 * sy);
      ctx.lineTo(x + 2 * sx, y + 12 * sy);
      ctx.closePath();
      ctx.fill();
      break;
  }

  ctx.restore();
}

// Draw exit indicators
function drawExits(ctx, exits, scaleX, scaleY) {
  if (!exits) return;
  for (var i = 0; i < exits.length; i++) {
    var exit = exits[i];
    var ex = exit.x * scaleX;
    var ey = exit.y * scaleY;

    // Arrow/portal indicator
    ctx.save();
    var pulse = 0.4 + 0.2 * Math.sin(Date.now() / 600 + i);
    ctx.globalAlpha = pulse;

    // Portal glow
    ctx.fillStyle = exit.type === 'town' ? '#1f6feb' : '#f0883e';
    ctx.beginPath();
    ctx.arc(ex, ey, 12 * scaleX, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.8;
    ctx.fillStyle = exit.type === 'town' ? '#58a6ff' : '#f0883e';
    ctx.beginPath();
    ctx.arc(ex, ey, 5 * scaleX, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#8b949e';
    ctx.font = (7 * scaleX) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(exit.name, ex, ey + 18 * scaleY);
    ctx.fillStyle = exit.type === 'town' ? '#1f6feb' : '#484f58';
    ctx.font = (6 * scaleX) + 'px monospace';
    ctx.fillText('[' + exit.type.toUpperCase() + ']', ex, ey + 26 * scaleY);

    ctx.restore();
  }
}
