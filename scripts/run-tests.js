// Runs Playwright against a chosen environment, e.g.
//   npm test staging
//   npm run test:report live
//   npm run test:headed staging -- tests/auth
//
// The first argument that names an environment in tests/data/environments.json selects it
// (default: TEST_ENV, then "live"). Every other argument is passed straight to `playwright test`.
// `--report` (used by npm run test:report) opens the HTML report after the run, pass or fail.
const { spawnSync } = require('child_process');
const path = require('path');

const environments = require(path.join(__dirname, '..', 'tests', 'data', 'environments.json'));
const envNames = Object.keys(environments);

const args = process.argv.slice(2);
const showReport = args.includes('--report');
const envIndex = args.findIndex((a) => envNames.includes(a.toLowerCase()));

// A bare word (no path separators or dots) that is not an environment is almost certainly a typo.
const firstPositional = args.find((a) => !a.startsWith('-'));
if (envIndex < 0 && firstPositional && /^[a-z][a-z0-9_-]*$/i.test(firstPositional)) {
  console.error(`Unknown environment "${firstPositional}". Expected one of: ${envNames.join(', ')}`);
  process.exit(1);
}
const envName = envIndex >= 0 ? args[envIndex].toLowerCase() : (process.env.TEST_ENV || 'live').toLowerCase();

if (!envNames.includes(envName)) {
  console.error(`Unknown environment "${envName}". Expected one of: ${envNames.join(', ')}`);
  process.exit(1);
}

const playwrightArgs = args.filter((a, i) => i !== envIndex && a !== '--report');
const env = { ...process.env, TEST_ENV: envName };
const cli = require.resolve('@playwright/test/cli');

console.log(`[e2e] environment: ${envName} (${environments[envName].portal.baseUrl})`);

const run = spawnSync(process.execPath, [cli, 'test', ...playwrightArgs], { stdio: 'inherit', env });

if (showReport) {
  spawnSync(process.execPath, [cli, 'show-report'], { stdio: 'inherit', env });
}

process.exit(run.status ?? 1);
