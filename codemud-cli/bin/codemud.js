#!/usr/bin/env node
// Thin wrapper — runs src/cli.ts via tsx in dev mode
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, '../src/cli.ts');

const result = spawnSync(
  'npx',
  ['tsx', cliPath, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    cwd: resolve(__dirname, '..'),
    shell: true   // required on Windows for npx resolution
  }
);

process.exit(result.status ?? 1);
