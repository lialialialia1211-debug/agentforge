// Room Engine — main rendering loop for CodeMud Room View
'use strict';

var RoomEngine = (function() {
  var canvas, ctx;
  var currentLocationId = null;
  var roomData = null;
  var prevRoomData = null;
  var fetchTime = 0;
  var FETCH_INTERVAL = 3000;
  var entities = []; // { type, data, renderX, renderY, prevX, prevY, targetX, targetY }
  var walkFrame = 0;
  var walkTimer = 0;
  var isRunning = false;
  var fetchIntervalId = null;
  var prevBattleRoundCounts = {};
  var onRoomEventCallbacks = [];

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
  }

  function onRoomEvent(cb) {
    onRoomEventCallbacks.push(cb);
  }

  function emitEvent(event) {
    for (var i = 0; i < onRoomEventCallbacks.length; i++) {
      onRoomEventCallbacks[i](event);
    }
  }

  function loadRoom(locationId) {
    if (currentLocationId === locationId && roomData) return;
    currentLocationId = locationId;
    roomData = null;
    prevRoomData = null;
    entities = [];
    prevBattleRoundCounts = {};
    fetchNow();
  }

  function getCurrentLocationId() {
    return currentLocationId;
  }

  function getRoomData() {
    return roomData;
  }

  function fetchNow() {
    if (!currentLocationId) return;
    fetch('/api/room/' + currentLocationId)
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (!json.ok || !json.data) return;
        prevRoomData = roomData;
        roomData = json.data;
        fetchTime = Date.now();
        syncEntities();
        detectBattleAnims();
        emitEvent({ type: 'data', data: roomData });
      })
      .catch(function(err) {
        console.error('Room fetch error:', err);
      });
  }

  function syncEntities() {
    if (!roomData) return;
    var newEntities = [];
    var ents = roomData.entities || {};

    // Agents
    (ents.agents || []).forEach(function(a) {
      var existing = entities.find(function(e) { return e.type === 'agent' && e.data.name === a.name; });
      if (existing) {
        existing.prevX = existing.renderX;
        existing.prevY = existing.renderY;
        existing.targetX = a.x;
        existing.targetY = a.y;
        existing.data = a;
      } else {
        newEntities.push({
          type: 'agent', data: a,
          renderX: a.x, renderY: a.y,
          prevX: a.x, prevY: a.y,
          targetX: a.x, targetY: a.y
        });
      }
    });

    // Monsters
    (ents.monsters || []).forEach(function(m) {
      var existing = entities.find(function(e) { return e.type === 'monster' && e.data.id === m.id; });
      if (existing) {
        existing.prevX = existing.renderX;
        existing.prevY = existing.renderY;
        existing.targetX = m.x;
        existing.targetY = m.y;
        existing.data = m;
      } else {
        newEntities.push({
          type: 'monster', data: m,
          renderX: m.x, renderY: m.y,
          prevX: m.x, prevY: m.y,
          targetX: m.x, targetY: m.y
        });
      }
    });

    // NPCs
    (ents.npcs || []).forEach(function(n) {
      var existing = entities.find(function(e) { return e.type === 'npc' && e.data.id === n.id; });
      if (!existing) {
        newEntities.push({
          type: 'npc', data: n,
          renderX: n.x, renderY: n.y,
          prevX: n.x, prevY: n.y,
          targetX: n.x, targetY: n.y
        });
      }
    });

    // Remove entities no longer in data
    entities = entities.filter(function(e) {
      if (e.type === 'agent') return (ents.agents || []).some(function(a) { return a.name === e.data.name; });
      if (e.type === 'monster') return (ents.monsters || []).some(function(m) { return m.id === e.data.id; });
      if (e.type === 'npc') return true;
      return false;
    });

    entities = entities.concat(newEntities);
  }

  function detectBattleAnims() {
    if (!roomData || !roomData.active_battles) return;
    roomData.active_battles.forEach(function(b) {
      var lr = b.latest_round;
      if (!lr) return;
      var key = b.battle_id;
      var prev = prevBattleRoundCounts[key] || 0;
      // Simple heuristic: if latest_round exists and we haven't seen it
      if (lr.damage && !prevBattleRoundCounts['_seen_' + key + '_' + lr.damage + '_' + lr.attacker]) {
        prevBattleRoundCounts['_seen_' + key + '_' + lr.damage + '_' + lr.attacker] = true;
        var midX = (b.agent_x + b.monster_x) / 2;
        var midY = (b.agent_y + b.monster_y) / 2;
        addSlashEffect(midX, midY);
        if (lr.attacker === 'agent') {
          addDamageFloat(b.monster_x, b.monster_y - 10, lr.damage, true);
        } else {
          addDamageFloat(b.agent_x, b.agent_y - 10, lr.damage, false);
        }
      }
    });
  }

  function update() {
    // Interpolate entity positions
    var elapsed = Date.now() - fetchTime;
    var t = Math.min(elapsed / FETCH_INTERVAL, 1);

    entities.forEach(function(e) {
      if (e.prevX !== undefined && e.targetX !== undefined) {
        e.renderX = e.prevX + (e.targetX - e.prevX) * t;
        e.renderY = e.prevY + (e.targetY - e.prevY) * t;
      }
    });

    // Walk animation frame
    walkTimer++;
    if (walkTimer > 8) {
      walkTimer = 0;
      walkFrame++;
    }

    // Update effects
    updateEffects();
  }

  function draw() {
    if (!canvas || !ctx || !currentLocationId) return;

    var w = canvas.width;
    var h = canvas.height;
    var scaleX = w / 800;
    var scaleY = h / 450;

    ctx.clearRect(0, 0, w, h);

    // 1. Scene background + decorations
    drawScene(ctx, currentLocationId, w, h);

    // 2. Exits
    if (roomData && roomData.exits) {
      drawExits(ctx, roomData.exits, scaleX, scaleY);
    }

    // 3. Sort entities by Y for depth ordering
    var sorted = entities.slice().sort(function(a, b) { return a.renderY - b.renderY; });

    // 4. Draw entities
    ctx.save();
    ctx.scale(scaleX, scaleY);
    for (var i = 0; i < sorted.length; i++) {
      var e = sorted[i];
      if (e.type === 'agent') {
        drawAgentSprite(ctx, e.renderX, e.renderY, e.data, walkFrame);
      } else if (e.type === 'monster') {
        drawMonsterSprite(ctx, e.renderX, e.renderY, e.data);
      } else if (e.type === 'npc') {
        drawNpcSprite(ctx, e.renderX, e.renderY, e.data);
      }
    }

    // 5. Battle links
    if (roomData && roomData.active_battles) {
      drawBattleLinks(ctx, roomData.active_battles);
    }

    // 6. Effects
    drawEffects(ctx);

    // 7. Entity UI (names, HP) — drawn on top
    for (var j = 0; j < sorted.length; j++) {
      var e2 = sorted[j];
      if (e2.type === 'agent') {
        drawAgentUI(ctx, e2.renderX, e2.renderY, e2.data);
      } else if (e2.type === 'monster') {
        drawMonsterUI(ctx, e2.renderX, e2.renderY, e2.data);
      }
    }
    ctx.restore();
  }

  function startLoop() {
    if (isRunning) return;
    isRunning = true;

    function loop() {
      if (!isRunning) return;
      update();
      draw();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // Fetch data every 3 seconds
    fetchIntervalId = setInterval(fetchNow, FETCH_INTERVAL);
  }

  function stopLoop() {
    isRunning = false;
    if (fetchIntervalId) {
      clearInterval(fetchIntervalId);
      fetchIntervalId = null;
    }
  }

  function resize(w, h) {
    if (canvas) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  return {
    init: init,
    loadRoom: loadRoom,
    getCurrentLocationId: getCurrentLocationId,
    getRoomData: getRoomData,
    startLoop: startLoop,
    stopLoop: stopLoop,
    resize: resize,
    onRoomEvent: onRoomEvent,
    fetchNow: fetchNow
  };
})();
