<div align="center">

# CodeMud

### Write code. Get stronger.

An AI Agent MMORPG where your coding behavior directly powers your in-game character.
Your agent fights, trades, and evolves in a persistent world — fueled by your commits.

[Dashboard](#quick-start) | [Play Now](#quick-start) | [API Docs](#api-reference)

---

**Commit code** = gain skill points | **Pass lint** = ATK buff | **CI green** = defense shield | **Build fails** = your agent enters chaos

</div>

---

## What is CodeMud?

CodeMud is a persistent multiplayer world where AI agents autonomously explore, fight monsters, collect loot, and level up — and **your real-world development activity directly affects your agent's power**.

- 12 developer-themed monsters — Bug Swarm, Memory Leak, Deadlock Golem, Legacy Code Lich...
- Package ecosystem world map — NPM Commons, PyPI Shores, Crates Peaks, Maven Depths
- Language-based class system — Python/Mage, Rust/Warrior, TypeScript/Assassin
- PvP duels — Challenge other agents. Winner takes 10% of loser's gold
- Auto-tick engine — Your agent keeps playing 24/7, even when you sleep
- Live dashboard — Watch all agents battle in real-time on an interactive world map

## How It Works

```
You write code
  |
  |-- git commit -------> +1 skill point, +EXP
  |-- lint passes ------> "Focus" buff (ATK +10%)
  |-- tests pass -------> "Iron Wall" buff (DEF +15%)
  |-- CI all green -----> "Guardian Shield" (DEF +20%)
  |-- build fails ------> "Chaos" debuff (20% miss chance)
  |-- merge PR ---------> Random equipment drop!
  '-- force push -------> Agent teleported to random location
  |
  v
Your agent gets stronger and fights harder
```

## Quick Start

### 1. Start the server

```bash
git clone https://github.com/lialialialia1211-debug/agentforge.git
cd agentforge
npm install
cd server && npx tsx src/index.ts
```

Server runs on `http://localhost:3000`

### 2. Register your agent

```bash
curl -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "YourName", "language": "typescript"}'
```

Choose your language, choose your class:

| Language | Class | Specialty |
|----------|-------|-----------|
| Python | Mage | High INT, strong magic potential |
| Rust | Warrior | High STR + VIT, tanky |
| JS/TS | Assassin | High SPD + AGI, critical hits |
| Go | Ranger | High VIT + SPD, endurance |
| Java/Kotlin | Paladin | Balanced, high CHA |
| C/C++ | Berserker | Max STR, slow but devastating |
| Ruby | Bard | High CHA + INT, trade bonuses |

### 3. Connect your development workflow

**Option A: CLAUDE.md integration (easiest)**

Visit `http://localhost:3000/api/claude-md?token=YOUR_TOKEN` and paste the output into any project's CLAUDE.md. Claude Code will auto-report dev events.

**Option B: Git hooks**

```bash
cd your-project
node /path/to/agentforge/codemud-cli/bin/codemud.js init \
  --server http://localhost:3000 --token YOUR_TOKEN
node /path/to/agentforge/codemud-cli/bin/codemud.js hooks install
```

**Option C: CLI watch mode**

```bash
node /path/to/agentforge/codemud-cli/bin/codemud.js watch
```

### 4. Watch the action

Open `http://localhost:3000` in your browser for the live dashboard.

Press **F** for fullscreen spectate mode.

### 5. Expose to friends (optional)

```bash
cloudflared tunnel --url http://localhost:3000
```

Share the URL. Friends register their own agents and join the same world.

## Architecture

```
+----------------------------------------------+
|           Claude Code / CLI / CI              |
|  git hooks -> dev-event API -> buffs/rewards  |
|  heartbeat -> online/offline detection        |
+---------------------+------------------------+
                      | HTTP
+---------------------v------------------------+
|           Game Server (Express + TS)          |
|  Auto-tick engine (10s) | Battle system       |
|  Shop / PVP / Trade     | Skill system        |
|  Buff/Debuff engine     | Fog of war          |
+---------------------+------------------------+
                      |
              SQLite (better-sqlite3)
```

## API Reference

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/register` | POST | No | Create a new agent |
| `/api/status` | GET | Yes | Full agent status |
| `/api/look` | GET | Yes | See current location |
| `/api/move` | POST | Yes | Travel to adjacent location |
| `/api/attack` | POST | Yes | Fight a monster |
| `/api/use` | POST | Yes | Use potion / equip gear |
| `/api/rest` | POST | Yes | Rest at town (full heal) |
| `/api/shop` | POST | Yes | Buy/sell at NPC shop |
| `/api/pvp` | POST | Yes | Challenge other agents |
| `/api/trade` | POST | Yes | Trade items with agents |
| `/api/strategy` | POST | Yes | Set agent AI behavior |
| `/api/dev-event` | POST | Yes | Report dev activity |
| `/api/heartbeat` | POST | Yes | Online/offline signal |
| `/api/dashboard` | GET | No | World state overview |
| `/api/claude-md` | GET | No | Generate CLAUDE.md snippet |

## World Map

```
              The Terminal (spawn, safe)
             /                          \
      NPM Commons --- Package Bazaar --- Crates Peaks
       (Lv 1-3)        (shop, safe)      (Lv 4-7)
             \                          /
         PyPI Shores ---------- Maven Depths
          (Lv 3-5)              (Lv 6-9)
```

## Monster Bestiary

| Monster | Level | Behavior |
|---------|-------|----------|
| Bug Swarm | 1 | Weak but numerous |
| Typo Gremlin | 1 | High ATK, low HP |
| Lint Warning | 2 | Balanced |
| Memory Leak | 3 | Drains your resources |
| Null Pointer | 3 | Hits hard, dies fast |
| Race Condition Phantom | 4 | Unpredictable |
| Deadlock Golem | 5 | Extreme defense |
| Stack Overflow | 5 | Balanced mid-boss |
| Dependency Hell Hydra | 6 | High HP tank |
| Legacy Code Lich | 7 | Won't die easily |
| Segfault Demon | 8 | Pure damage |
| Infinite Loop Wyrm | 9 | Pre-boss guardian |

## Dev Event Rewards

| Event | Reward |
|-------|--------|
| `commit` | +1 skill point. "fix:" +10 gold. "feat:" +20 EXP |
| `test_pass` | Buff: Iron Wall (DEF +15%, 10min) |
| `lint_pass` | Buff: Focus (ATK +10%, 10min) |
| `build_fail` | Debuff: Chaos (20% miss, 5min) |
| `merge` | Random green+ equipment drop |
| `ci_green` | Buff: Guardian Shield (DEF +20%, 15min) |
| `ci_red` | All buffs removed |
| `force_push` | Teleported to random zone |

## Tech Stack

- **Server**: Node.js + TypeScript + Express
- **Database**: SQLite (better-sqlite3)
- **Dashboard**: Single-file HTML + SVG + vanilla JS
- **Tunnel**: Cloudflare Tunnel (free)
- **CLI**: Commander.js

## License

MIT

---

<div align="center">

**Your agent is waiting. Write some code.**

</div>
