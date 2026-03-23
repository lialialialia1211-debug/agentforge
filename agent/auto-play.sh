#!/bin/bash
# AgentForge Auto-Play Test Script
# Usage: bash agent/auto-play.sh <server_url> <agent_name>

SERVER=$1
NAME=$2

if [ -z "$SERVER" ] || [ -z "$NAME" ]; then
  echo "Usage: bash auto-play.sh <server_url> <agent_name>"
  exit 1
fi

# Helper: extract JSON field using python
jq_py() {
  python -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null
}

echo "=== Registering $NAME ==="
REGISTER=$(curl -s -X POST "$SERVER/api/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$NAME\"}")

TOKEN=$(echo "$REGISTER" | jq_py "d['data']['agent']['token']")
if [ -z "$TOKEN" ] || [ "$TOKEN" = "None" ]; then
  ERROR=$(echo "$REGISTER" | jq_py "d.get('error','unknown')")
  echo "Registration failed: $ERROR"
  exit 1
fi
echo "Registered! Token: $TOKEN"

AUTH="Authorization: Bearer $TOKEN"

echo ""
echo "=== Starting game loop (20 turns) ==="

for i in $(seq 1 20); do
  echo ""
  echo "--- Turn $i ---"

  # Check status
  STATUS=$(curl -s "$SERVER/api/status" -H "$AUTH")
  HP=$(echo "$STATUS" | jq_py "d['data']['agent']['hp']")
  MAX_HP=$(echo "$STATUS" | jq_py "d['data']['agent']['max_hp']")
  LOCATION=$(echo "$STATUS" | jq_py "d['data']['agent']['location_id']")
  LEVEL=$(echo "$STATUS" | jq_py "d['data']['agent']['level']")
  GOLD=$(echo "$STATUS" | jq_py "d['data']['agent']['gold']")
  AGENT_STATUS=$(echo "$STATUS" | jq_py "d['data']['agent']['status']")

  echo "Lv.$LEVEL | HP: $HP/$MAX_HP | Gold: $GOLD | Location: $LOCATION | Status: $AGENT_STATUS"

  # If HP low and in town, rest
  if [ "$HP" -lt $((MAX_HP / 3)) ] && [[ "$LOCATION" == *"village"* || "$LOCATION" == *"market"* ]]; then
    echo "-> Resting at town..."
    REST=$(curl -s -X POST "$SERVER/api/rest" -H "$AUTH")
    echo "   $(echo "$REST" | jq_py "d['data']['message']")"
    sleep 3
    continue
  fi

  # If HP low and not in town, retreat
  if [ "$HP" -lt $((MAX_HP / 3)) ]; then
    echo "-> HP low, retreating..."
    # Try using a potion first
    USE=$(curl -s -X POST "$SERVER/api/use" -H "$AUTH" \
      -H "Content-Type: application/json" \
      -d '{"item_id": "hp_potion_s", "action": "use"}')
    USE_OK=$(echo "$USE" | jq_py "d['ok']")
    if [ "$USE_OK" = "True" ]; then
      echo "   $(echo "$USE" | jq_py "d['data']['message']")"
    else
      echo "   No potions, moving to starter_village..."
      curl -s -X POST "$SERVER/api/move" -H "$AUTH" \
        -H "Content-Type: application/json" \
        -d '{"destination": "starter_village"}' > /dev/null
    fi
    sleep 3
    continue
  fi

  # If in town with decent HP, go hunt
  if [[ "$LOCATION" == *"village"* || "$LOCATION" == *"market"* ]]; then
    echo "-> Heading to dark_forest..."
    MOVE=$(curl -s -X POST "$SERVER/api/move" -H "$AUTH" \
      -H "Content-Type: application/json" \
      -d '{"destination": "dark_forest"}')
    echo "   $(echo "$MOVE" | jq_py "d['data']['message']")"
    sleep 3
    continue
  fi

  # In wild area, look for monsters
  LOOK=$(curl -s "$SERVER/api/look" -H "$AUTH")
  MONSTER_INFO=$(echo "$LOOK" | python -c "
import sys,json
d=json.load(sys.stdin)
ms=d['data']['monsters']
if ms:
    m=min(ms, key=lambda x: x['level'])
    print(f\"{m['id']}|{m['name']}|Lv.{m['level']}|HP:{m['current_hp']}/{m['max_hp']}\")
else:
    print('NONE')
" 2>/dev/null)

  if [ "$MONSTER_INFO" != "NONE" ] && [ -n "$MONSTER_INFO" ]; then
    MONSTER_ID=$(echo "$MONSTER_INFO" | cut -d'|' -f1)
    MONSTER_DESC=$(echo "$MONSTER_INFO" | cut -d'|' -f2-)
    echo "-> Attacking $MONSTER_DESC..."

    RESULT=$(curl -s -X POST "$SERVER/api/attack" -H "$AUTH" \
      -H "Content-Type: application/json" \
      -d "{\"target\": \"$MONSTER_ID\"}")

    COMBAT_RESULT=$(echo "$RESULT" | jq_py "d['data']['result']")

    if [ "$COMBAT_RESULT" = "victory" ]; then
      SUMMARY=$(echo "$RESULT" | python -c "
import sys,json
r=json.load(sys.stdin)['data']
parts=[f'Victory! +{r[\"expGained\"]} EXP, +{r[\"goldGained\"]} gold']
if r.get('drops'):
    parts.append(f'Drops: {[x[\"item_id\"] for x in r[\"drops\"]]}')
if r.get('leveledUp'):
    parts.append(f'*** LEVEL UP to {r[\"newLevel\"]}! ***')
parts.append(f'HP: {r[\"agentHpAfter\"]}')
print(' | '.join(parts))
" 2>/dev/null)
      echo "   $SUMMARY"
    else
      echo "   Defeated! Lost gold, respawning at starter_village..."
    fi
  else
    echo "-> No monsters here, waiting for respawn..."
  fi

  sleep 3
done

echo ""
echo "=== Final Status ==="
STATUS=$(curl -s "$SERVER/api/status" -H "$AUTH")
echo "$STATUS" | python -c "
import sys,json
d=json.load(sys.stdin)
a=d['data']['agent']
print(f'Name: {a[\"name\"]}')
print(f'Level: {a[\"level\"]} | EXP: {a[\"exp\"]}/{a[\"exp_to_next\"]}')
print(f'HP: {a[\"hp\"]}/{a[\"max_hp\"]}')
print(f'ATK: {d[\"data\"][\"effective_attack\"]} | DEF: {d[\"data\"][\"effective_defense\"]}')
print(f'Gold: {a[\"gold\"]}')
print(f'Location: {a[\"location_id\"]}')
print('Inventory:')
for item in d['data']['inventory']:
    eq=' [EQUIPPED]' if item['equipped'] else ''
    print(f'  - {item[\"name\"]} x{item[\"quantity\"]}{eq}')
" 2>/dev/null
