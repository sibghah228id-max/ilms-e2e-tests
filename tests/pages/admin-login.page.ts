import { type Page, type Locator, expect } from '@playwright/test';
import { env } from '../data/environments';

/** Master admin login: /securecontroller/login (server-rendered form, no client-side routing). */
export class AdminLoginPage {
  readonly heading: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly loginButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = this.page.getByRole('heading', { name: /Login your INDUS Tech Connect account/i });
    this.email = this.page.getByLabel('Email');
    this.password = this.page.getByLabel('Password');
    this.loginButton = this.page.getByRole('button', { name: 'Login', exact: true });
  }

  /** The admin panel lives on its own host, so use the absolute URL from the environment config. */
  async goto() {
    await this.page.goto(env.admin.baseUrl + env.admin.loginPath, { waitUntil: 'networkidle' });
    await expect(this.heading).toBeVisible();
  }

  /** Submits the credentials; a successful login always continues to the OTP step. */
  async login(email: string, password: string) {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.loginButton.click();
  }
}
