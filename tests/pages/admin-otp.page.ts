import { type Page, type Locator, expect } from '@playwright/test';

/** Master admin OTP step: /securecontroller/otp (one 6-digit text input, emailed or fixed code). */
export class AdminOtpPage {
  readonly heading: Locator;
  readonly input: Locator;
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = this.page.getByRole('heading', { name: 'Enter verification code' });
    this.input = this.page.getByLabel('Verification code');
    this.submitButton = this.page.getByRole('button', { name: 'Verify & Continue' });
  }

  async expectVisible() {
    await expect(this.page).toHaveURL(/\/securecontroller\/otp/);
    await expect(this.heading).toBeVisible();
    await expect(this.input).toBeVisible();
  }

  /**
   * Enters the code and waits for the panel to leave the OTP page.
   *
   * The panel posts the form by itself as soon as six digits are typed, so the submit button is
   * only clicked when that auto-submit did not happen. A rejected code re-renders this page with
   * an error ("Wrong code. N attempt(s) left."), which is surfaced instead of a bare URL timeout.
   * The panel locks the account after five wrong codes, so callers must never retry blindly.
   */
  async verify(code: string) {
    expect(code, 'admin OTP must be 6 digits').toMatch(/^\d{6}$/);

    const autoSubmitted = this.page
      .waitForResponse((r) => /\/securecontroller\/otp$/.test(r.url()) && r.request().method() === 'POST', {
        timeout: 5_000,
      })
      .then(() => true, () => false);

    await this.input.fill(code);
    if (!(await autoSubmitted)) await this.submitButton.click();

    await this.page.waitForLoadState('networkidle');
    const error = this.page.getByText(/wrong code|invalid code|expired/i);
    if (await error.isVisible().catch(() => false)) {
      throw new Error(`Admin OTP "${code}" was rejected: ${(await error.innerText()).trim()}`);
    }
    await expect(this.page).not.toHaveURL(/\/securecontroller\/otp/);
  }
}
