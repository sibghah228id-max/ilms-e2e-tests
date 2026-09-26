import { type Browser, type Page, expect } from '@playwright/test';

const YOPMAIL_URL = 'https://yopmail.com/wm';

export type OtpOptions = {
  /** Subject (or part of it) the OTP mail must have. */
  subject?: string | RegExp;
  /** Regex whose first capture group is the OTP. */
  pattern?: RegExp;
  /** How long to keep refreshing the inbox before giving up. */
  timeoutMs?: number;
};

/**
 * Opens the yopmail inbox for `inbox` in a fresh browser context, waits for the OTP mail
 * to arrive (refreshing the inbox), and returns the 6-digit code.
 *
 * A separate context keeps yopmail cookies away from the portal session.
 */
export async function fetchOtpFromYopmail(browser: Browser, inbox: string, opts: OtpOptions = {}): Promise<string> {
  const { subject = /OTP/i, pattern = /\b(\d{6})\b/, timeoutMs = 90_000 } = opts;

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await openInbox(page, inbox);

    const deadline = Date.now() + timeoutMs;
    let lastError = 'no mail matched';

    while (Date.now() < deadline) {
      const code = await readOtp(page, subject, pattern);
      if (code) return code;

      lastError = `no mail with subject ${subject} containing ${pattern} yet`;
      await page.locator('#refresh').click();
      await page.waitForTimeout(3_000);
    }

    throw new Error(`Timed out after ${timeoutMs}ms waiting for OTP in yopmail inbox "${inbox}": ${lastError}`);
  } finally {
    await context.close();
  }
}

async function openInbox(page: Page, inbox: string) {
  await page.goto(YOPMAIL_URL, { waitUntil: 'domcontentloaded' });

  // Cookie/consent banners sometimes appear; decline rather than accept.
  const decline = page.getByRole('button', { name: /reject|decline|refuse/i }).first();
  if (await decline.isVisible().catch(() => false)) await decline.click();

  const login = page.locator('#login');
  await login.fill(inbox);
  await login.press('Enter');

  await expect(page.frameLocator('#ifinbox').locator('body')).toBeVisible({ timeout: 30_000 });
}

/** Returns the OTP if a matching mail is already in the inbox, else null. */
async function readOtp(page: Page, subject: string | RegExp, pattern: RegExp): Promise<string | null> {
  const inbox = page.frameLocator('#ifinbox');
  const mail = inbox.locator('.m').filter({ hasText: subject }).first();

  if (!(await mail.isVisible().catch(() => false))) return null;

  await mail.click();

  const body = page.frameLocator('#ifmail').locator('#mail');
  await expect(body).toBeVisible({ timeout: 15_000 });

  const text = await body.innerText();
  const match = text.match(pattern);
  return match ? match[1] : null;
}
