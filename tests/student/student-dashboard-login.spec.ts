import { test, expect } from '@playwright/test';
import credentials from '../data/student-login.json';
import { StudentLoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';

// Email, password and OTP come from tests/data/student-login.json only; change them there.
const { student: user } = credentials;

/**
 * Signing an ALREADY REGISTERED Student in and landing on the dashboard — nothing more.
 *
 * This stands on its own: it shares the data file and the page objects with
 * student-login.spec.ts but not its run, so it still passes while the longer flow (profile
 * wizard, Digital CV) is held up by something later on.
 *
 * The OTP step is entered only if the portal asks for it: StudentLoginPage.loginWithOtpIfShown
 * waits for whichever of the two arrives — the OTP page or the signed-in dashboard — and types
 * the stored code only in the first case. It drives OtpPage itself, so the code and the OTP
 * locators stay in one place, and no mailbox is involved (unlike the signup specs, which read a
 * one-time code from mail.tm).
 *
 * The user guide belongs to a first login and skipping it is remembered server-side, so
 * completeOnboarding() walks it when it is there and returns quietly when it is not. Its absence
 * is the normal case here and never fails the run; which of the two happened is recorded.
 */
test.describe('Student dashboard login (registered account)', () => {
  // The portal takes its time over the OTP step and the dashboard behind it.
  test.setTimeout(5 * 60_000);

  test('signs in with the stored credentials and opens the Student dashboard', async ({ page }) => {
    // ---- Login page, at the base URL of the environment under test.
    const login = new StudentLoginPage(page);
    await login.goto();

    // ---- Email and password from the data file, then Login, then the OTP step if it appears.
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    // ---- The dashboard: its URL and the greeting it opens with.
    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await expect(
      page.getByRole('heading', { name: /^Good (Morning|Afternoon|Evening),/ }),
      'the dashboard should greet the signed-in student',
    ).toBeVisible({ timeout: 60_000 });

    // ---- User guide: walked to its finish when shown, skipped past when not. Either is fine.
    const onboarding = await dashboard.completeOnboarding();
    test.info().annotations.push({
      type: 'user-guide',
      description: onboarding.preview ? 'shown and completed' : 'not shown (already completed on an earlier login)',
    });
    await expect(dashboard.preview.dialog, 'the user guide should be gone either way').toHaveCount(0);
    await expect(dashboard.tour.dialog, 'the feature tour should be gone either way').toHaveCount(0);

    // ---- Signed in as the Student, with the dashboard usable behind the overlays.
    await expect(
      page.getByRole('button', { name: /Logged in as / }),
      'the header should say the signed-in account is a Student',
    ).toContainText(/Logged in as\s+Student/);
    await expect(page.getByRole('link', { name: 'My Profile', exact: true })).toBeVisible();
    await expect(dashboard.logoutLink).toBeVisible();
  });
});
