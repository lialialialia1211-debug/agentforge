import { Command } from 'commander';
import { loadConfig, saveConfig, configExists } from './config.js';
import { reportEvent, getStatus } from './reporter.js';
import { startHeartbeat } from './heartbeat.js';
import { startGitWatcher } from './git-watcher.js';
import { installHooks, removeHooks } from './hooks-installer.js';

const program = new Command();

program
  .name('codemud')
  .description('CodeMud CLI — Write code. Get stronger.')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize CodeMud with server URL and agent token')
  .requiredOption('--server <url>', 'CodeMud server URL')
  .requiredOption('--token <token>', 'Your agent token')
  .option('--name <name>', 'Agent name', 'Agent')
  .action((opts) => {
    saveConfig({
      server: opts.server.replace(/\/$/, ''),
      token: opts.token,
      agent_name: opts.name,
      heartbeat_interval: 30,
    });
    console.log('[CodeMud] Initialized! Config saved to ~/.codemud/config.json');
    console.log(`  Server: ${opts.server}`);
    console.log(`  Token: ${opts.token.slice(0, 8)}...`);
    console.log('\nNext steps:');
    console.log('  codemud watch       Start background monitoring');
    console.log('  codemud hooks install   Install git hooks');
    console.log('  codemud status      Check your agent');
  });

program
  .command('watch')
  .description('Start background monitoring (heartbeat + git watcher)')
  .action(() => {
    const config = loadConfig();
    console.log(`[CodeMud] Starting watch mode for ${config.agent_name}...`);
    console.log(`[CodeMud] Server: ${config.server}`);
    console.log('[CodeMud] Press Ctrl+C to stop (agent will go to sleep)\n');
    startHeartbeat(config);
    startGitWatcher(config);
  });

program
  .command('status')
  .description('Check your agent status')
  .action(async () => {
    const config = loadConfig();
    await getStatus(config);
  });

program
  .command('report <type> [message]')
  .description('Manually report a dev event (commit, lint_pass, test_pass, build_fail, merge, ci_green, ci_red)')
  .action(async (type: string, message?: string) => {
    const config = loadConfig();
    const data: Record<string, unknown> = {};
    if (message) data.message = message;
    await reportEvent(config, type, data);
  });

const hooks = program.command('hooks').description('Manage git hooks');

hooks
  .command('install')
  .description('Install post-commit and post-merge hooks')
  .action(() => {
    const config = loadConfig();
    installHooks(config);
  });

hooks
  .command('remove')
  .description('Remove CodeMud git hooks')
  .action(() => {
    removeHooks();
  });

program.parse();
