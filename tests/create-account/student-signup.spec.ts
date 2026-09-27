import { test, expect } from '@playwright/test';
import { RoleSelectionPage, StudentRegistrationPage } from '../pages/create-account.page';
import { OtpPage } from '../pages/otp.page';
import { studentSignupData, uniqueStudentData } from '../data/student-data';
import { createInbox, fetchOtp } from '../helpers/mailtm';
import { env, currentEnvName } from '../data/environments';
import { AdminLoginPage } from '../pages/admin-login.page';
import { AdminOtpPage } from '../pages/admin-otp.page';
import { AdminUsersPage } from '../pages/admin-users.page';
import { StudentLoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { PROFILE_COMPLETION_TARGET, STUDENT_ACTIVATION_STEPS } from '../data/dashboard-onboarding';

const { form: formData, otp: otpData } = studentSignupData;

/**
 * Full IT Student signup: login → Sign Up → IT Student → form → OTP (from a mail.tm inbox) → dashboard,
 * then the master admin verifies that student's PakID in a second tab: admin login + OTP → Userbase →
 * INDUS Users → IT Students → the student's row → Actions → Verify PakID → row shows PakID verified,
 * and finally the student logs out and back in (second emailed OTP) to see the PakID step completed
 * on the activation checklist and open the profile page from "Complete Profile".
 *
 * Static fixtures (defaults, placeholders, OTP subject) live in tests/data/student-signup.json.
 * Every run generates a brand-new name/CNIC/email/phone (see uniqueStudentData), so the
 * portal never sees a duplicate account. Each run leaves a real account behind on the portal.
 */
test.describe('IT Student signup (end to end)', () => {
  // Two real email round-trips plus the admin panel in a second tab, so give it room.
  test.setTimeout(6 * 60_000);

  test('registers a new IT Student, gets PakID-verified by the admin, and sees it completed after re-login', async ({ page }) => {
    // A fresh disposable inbox per run; its address is the email the portal sends the OTP to.
    const inbox = await createInbox();
    const student = uniqueStudentData(inbox.address);
    test.info().annotations.push({ type: 'student', description: JSON.stringify(student) });

    // Login → Sign Up
    await page.goto(env.portal.loginPath, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Sign Up', exact: true }).click();
    await expect(page).toHaveURL(/\/create-account\/?$/);

    // IT Student → Create Account
    const rolePage = new RoleSelectionPage(page);
    await rolePage.roleCard('IT Student').click();
    await rolePage.createAccountButton.click();
    await expect(page).toHaveURL(/\/create-account\/student\/?$/);

    // Registration form
    const form = new StudentRegistrationPage(page);
    await expect(form.name).toHaveAttribute('placeholder', formData.placeholders.name);
    await expect(form.cnic).toHaveAttribute('placeholder', formData.placeholders.cnic);
    await expect(form.email).toHaveAttribute('placeholder', formData.placeholders.email);
    await expect(form.phone).toHaveAttribute('placeholder', formData.placeholders.phone);
    await expect(page.getByText(formData.phoneCountryLabel)).toBeVisible();

    await form.fill(student);

    // Password is masked by default and the eye button reveals it.
    await expect(form.password).toHaveAttribute('type', 'password');
    await form.eyeButton(form.password).click();
    await expect(form.password).toHaveAttribute('type', 'text');
    await form.eyeButton(form.password).click();
    await expect(form.password).toHaveAttribute('type', 'password');

    await expect(form.genderGroup.getByRole('radio', { name: new RegExp(student.gender, 'i') })).toBeChecked();
    await expect(form.phone).toHaveValue(student.phone);

    await form.submitButton.click();

    // OTP page
    const otpPage = new OtpPage(page);
    await otpPage.expectVisible();

    const otp = await fetchOtp(inbox, { subject: new RegExp(otpData.emailSubject, 'i') });
    test.info().annotations.push({ type: 'otp', description: otp });

    await otpPage.verify(otp);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    // Open the admin portal in a separate tab while preserving the student session.
    const adminPage = await page.context().newPage();

    // Admin login (email + password), then the OTP step.
    const adminLogin = new AdminLoginPage(adminPage);
    await adminLogin.goto();
    await adminLogin.login(env.admin.email, env.admin.password);

    const adminOtpPage = new AdminOtpPage(adminPage);
    await adminOtpPage.expectVisible();

    if (currentEnvName() === 'staging') {
      if (!env.admin.fixedOtp) {
        throw new Error('Fixed admin OTP is required for staging.');
      }

      // Staging uses the fixed admin OTP configured for automated testing.
      await adminOtpPage.verify(env.admin.fixedOtp);
    } else {
      // Other environments email a one-time code to the admin mailbox, which the suite cannot read.
      throw new Error(`Admin OTP for "${currentEnvName()}" is emailed; only staging has a fixed code.`);
    }

    // The admin dashboard greets the signed-in administrator.
    await expect(adminPage).toHaveURL(/\/securecontroller\/dashboard/);
    await expect(adminPage.getByRole('heading', { name: /^Hello, / })).toBeVisible();

    // Userbase → INDUS Users → IT Students, through the sidebar and stakeholder tabs.
    const adminUsers = new AdminUsersPage(adminPage);
    await adminUsers.openIndusUsers();
    await adminUsers.selectItStudent();

    // Locate the exact student created during this test run before performing admin actions.
    await adminUsers.searchUser(student.email);
    const studentRow = adminUsers.userRow(student.email);
    await expect(studentRow).toHaveCount(1);
    await expect(studentRow).toContainText(student.email);
    await expect(studentRow).toContainText(student.cnic);
    await expect(await adminUsers.pakIdPill(student.email)).toHaveAttribute('title', /PakID not verified/i);

    // Verify the student's CNIC through the admin action menu.
    await adminUsers.verifyCnicForUser(student.email, student.cnic);
    await expect(adminUsers.verificationFlash(student.email)).toContainText(`(CNIC on file: ${student.cnic})`);

    // Confirm PakID verification is reflected on the same student's row.
    await adminUsers.expectPakIdVerified(student.email);

    // The admin tab has served its purpose; the student dashboard tab stays open.
    await adminPage.close();

    // Re-login the same student after admin-side PakID verification.
    // The original tab is still signed in, so log out through the UI to get a fresh login. The
    // welcome preview still covers the dashboard on that tab; skipping it also keeps it from
    // coming back on the next login.
    await page.bringToFront();
    const dashboard = new DashboardPage(page);
    await dashboard.dismissOnboarding();
    await dashboard.logout();

    const studentLogin = new StudentLoginPage(page);
    await studentLogin.expectVisible();
    await studentLogin.login(student.email, student.password);

    // Login also asks for an emailed OTP; the signup code is still in the inbox, so skip it.
    await otpPage.expectVisible();
    const loginOtp = await fetchOtp(inbox, { subject: new RegExp(otpData.emailSubject, 'i'), ignoreCodes: [otp] });
    test.info().annotations.push({ type: 'login-otp', description: loginOtp });
    await otpPage.verify(loginOtp);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    // The feature tour may follow now that the preview has been skipped.
    await dashboard.dismissOnboarding();

    await dashboard.expectActivationSection();
    // Confirm the admin-side CNIC verification is reflected as a completed PakID step.
    await dashboard.expectPakIdCompleted();
    await dashboard.expectPakIdStep();
    const completionPct = await dashboard.expectProfileCompletionStep();
    await dashboard.expectPsebStep();
    await dashboard.expectTalentHubStep();

    // PakID now counts as done; the profile step joins it only from 80% completion, and the
    // optional steps are untouched for a brand-new account.
    const completedSteps = 1 + (completionPct >= PROFILE_COMPLETION_TARGET ? 1 : 0);
    await dashboard.expectProgress(completedSteps, STUDENT_ACTIVATION_STEPS.length);

    // Open the profile completion page from the second activation step.
    await dashboard.openCompleteProfile();
    await expect(page).toHaveURL(/\/profile\/?$/);
    await expect(page.getByRole('heading', { name: 'Personal Details' })).toBeVisible({ timeout: 30_000 });
  });
});
