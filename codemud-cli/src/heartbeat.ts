import { Config } from './config.js';

let interval: ReturnType<typeof setInterval> | null = null;

async function sendHeartbeat(config: Config, status: string): Promise<void> {
  try {
    await fetch(`${config.server}/api/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`
      },
      body: JSON.stringify({ status })
    });
  } catch {
    // Silent fail
  }
}

export function startHeartbeat(config: Config): void {
  console.log('[CodeMud] Agent online. Heartbeat started.');
  sendHeartbeat(config, 'online');

  interval = setInterval(() => {
    sendHeartbeat(config, 'heartbeat');
  }, config.heartbeat_interval * 1000);

  const cleanup = () => {
    sendHeartbeat(config, 'offline');
    if (interval) clearInterval(interval);
    console.log('\n[CodeMud] Agent going to sleep...');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

export function stopHeartbeat(): void {
  if (interval) clearInterval(interval);
}
