import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.codemud');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface Config {
  server: string;
  token: string;
  agent_name: string;
  heartbeat_interval: number;
}

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error('CodeMud not initialized. Run: codemud init --server URL --token TOKEN');
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}
