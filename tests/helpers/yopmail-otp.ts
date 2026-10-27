import { type BrowserContext, type Page, type FrameLocator, type Locator, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Reads a login OTP out of a yopmail.com inbox in a tab of its own, for an account whose address
 * is a @yopmail.com one and that therefore cannot go through helpers/mailtm.ts.
 *
 * ---------------------------------------------------------------------------------------------
 * IMPORTANT - yopmail gates the inbox behind a Cloudflare Turnstile challenge ("Please confirm
 * you're human to continue"). Verified against the live site on 2026-10-27: with and without a
 * head, the challenge never resolves on its own, the inbox frame answers `window.top.showRc()`
 * and the mail count stays at "-1 mail", so an unattended run CANNOT list the mail. This is the
 * same wall that made helpers/mailtm.ts move off yopmail in the first place.
 *
 * So the challenge is handled instead of wished away:
 *
 *   1. A clearance cookie saved by an earlier run is restored first (see COOKIE_STATE_PATH), which
 *      is what makes later runs unattended.
 *   2. If the challenge still shows, it is given `challengeTimeoutMs` to clear - long enough for a
 *      person watching a `--headed` run to tick the box once. The clearance is then saved for next
 *      time.
 *   3. If it never clears, the helper throws naming the two ways forward instead of timing out on
 *      a blank inbox.
 *
 * Setting INDUS_OTP skips this file altogether (see otpFromEnv), which is the escape hatch for CI.
 * ---------------------------------------------------------------------------------------------
 */

/** Where a solved Turnstile clearance is kept, so a person only has to solve it once. */
const COOKIE_STATE_PATH = path.resolve(__dirname, '../.auth/yopmail-cookies.json');

const YOPMAIL_HOME = 'https://yopmail.com/en/';

/** An OTP supplied directly, which bypasses the inbox entirely. Undefined when unset. */
export function otpFromEnv(): string | undefined {
  const code = process.env.INDUS_OTP?.trim();
  return code ? code : undefined;
}

export type YopmailInbox = {
  /** The yopmail tab, kept open so the INDUS tab can be returned to. */
  page: Page;
  /** Mail ids present before the login, so a code from an earlier run is never reused. */
  knownMailIds: string[];
};

export type OpenInboxOptions = {
  /** How long a person gets to solve the Turnstile challenge in a headed run. */
  challengeTimeoutMs?: number;
};

/**
 * Opens yopmail in a NEW tab of the same context, enters `email`'s alias, opens its inbox and
 * records which mail is already there.
 *
 * Call this BEFORE submitting the INDUS login form: the ids recorded here are what later lets
 * readNewOtp() tell this login's mail apart from an earlier one, which no "newest mail" check on
 * its own can do once a previous run has left an OTP in the same inbox.
 */
export async function openYopmailInbox(
  context: BrowserContext,
  email: string,
  opts: OpenInboxOptions = {},
): Promise<YopmailInbox> {
  const { challengeTimeoutMs = 120_000 } = opts;
  const alias = email.split('@')[0];
  expect(alias, `"${email}" should be a yopmail address`).not.toBe('');

  await restoreClearance(context);

  // A tab of its own, so the INDUS tab keeps its state and can simply be brought back to the front.
  const page = await context.newPage();
  await page.goto(YOPMAIL_HOME, { waitUntil: 'domcontentloaded' });

  // The alias box on the home page; submitting it opens /wm with the inbox frame.
  const aliasBox = page.locator('#login');
  await expect(aliasBox).toBeVisible({ timeout: 30_000 });
  await aliasBox.fill(alias);
  await aliasBox.press('Enter');

  await expect(page).toHaveURL(/yopmail\.com\/en\/wm/, { timeout: 30_000 });
  // The inbox header echoes the address, which is the check that the right inbox opened.
  await expect(page.getByText(email, { exact: true })).toBeVisible({ timeout: 30_000 });

  await passChallenge(page, challengeTimeoutMs);
  await saveClearance(context);

  return { page, knownMailIds: await mailIds(page) };
}

export type ReadOtpOptions = {
  /** Sender/subject the OTP mail is expected to carry. */
  subject?: RegExp;
  /** Regex whose first capture group is the code. */
  pattern?: RegExp;
  /** How long to keep refreshing the inbox before giving up. */
  timeoutMs?: number;
  /** Delay between refreshes. */
  pollMs?: number;
};

/**
 * Refreshes the inbox until a mail that was NOT there before the login turns up, opens it and
 * returns its 6-digit code.
 *
 * Only mail whose id is absent from `inbox.knownMailIds` is considered, so an OTP left by an
 * earlier run can never be picked up - which is the whole reason the ids are snapshotted first.
 */
export async function readNewOtp(inbox: YopmailInbox, opts: ReadOtpOptions = {}): Promise<string> {
  const { subject = /INDUS|OTP|verif/i, pattern = /\b(\d{6})\b/, timeoutMs = 120_000, pollMs = 5_000 } = opts;
  const { page, knownMailIds } = inbox;

  // The yopmail tab has to be the active one for its refresh control to work reliably.
  await page.bringToFront();

  const deadline = Date.now() + timeoutMs;
  let lastSeen = 0;

  while (Date.now() < deadline) {
    const ids = await mailIds(page);
    lastSeen = ids.length;
    // Newest first, as the inbox lists them, so the latest OTP is the one that gets read.
    const fresh = ids.filter((id) => !knownMailIds.includes(id));

    for (const id of fresh) {
      const row = mailRow(page, id);
      const rowText = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (rowText && !subject.test(rowText)) continue;

      await row.click();
      const code = await otpFromOpenMail(page, pattern);
      if (code) {
        // The mail is consumed: remembering it keeps a second call in the same run off this code.
        knownMailIds.push(id);
        return code;
      }
    }

    await refreshInbox(page);
    await page.waitForTimeout(pollMs);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for a new OTP mail in the yopmail inbox ` +
      `(${lastSeen} mail in the inbox, ${knownMailIds.length} of them already there before the login). ` +
      'If the inbox looks empty, yopmail is most likely still showing its Cloudflare challenge.',
  );
}

/** The six-digit code of the mail currently open in the reading pane, if it holds one. */
async function otpFromOpenMail(page: Page, pattern: RegExp): Promise<string | undefined> {
  const mail = page.frameLocator('#ifmail');
  const body = mail.locator('#mail').or(mail.locator('body')).first();
  await expect(body).toBeVisible({ timeout: 30_000 });

  // The code can sit in the mail text or only in the subject line above the pane.
  const texts = [
    await body.innerText().catch(() => ''),
    await page.locator('#mailmillieu, .ellipsis').first().innerText().catch(() => ''),
  ];
  return texts.map((text) => text.match(pattern)?.[1]).find(Boolean);
}

/** Ids of the mail the inbox currently lists, newest first. */
async function mailIds(page: Page): Promise<string[]> {
  const rows = await inboxFrame(page).locator('div.m[id], button.lm[id]').all();
  const ids = await Promise.all(rows.map((row) => row.getAttribute('id')));
  return ids.filter((id): id is string => !!id);
}

/**
 * The inbox row with this id. An attribute selector rather than `#id`, because the ids yopmail
 * generates are not guaranteed to be valid CSS identifiers and `CSS.escape` is a browser global
 * that does not exist in the Node process this helper runs in.
 */
function mailRow(page: Page, id: string): Locator {
  return inboxFrame(page).locator(`[id="${id.replace(/"/g, '\\"')}"]`);
}

function inboxFrame(page: Page): FrameLocator {
  return page.frameLocator('#ifinbox');
}

/** The inbox's own refresh control; yopmail does not poll by itself. */
async function refreshInbox(page: Page) {
  const refresh = page.locator('#refresh');
  if (await refresh.isVisible().catch(() => false)) {
    await refresh.click().catch(() => undefined);
  }
}

/**
 * Waits out the Cloudflare Turnstile gate. Returns once the inbox is readable; throws with both
 * ways forward when it is still showing after `timeoutMs`.
 *
 * "Readable" is the mail counter reporting a real count: "-1 mail" is what the inbox frame shows
 * while the server refuses to list mail, and an empty string means the frame has not reported yet,
 * which must not be mistaken for a cleared challenge. A genuinely empty inbox says "0 mail".
 */
async function passChallenge(page: Page, timeoutMs: number) {
  const counter = page.locator('#nbmail');

  const readable = async () => {
    const text = ((await counter.innerText().catch(() => '')) || '').trim();
    return text !== '' && !text.includes('-1');
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await readable()) return;
    await page.waitForTimeout(2_000);
  }

  throw new Error(
    'yopmail is still showing its Cloudflare "confirm you\'re human" challenge, so the inbox cannot ' +
      'be listed and no OTP can be read.\n' +
      '  - Attended run: use `npm run test:headed`, tick the Cloudflare box in the yopmail tab, and ' +
      'the clearance is saved to tests/.auth/yopmail-cookies.json for later runs.\n' +
      '  - Unattended run: pass the code directly, e.g. $env:INDUS_OTP = "123456" before the run.',
  );
}

/** Puts a previously solved Turnstile clearance back, so a person solves the challenge once. */
async function restoreClearance(context: BrowserContext) {
  if (!fs.existsSync(COOKIE_STATE_PATH)) return;
  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_STATE_PATH, 'utf8'));
    if (Array.isArray(cookies) && cookies.length) await context.addCookies(cookies);
  } catch {
    // A corrupt or stale file is not worth failing the run over; the challenge simply shows again.
  }
}

/** Keeps the yopmail cookies of a readable inbox for the next run. */
async function saveClearance(context: BrowserContext) {
  try {
    const cookies = (await context.cookies()).filter((c) => c.domain.includes('yopmail.com'));
    if (!cookies.length) return;
    fs.mkdirSync(path.dirname(COOKIE_STATE_PATH), { recursive: true });
    fs.writeFileSync(COOKIE_STATE_PATH, JSON.stringify(cookies, null, 2));
  } catch {
    // Saving is an optimisation only.
  }
}
