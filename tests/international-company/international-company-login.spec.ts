import { test, expect } from '@playwright/test';
import credentials from '../data/international-company.json';
import { StudentLoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';

// Email, password and OTP come from tests/data/international-company.json only; change them there.
const { internationalCompany: user } = credentials;

/**
 * Login of an already registered International Company account: email + password on /login, the
 * OTP step when the portal asks for one (fixed code from the JSON file, no mailbox involved), then
 * the dashboard. Independent of the signup and profile tests; it creates and changes nothing.
 */
test.describe('International Company login (registered account)', () => {
  test('logs in with the stored email, password and OTP and reaches the dashboard', async ({ page }) => {
    // Login form is shared by every role, so the existing page object handles it, OTP included.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    // Logged in: dashboard URL, the greeting heading and the sidebar entries of a signed-in account.
    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await expect(page.getByRole('heading', { name: /^Good (Morning|Afternoon|Evening),/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: 'My Profile', exact: true })).toBeVisible();
    await expect(dashboard.logoutLink).toBeVisible();

    // The header badge names the signed-in role; it is recorded with the run (no credentials are logged).
    const roleBadge = page.getByRole('button', { name: /^Logged in as / });
    await expect(roleBadge).toBeVisible();
    test.info().annotations.push({ type: 'logged-in-as', description: (await roleBadge.innerText()).trim() });
  });
});
