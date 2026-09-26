import { type Page, type Locator, expect } from '@playwright/test';

/** OTP verification step: /verify-otp */
export class OtpPage {
  readonly heading: Locator;
  readonly verifyButton: Locator;
  readonly resendLink: Locator;
  readonly backToLoginLink: Locator;
  /**
   * The six visible boxes are display-only <div>s; the page uses `input-otp`, which keeps one
   * real (visually hidden) <input maxlength="6"> stretched over them. Type into that input.
   */
  readonly input: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'OTP verification' });
    this.verifyButton = page.getByRole('button', { name: 'Verify Now' });
    this.resendLink = page.getByText(/Resend OTP|Resend available in/);
    this.backToLoginLink = page.getByRole('link', { name: 'Back to Login' });
    this.input = page.locator('input[data-input-otp]');
  }

  /** Display box `n` (1-based) of the 6-box OTP widget. */
  digit(n: number): Locator {
    return this.page.locator(`[aria-label="Enter digit ${n} of 6"]`);
  }

  /** Account creation is a real server round-trip ("Creating account..." toast), so allow time. */
  async expectVisible(timeout = 30_000) {
    await expect(this.page).toHaveURL(/\/verify-otp/, { timeout });
    await expect(this.heading).toBeVisible();
  }

  /** Types the code into the hidden input; the six boxes mirror it one digit each. */
  async enter(code: string) {
    expect(code, 'OTP must be 6 digits').toMatch(/^\d{6}$/);

    await this.input.focus();
    await this.page.keyboard.type(code, { delay: 50 });

    await expect(this.input).toHaveValue(code);
    for (let i = 0; i < 6; i++) {
      await expect(this.digit(i + 1)).toHaveText(code[i]);
    }
  }

  async verify(code: string) {
    await this.enter(code);
    await this.verifyButton.click();
  }
}
