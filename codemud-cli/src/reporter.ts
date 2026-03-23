import { Config } from './config.js';

export async function reportEvent(config: Config, eventType: string, data: Record<string, unknown> = {}): Promise<any> {
  try {
    const response = await fetch(`${config.server}/api/dev-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`
      },
      body: JSON.stringify({ event_type: eventType, data })
    });
    const result = await response.json();
    if (result.ok) {
      const reward = result.data?.reward_summary || '';
      const msgs: Record<string, string> = {
        commit: `[CodeMud] Commit reported! ${reward}`,
        lint_pass: `[CodeMud] Lint passed! Gained "Focus" buff (ATK +10%)`,
        test_pass: `[CodeMud] Tests passed! Gained "Iron Wall" buff (DEF +15%)`,
        build_fail: `[CodeMud] Build failed! Agent entered "Chaos" state...`,
        merge: `[CodeMud] Merge detected! Random equipment chest opened!`,
        ci_green: `[CodeMud] CI green! Gained "Guardian Shield" (DEF +20%)`,
        ci_red: `[CodeMud] CI failed! All buffs removed...`,
        force_push: `[CodeMud] Force push! Agent teleported to random zone!`,
      };
      console.log(msgs[eventType] || `[CodeMud] Event reported: ${eventType}`);
    } else {
      console.error(`[CodeMud] Error: ${result.error}`);
    }
    return result;
  } catch (err: any) {
    console.error(`[CodeMud] Server unreachable: ${err.message}`);
    return null;
  }
}

export async function getStatus(config: Config): Promise<void> {
  try {
    const response = await fetch(`${config.server}/api/status`, {
      headers: { 'Authorization': `Bearer ${config.token}` }
    });
    const result = await response.json();
    if (result.ok) {
      const a = result.data.agent;
      const s = result.data.stats || {};
      console.log(`\n  ${a.name} (${a.class}) — Lv.${a.level}`);
      console.log(`  HP: ${a.hp}/${a.max_hp}  ATK: ${a.attack}  DEF: ${a.defense}  Gold: ${a.gold}`);
      console.log(`  Location: ${a.location_id}`);
      console.log(`  Stats: STR:${s.str||0} INT:${s.int||0} AGI:${s.agi||0} VIT:${s.vit||0} SPD:${s.spd||0} CHA:${s.cha||0}`);
      const buffs = result.data.active_buffs || [];
      if (buffs.length > 0) {
        console.log(`  Buffs: ${buffs.map((b: any) => `${b.name} (${b.expires_in})`).join(', ')}`);
      }
      console.log();
    } else {
      console.error(`Error: ${result.error}`);
    }
  } catch (err: any) {
    console.error(`Server unreachable: ${err.message}`);
  }
}
