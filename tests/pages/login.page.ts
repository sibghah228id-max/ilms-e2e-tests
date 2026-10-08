import { type Page, type Locator, expect } from '@playwright/test';
import { env } from '../data/environments';
import { OtpPage } from './otp.page';

/**
 * Portal login: /login (email + password). A successful submit always continues to the emailed
 * OTP step on /verify-otp, which tests handle with OtpPage.
 */
export class StudentLoginPage {
  readonly heading: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly loginButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: /Login to your INDUS Tech Connect account/i });
    this.email = page.getByRole('textbox', { name: /^Email/ });
    this.password = page.getByLabel(/^Password/);
    this.loginButton = page.getByRole('button', { name: 'Login', exact: true });
  }

  async goto() {
    await this.page.goto(env.portal.loginPath, { waitUntil: 'networkidle' });
    await this.expectVisible();
  }

  /** The login page may carry query parameters (e.g. after a logout), so match the path only. */
  async expectVisible() {
    await expect(this.page).toHaveURL(/\/login(\?|\/?$)/, { timeout: 15_000 });
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
    await expect(this.loginButton).toBeVisible();
  }

  async login(email: string, password: string) {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.loginButton.click();
  }

  /**
   * Login for an account with a fixed OTP (no mailbox): submits the form, then waits for whichever
   * comes first, the OTP step or the dashboard. The code is entered only when the OTP step shows.
   */
  async loginWithOtpIfShown(email: string, password: string, otp: string) {
    await this.login(email, password);

    const otpPage = new OtpPage(this.page);
    const dashboardSidebar = this.page.getByRole('link', { name: 'My Profile', exact: true });
    await expect(otpPage.heading.or(dashboardSidebar).first()).toBeVisible({ timeout: 60_000 });

    if (await otpPage.heading.isVisible()) {
      await otpPage.verify(otp);
    }
  }
}
