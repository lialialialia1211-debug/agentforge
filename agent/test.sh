#!/bin/bash
# CodeMud Integration Test Script
# Tests the complete game loop: register -> move -> fight -> loot -> use items -> rest -> dashboard

BASE_URL="http://localhost:3000"

echo "========================================"
echo "  CodeMud Integration Test"
echo "========================================"

# 1. Register
echo -e "\n[1] Register new agent (typescript -> Assassin)..."
REGISTER=$(curl -s -X POST "$BASE_URL/api/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"TestBot_$(date +%s)\", \"language\":\"typescript\"}")
echo "$REGISTER" | python3 -m json.tool 2>/dev/null | head -12

TOKEN=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['agent']['token'])" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "FAIL: Could not register. Aborting."
  exit 1
fi
AUTH="Authorization: Bearer $TOKEN"
echo "Token: $TOKEN"

# 2. Status
echo -e "\n[2] Check status..."
curl -s "$BASE_URL/api/status" -H "$AUTH" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
a=d['agent']
print(f'  Class={a[\"class\"]} Level={a[\"level\"]} HP={a[\"hp\"]}/{a[\"max_hp\"]} ATK={d[\"effective_attack\"]} DEF={d[\"effective_defense\"]} Gold={a[\"gold\"]}')
print(f'  Stats: STR={a[\"str\"]} INT={a[\"int_stat\"]} AGI={a[\"agi\"]} VIT={a[\"vit\"]} SPD={a[\"spd\"]} CHA={a[\"cha\"]}')
" 2>/dev/null

# 3. Look around (spawn_terminal)
echo -e "\n[3] Look around (The Terminal)..."
curl -s "$BASE_URL/api/look" -H "$AUTH" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print(f'  Location: {d[\"location\"][\"id\"]} ({d[\"location\"][\"type\"]})')
print(f'  Monsters: {len(d[\"monsters\"])}')
print(f'  Exits: {[e[\"id\"] for e in d[\"exits\"]]}')
" 2>/dev/null

# 4. Move to npm_commons
echo -e "\n[4] Move to NPM Commons..."
curl -s -X POST "$BASE_URL/api/move" -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"destination":"npm_commons"}' | python3 -c "
import sys,json; print(f'  {json.load(sys.stdin)[\"data\"][\"message\"]}')
" 2>/dev/null

# 5. Look for monsters
echo -e "\n[5] Look for monsters..."
LOOK=$(curl -s "$BASE_URL/api/look" -H "$AUTH")
echo "$LOOK" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print(f'  Monsters at NPM Commons:')
for m in d['monsters']:
    print(f'    - {m[\"name\"]} (Lv.{m[\"level\"]}) HP={m[\"current_hp\"]}/{m[\"max_hp\"]}')
" 2>/dev/null

MONSTER_ID=$(echo "$LOOK" | python3 -c "
import sys,json
ms=json.load(sys.stdin)['data']['monsters']
targets=[m for m in ms if m['name']=='Bug Swarm']
print(targets[0]['id'] if targets else (ms[0]['id'] if ms else ''))
" 2>/dev/null)

# 6. Attack
if [ -n "$MONSTER_ID" ]; then
  echo -e "\n[6] Attack monster ($MONSTER_ID)..."
  ATTACK=$(curl -s -X POST "$BASE_URL/api/attack" -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"target\":\"$MONSTER_ID\"}")
  echo "$ATTACK" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print(f'  Result: {d[\"result\"]}')
for log in d['combatLog']:
    print(f'    {log}')
if d['result'] == 'victory':
    print(f'  EXP+{d[\"expGained\"]} Gold+{d[\"goldGained\"]} Drops={d[\"drops\"]}')
" 2>/dev/null
else
  echo -e "\n[6] SKIP: No monsters to fight"
fi

# 7. Use debug_potion
echo -e "\n[7] Use Debug Potion..."
curl -s -X POST "$BASE_URL/api/use" -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"item_id":"debug_potion","action":"use"}' | python3 -c "
import sys,json; d=json.load(sys.stdin); print(f'  {d[\"data\"][\"message\"]}' if d['ok'] else f'  Error: {d[\"error\"]}')
" 2>/dev/null

# 8. Dev event: commit
echo -e "\n[8] Report dev event (commit)..."
curl -s -X POST "$BASE_URL/api/dev-event" -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"commit","data":{"message":"fix: test integration"}}' | python3 -c "
import sys,json; d=json.load(sys.stdin); print(f'  {d[\"data\"][\"message\"]}' if d['ok'] else f'  Error: {d[\"error\"]}')
" 2>/dev/null

# 9. Move back and rest
echo -e "\n[9] Return to The Terminal and rest..."
curl -s -X POST "$BASE_URL/api/move" -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"destination":"spawn_terminal"}' > /dev/null
curl -s -X POST "$BASE_URL/api/rest" -H "$AUTH" | python3 -c "
import sys,json; print(f'  {json.load(sys.stdin)[\"data\"][\"message\"]}')
" 2>/dev/null

# 10. Final status
echo -e "\n[10] Final status..."
curl -s "$BASE_URL/api/status" -H "$AUTH" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
a=d['agent']
print(f'  {a[\"name\"]} ({a[\"class\"]}) Lv.{a[\"level\"]}')
print(f'  HP={a[\"hp\"]}/{a[\"max_hp\"]} Gold={a[\"gold\"]}')
print(f'  Buffs: {[b[\"name\"] for b in d.get(\"active_buffs\",[])]}')" 2>/dev/null

# 11. Dashboard
echo -e "\n[11] Dashboard..."
curl -s "$BASE_URL/api/dashboard" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
ws=d['world_stats']
print(f'  Agents: {ws[\"total_agents\"]} | Monsters: {ws[\"total_monsters\"]} | Kills: {ws[\"total_kills\"]}')
print(f'  Recent events:')
for e in d['recent_events'][:5]:
    print(f'    [{e[\"timestamp\"]}] {e[\"message\"]}')
" 2>/dev/null

echo -e "\n========================================"
echo "  Test Complete!"
echo "========================================"
