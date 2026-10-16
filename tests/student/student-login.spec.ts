import { test, expect } from '@playwright/test';
import credentials from '../data/student-login.json';
import { StudentLoginPage } from '../pages/login.page';
import { OtpPage } from '../pages/otp.page';
import { DashboardPage } from '../pages/dashboard.page';
import { completeStudentProfile } from '../helpers/complete-student-profile';
import { downloadDigitalCv } from '../helpers/download-digital-cv';

// Email, password and OTP come from tests/data/student-login.json only; change them there.
const { student: user } = credentials;

/**
 * Login pass over an ALREADY REGISTERED Student account: the stored email and password, the OTP
 * step with the account's fixed code, the dashboard behind it, the profile wizard it opens from
 * "My Profile", and the Digital CV built from that profile.
 *
 * No mailbox is involved — the code is read from the data file, so this spec never touches
 * mail.tm the way the signup specs do.
 *
 * The user guide is shown on a first login only and skipping it is remembered server-side, so
 * completeOnboarding() walks it when it appears and returns without failing when it does not.
 * Either way the run records which of the two happened.
 *
 * The profile part adds nothing the account already has: see helpers/complete-student-profile.ts.
 * The Digital CV part downloads a real PDF and keeps it with the run: see
 * helpers/download-digital-cv.ts.
 */
test.describe('Student login (registered account)', () => {
  // The portal is slow to hand over the OTP step and the dashboard behind it, and the profile
  // wizard that follows saves five steps against a server that re-fetches after every one.
  test.setTimeout(15 * 60_000);

  test('logs in with the stored credentials, completes the profile and downloads the CV', async ({ page }) => {
    // ---- Login page: the shared page object, which takes the base URL from the environment.
    const login = new StudentLoginPage(page);
    await login.goto();

    // ---- Email and password from the data file, then Login.
    await login.login(user.email, user.password);

    // ---- OTP step: the portal always asks for the code after a correct password.
    const otp = new OtpPage(page);
    await otp.expectVisible(60_000);
    await otp.verify(user.otp);

    // ---- Logged in: the dashboard URL, its greeting and the entries only a signed-in account has.
    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await expect(page.getByRole('heading', { name: /^Good (Morning|Afternoon|Evening),/ })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('link', { name: 'My Profile', exact: true })).toBeVisible();
    await expect(dashboard.logoutLink).toBeVisible();

    // The header badge names the signed-in role, which is what proves it is the Student account
    // that got in. Its text is recorded with the run (no credentials are logged).
    const roleBadge = page.getByRole('button', { name: /Logged in as / });
    await expect(roleBadge, 'the header should say the signed-in account is a Student').toContainText(
      /Logged in as\s+Student/,
    );
    test.info().annotations.push({ type: 'logged-in-as', description: (await roleBadge.innerText()).trim() });

    // ---- User guide: walked with "Next" to its finishing button when it shows (with "Skip
    // preview" as the fallback), then the feature tour behind it is dismissed. A later login has
    // neither, which is not a failure.
    const onboarding = await dashboard.completeOnboarding();
    test.info().annotations.push({
      type: 'user-guide',
      description: onboarding.preview ? 'shown and completed' : 'not shown (already completed on an earlier login)',
    });
    await expect(dashboard.preview.dialog, 'the user guide should be gone either way').toHaveCount(0);
    await expect(dashboard.tour.dialog, 'the feature tour should be gone either way').toHaveCount(0);

    // ---- The dashboard underneath is usable once the overlays are out of the way.
    await expect(dashboard.logoutLink).toBeVisible();

    // ---- My Profile: the five wizard steps, filling only what the account is still missing.
    await dashboard.openMyProfile();
    await expect(page).toHaveURL(/\/profile\/?$/, { timeout: 60_000 });

    const summary = await completeStudentProfile(page);
    test.info().annotations.push({ type: 'profile', description: JSON.stringify(summary) });

    // ---- Digital CV: the Two Column template, its full CV, the generated PDF, and back again.
    const cv = await downloadDigitalCv(page);
    test.info().annotations.push({ type: 'digital-cv', description: JSON.stringify(cv) });
  });
});
