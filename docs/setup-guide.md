# CodeMud — Developer Integration Setup Guide

> Write code. Get stronger.

## Quick Overview

CodeMud connects your real coding activity to your in-game Agent. Three ways to integrate:

| Method | Effort | Features |
|--------|--------|----------|
| CLAUDE.md | Copy-paste | Claude Code auto-reports commits/lint/test |
| Git Hooks | 1 command | Auto-report on every git commit/merge |
| CLI Tool | Full setup | Heartbeat + git watch + manual reports |

---

## Method 1: CLAUDE.md Integration (Easiest)

Best for: Claude Code users who want zero-config integration.

### Steps

1. Register your agent and get your token
2. Visit: `SERVER_URL/api/claude-md?token=YOUR_TOKEN`
3. Copy the returned markdown
4. Paste it into your project's `CLAUDE.md` file
5. Done! Claude Code will auto-report dev events

### What happens

Claude Code reads your CLAUDE.md and automatically runs curl commands after:
- `git commit` → +1 skill point, bonus gold for "fix:" commits
- `lint pass` → Focus buff (ATK +10%, 10 min)
- `test pass` → Iron Wall buff (DEF +15%, 10 min)
- `build fail` → Chaos debuff (20% miss chance, 5 min)
- `merge` → Random green+ equipment drop

---

## Method 2: Git Hooks (Simple)

Best for: Auto-reporting every commit without any background process.

### Steps

```bash
cd /path/to/your/project

# Initialize (one time)
node /path/to/codemud-cli/bin/codemud.js init \
  --server SERVER_URL \
  --token YOUR_TOKEN \
  --name "YOUR_AGENT_NAME"

# Install hooks
node /path/to/codemud-cli/bin/codemud.js hooks install
```

Now every `git commit` and `git merge` in this repo will auto-report to CodeMud.

### Remove hooks

```bash
node /path/to/codemud-cli/bin/codemud.js hooks remove
```

---

## Method 3: CLI Tool (Full Features)

Best for: Always-on monitoring with heartbeat (Agent goes to sleep when you stop coding).

### Setup

```bash
# Initialize
node /path/to/codemud-cli/bin/codemud.js init \
  --server SERVER_URL \
  --token YOUR_TOKEN \
  --name "YOUR_AGENT_NAME"

# Start watching (keeps running in background)
node /path/to/codemud-cli/bin/codemud.js watch
```

### What `watch` does

- Sends heartbeat every 30 seconds (Agent stays "online")
- Watches git for new commits/merges (auto-reports)
- When you Ctrl+C: sends "offline" signal, Agent goes to sleep
- If no heartbeat for 2 minutes: Agent auto-sleeps

### Manual commands

```bash
# Check agent status
codemud status

# Report events manually
codemud report commit "fix: resolve auth bug"
codemud report lint_pass
codemud report test_pass
codemud report build_fail
codemud report merge
codemud report ci_green
codemud report ci_red
```

---

## Method 4: CI/CD Integration

Add to your CI pipeline:

```yaml
# GitHub Actions example
- name: Report to CodeMud
  if: success()
  run: |
    curl -s -X POST ${{ secrets.CODEMUD_SERVER }}/api/dev-event \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${{ secrets.CODEMUD_TOKEN }}" \
      -d '{"event_type": "ci_green"}'

- name: Report CI failure to CodeMud
  if: failure()
  run: |
    curl -s -X POST ${{ secrets.CODEMUD_SERVER }}/api/dev-event \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${{ secrets.CODEMUD_TOKEN }}" \
      -d '{"event_type": "ci_red"}'
```

---

## Event Rewards Reference

| Event | Reward |
|-------|--------|
| commit | +1 skill point. "fix:" → +10 gold. "feat:" → +20 EXP |
| test_pass | Buff: Iron Wall (DEF +15%, 10 min) |
| lint_pass | Buff: Focus (ATK +10%, 10 min) |
| build_fail | Debuff: Chaos (20% miss chance, 5 min) |
| merge | Random green+ equipment drop |
| ci_green | Buff: Guardian Shield (DEF +20%, 15 min) |
| ci_red | All buffs removed |
| force_push | Teleported to random zone! |

---

## Dashboard

Open in browser: `SERVER_URL`

Press F for fullscreen spectate mode.
