import { execFileSync } from 'child_process';
import { Config } from './config.js';
import { reportEvent } from './reporter.js';

let lastCommitHash = '';
let watchInterval: ReturnType<typeof setInterval> | null = null;

function getHeadHash(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

async function checkGitChanges(config: Config): Promise<void> {
  try {
    const currentHash = getHeadHash();
    if (!currentHash || currentHash === lastCommitHash) return;

    // Get commit messages since last check
    const log = execFileSync(
      'git',
      ['log', `${lastCommitHash}..${currentHash}`, '--pretty=format:%s', '--no-merges'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    const mergeLog = execFileSync(
      'git',
      ['log', `${lastCommitHash}..${currentHash}`, '--pretty=format:%s', '--merges'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    // Report commits
    if (log) {
      for (const msg of log.split('\n').filter(Boolean)) {
        await reportEvent(config, 'commit', { message: msg });
      }
    }

    // Report merges
    if (mergeLog) {
      for (const msg of mergeLog.split('\n').filter(Boolean)) {
        await reportEvent(config, 'merge', { message: msg });
      }
    }

    lastCommitHash = currentHash;
  } catch {
    // Silent fail
  }
}

export function startGitWatcher(config: Config): void {
  const hash = getHeadHash();
  if (!hash) {
    console.log('[CodeMud] Not a git repo, git watcher disabled.');
    return;
  }
  lastCommitHash = hash;
  console.log('[CodeMud] Git watcher started.');
  watchInterval = setInterval(() => checkGitChanges(config), 10000);
}

export function stopGitWatcher(): void {
  if (watchInterval) clearInterval(watchInterval);
}
