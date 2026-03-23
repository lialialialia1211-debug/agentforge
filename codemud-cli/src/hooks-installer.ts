import fs from 'fs';
import path from 'path';
import { Config } from './config.js';

function findGitDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return path.join(dir, '.git');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function installHooks(config: Config): void {
  const gitDir = findGitDir();
  if (!gitDir) {
    console.error('Not a git repository!');
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const postCommit = `#!/bin/sh
# CodeMud — Auto-report commits
MSG=$(git log -1 --pretty=%s)
curl -s -X POST "${config.server}/api/dev-event" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${config.token}" \\
  -d "{\\"event_type\\":\\"commit\\",\\"data\\":{\\"message\\":\\"$MSG\\"}}" > /dev/null 2>&1 &
echo "[CodeMud] Commit reported!"
`;

  const postMerge = `#!/bin/sh
# CodeMud — Auto-report merges
curl -s -X POST "${config.server}/api/dev-event" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${config.token}" \\
  -d "{\\"event_type\\":\\"merge\\"}" > /dev/null 2>&1 &
echo "[CodeMud] Merge reported — equipment chest opened!"
`;

  const commitPath = path.join(hooksDir, 'post-commit');
  const mergePath = path.join(hooksDir, 'post-merge');

  fs.writeFileSync(commitPath, postCommit, { mode: 0o755 });
  fs.writeFileSync(mergePath, postMerge, { mode: 0o755 });

  console.log('[CodeMud] Git hooks installed!');
  console.log('  post-commit: Reports commits -> +1 skill point');
  console.log('  post-merge:  Reports merges  -> Random equipment chest');
}

export function removeHooks(): void {
  const gitDir = findGitDir();
  if (!gitDir) {
    console.error('Not a git repository!');
    return;
  }

  const hooksDir = path.join(gitDir, 'hooks');
  for (const hook of ['post-commit', 'post-merge']) {
    const p = path.join(hooksDir, hook);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      if (content.includes('CodeMud')) {
        fs.unlinkSync(p);
        console.log(`[CodeMud] Removed ${hook} hook`);
      }
    }
  }
  console.log('[CodeMud] Git hooks removed.');
}
