#!/bin/bash
# AgentForge Integration Test Script
# Tests the complete game loop: register → move → fight → loot → use items → rest → dashboard

BASE_URL="http://localhost:3000"

echo "========================================"
echo "  AgentForge Integration Test"
echo "========================================"

# 1. Register
echo -e "\n[1] Register new agent..."
REGISTER=$(curl -s -X POST "$BASE_URL/api/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"TestBot_$(date +%s)\"}")
echo "$REGISTER" | python -m json.tool 2>/dev/null | head -10

TOKEN=$(echo "$REGISTER" | python -c "import sys,json; print(json.load(sys.stdin)['data']['agent']['token'])" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "FAIL: Could not register. Aborting."
  exit 1
fi
AUTH="Authorization: Bearer $TOKEN"
echo "Token: $TOKEN"

# 2. Status
echo -e "\n[2] Check status..."
curl -s "$BASE_URL/api/status" -H "$AUTH" | python -c "
import sys,json
d=json.load(sys.stdin)['data']
a=d['agent']
print(f'  Level={a[\"level\"]} HP={a[\"hp\"]}/{a[\"max_hp\"]} ATK={d[\"effective_attack\"]} DEF={d[\"effective_defense\"]} Gold={a[\"gold\"]}')
" 2>/dev/null

# 3. Look around (starter_village)
echo -e "\n[3] Look around (starter_village)..."
curl -s "$BASE_URL/api/look" -H "$AUTH" | python -c "
import sys,json
d=json.load(sys.stdin)['data']
print(f'  Location: {d[\"location\"][\"id\"]} ({d[\"location\"][\"type\"]})')
print(f'  Monsters: {len(d[\"monsters\"])}')
print(f'  Exits: {[e[\"id\"] for e in d[\"exits\"]]}')
" 2>/dev/null

# 4. Move to dark_forest
echo -e "\n[4] Move to dark_forest..."
curl -s -X POST "$BASE_URL/api/move" -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"destination":"dark_forest"}' | python -c "
import sys,json; print(f'  {json.load(sys.stdin)[\"data\"][\"message\"]}')
" 2>/dev/null

# 5. Look for monsters
echo -e "\n[5] Look for monsters..."
LOOK=$(curl -s "$BASE_URL/api/look" -H "$AUTH")
echo "$LOOK" | python -c "
import sys,json
d=json.load(sys.stdin)['data']
print(f'  Monsters at dark_forest:')
for m in d['monsters']:
    print(f'    - {m[\"name\"]} (Lv.{m[\"level\"]}) HP={m[\"current_hp\"]}/{m[\"max_hp\"]}')
" 2>/dev/null

MONSTER_ID=$(echo "$LOOK" | python -c "
import sys,json
ms=json.load(sys.stdin)['data']['monsters']
# Prefer slime for safety
slimes=[m for m in ms if m['name']=='Slime']
print(slimes[0]['id'] if slimes else (ms[0]['id'] if ms else ''))
" 2>/dev/null)

# 6. Attack
if [ -n "$MONSTER_ID" ]; then
  echo -e "\n[6] Attack monster ($MONSTER_ID)..."
  ATTACK=$(curl -s -X POST "$BASE_URL/api/attack" -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"target\":\"$MONSTER_ID\"}")
  echo "$ATTACK" | python -c "
import sys,json
d=json.load(sys.stdin)['data']
print(f'  Result: {d[\"result\"]}')
for log in d['combatLog']:
    print(f'    {log}')
if d['result'] == 'victory':
    print(f'  EXP+{d[\"expGained\"]} Gold+{d[\"goldGained\"]} Drops={d[\"drops\"]}')
    print(f'  HP after: {d[\"agentHpAfter\"]} LevelUp: {d[\"leveledUp\"]}')
" 2>/dev/null
else
  echo -e "\n[6] SKIP: No monsters to fight"
fi

# 7. Use potion
echo -e "\n[7] Use Small HP Potion..."
curl -s -X POST "$BASE_URL/api/use" -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"item_id":"hp_potion_s","action":"use"}' | python -c "
import sys,json; d=json.load(sys.stdin); print(f'  {d[\"data\"][\"message\"]}' if d['ok'] else f'  Error: {d[\"error\"]}')
" 2>/dev/null

# 8. Move back to village and rest
echo -e "\n[8] Return to starter_village and rest..."
curl -s -X POST "$BASE_URL/api/move" -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"destination":"starter_village"}' > /dev/null
curl -s -X POST "$BASE_URL/api/rest" -H "$AUTH" | python -c "
import sys,json; print(f'  {json.load(sys.stdin)[\"data\"][\"message\"]}')
" 2>/dev/null

# 9. Final status
echo -e "\n[9] Final status..."
curl -s "$BASE_URL/api/status" -H "$AUTH" | python -c "
import sys,json
d=json.load(sys.stdin)['data']
a=d['agent']
print(f'  Level={a[\"level\"]} HP={a[\"hp\"]}/{a[\"max_hp\"]} EXP={a[\"exp\"]}/{a[\"exp_to_next\"]} Gold={a[\"gold\"]}')
print(f'  ATK={d[\"effective_attack\"]} DEF={d[\"effective_defense\"]}')
print(f'  Inventory:')
for i in d['inventory']:
    eq = ' [EQUIPPED]' if i['equipped'] else ''
    print(f'    - {i[\"name\"]} x{i[\"quantity\"]}{eq}')
" 2>/dev/null

# 10. Dashboard
echo -e "\n[10] Dashboard..."
curl -s "$BASE_URL/api/dashboard" | python -c "
import sys,json
d=json.load(sys.stdin)['data']
ws=d['world_stats']
print(f'  Agents: {ws[\"total_agents\"]} | Monsters: {ws[\"total_monsters\"]} | Kills: {ws[\"total_kills\"]}')
print(f'  Recent events:')
for e in d['recent_events'][:5]:
    print(f'    [{e[\"timestamp\"]}] {e[\"message\"]}')
" 2>/dev/null

# 11. Error cases
echo -e "\n[11] Error cases..."
echo "  Bad auth:"
curl -s "$BASE_URL/api/status" -H "Authorization: Bearer bad" | python -c "import sys,json; print(f'    {json.load(sys.stdin)}')" 2>/dev/null

echo "  Invalid move:"
curl -s -X POST "$BASE_URL/api/move" -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"destination":"abandoned_graveyard"}' | python -c "import sys,json; print(f'    {json.load(sys.stdin)}')" 2>/dev/null

echo "  Duplicate name:"
curl -s -X POST "$BASE_URL/api/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$(echo "$REGISTER" | python -c "import sys,json; print(json.load(sys.stdin)['data']['agent']['name'])" 2>/dev/null)\"}" | python -c "import sys,json; print(f'    {json.load(sys.stdin)}')" 2>/dev/null

echo -e "\n========================================"
echo "  Test Complete!"
echo "========================================"
