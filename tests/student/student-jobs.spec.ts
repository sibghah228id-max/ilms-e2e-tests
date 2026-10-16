import { test, expect } from '@playwright/test';
import credentials from '../data/student-login.json';
import { StudentLoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { browseStudentJobs } from '../helpers/browse-student-jobs';

// Email, password and OTP come from tests/data/student-login.json only; change them there.
const { student: user } = credentials;

/**
 * Jobs for an ALREADY REGISTERED Student: signing in, then the Jobs section from the dashboard.
 *
 * Login is the shared one (StudentLoginPage.loginWithOtpIfShown, which drives OtpPage and enters
 * the stored code only when the portal asks for it), so this spec carries no login logic of its
 * own and no mailbox is involved. It starts from the dashboard the way the dashboard-login spec
 * leaves it, but runs on its own, so neither test depends on the other.
 *
 * What the Jobs part checks is in helpers/browse-student-jobs.ts: the default source, the
 * Government feed and the Country filter, each against the jobs the portal really returned.
 */
test.describe('Student jobs (registered account)', () => {
  // Login round-trip, then two job feeds and a filtered one, all served by a slow staging box.
  test.setTimeout(8 * 60_000);

  test('opens Jobs from the sidebar and filters by source and country', async ({ page }) => {
    // ---- Login → OTP if asked → dashboard.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);

    // The user guide only shows on a first login; it is cleared out of the way either way, since
    // it would sit over the sidebar.
    await dashboard.completeOnboarding();
    await expect(dashboard.preview.dialog, 'the user guide should not be covering the page').toHaveCount(0);

    // ---- Jobs → All, Private by default, then Government, then the Country filter.
    const summary = await browseStudentJobs(page);
    test.info().annotations.push({ type: 'jobs', description: JSON.stringify(summary) });
  });
});
