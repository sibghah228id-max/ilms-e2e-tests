import environments from './environments.json';

export type EnvName = keyof typeof environments;
export type Environment = (typeof environments)[EnvName];

export const ENV_NAMES = Object.keys(environments) as EnvName[];

/**
 * Which environment the suite targets. Set TEST_ENV=staging or TEST_ENV=live; defaults to live.
 *
 *   PowerShell:  $env:TEST_ENV = 'staging'; npm test
 *   cmd:         set TEST_ENV=staging && npm test
 *   bash:        TEST_ENV=staging npm test
 */
export function currentEnvName(): EnvName {
  const name = (process.env.TEST_ENV ?? 'live').toLowerCase();
  if (!ENV_NAMES.includes(name as EnvName)) {
    throw new Error(`Unknown TEST_ENV "${name}". Expected one of: ${ENV_NAMES.join(', ')}`);
  }
  return name as EnvName;
}

/** URLs for the active environment (see tests/data/environments.json). */
export const env: Environment = environments[currentEnvName()];

/** Full login URL of the student/company portal, e.g. https://portal-staging.industechconnect.pk/login */
export const portalLoginUrl = env.portal.baseUrl + env.portal.loginPath;

/** Public INDUS marketing website the portal links out to, e.g. https://beta.industechconnect.pk */
export const websiteUrl = env.website.baseUrl;

/** Host of the marketing website without scheme, e.g. beta.industechconnect.pk */
export const websiteHost = new URL(websiteUrl).host;
