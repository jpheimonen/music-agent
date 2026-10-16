import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const unit = 'music-agent.service';
const action = process.argv[2];
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  return result.status ?? 1;
};

if (action === 'start') {
  // A user service survives the launching terminal and is supervised by systemd.
  const status = run('systemd-run', [
    '--user', `--unit=${unit}`, '--collect',
    `--working-directory=${root}`, '--property=Restart=on-failure',
    '--property=RestartSec=3',
    ...['PATH', 'MUSIC_PORT', 'MUSIC_LIBRARY_ROOT', 'MUSIC_DATA_DIR', 'MUSIC_CODEX_HOME',
      'CODEX_HOME', 'MUSIC_CODEX_BIN', 'MUSIC_YTDLP_BIN',
      'MUSIC_STATION_KEXP_URL', 'MUSIC_STATION_YLE1_URL',
      'MUSIC_STATION_RADIO_HELSINKI_URL']
      .filter(name => process.env[name] !== undefined)
      .map(name => `--setenv=${name}=${process.env[name]}`),
    process.execPath, `${root}apps/server/dist/index.js`,
  ]);
  if (status === 0) console.log('Music is starting at http://127.0.0.1:' + (process.env.MUSIC_PORT || '8787'));
  process.exitCode = status;
} else if (action === 'stop' || action === 'status') {
  process.exitCode = run('systemctl', ['--user', action, unit]);
} else if (action === 'logs') {
  process.exitCode = run('journalctl', ['--user', '-u', unit, '-n', '80', '--no-pager']);
} else {
  console.error('Usage: node scripts/service.mjs start|stop|status|logs');
  process.exitCode = 1;
}
