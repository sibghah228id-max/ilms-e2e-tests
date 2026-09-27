import { test, expect } from '@playwright/test';
import path from 'path';
import { RoleSelectionPage, ItProfessionalRegistrationPage } from '../pages/create-account.page';
import { OtpPage } from '../pages/otp.page';
import {
  itProfessionalSignupData,
  itProfessionalOtpData,
  uniqueItProfessionalData,
} from '../data/it-professional-data';
import { createInbox, fetchOtp } from '../helpers/mailtm';
import { env, currentEnvName } from '../data/environments';
import { AdminLoginPage } from '../pages/admin-login.page';
import { AdminOtpPage } from '../pages/admin-otp.page';
import { AdminUsersPage } from '../pages/admin-users.page';
import { StudentLoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { PROFILE_COMPLETION_TARGET, STUDENT_ACTIVATION_STEPS } from '../data/dashboard-onboarding';
import { ProfilePage, PROFESSIONAL_PROFILE_STEP_HEADINGS } from '../pages/profile.page';
import { DigitalCvPage } from '../pages/digital-cv.page';
import { itProfessionalProfileData } from '../data/it-professional-profile-data';

const { form: formData } = itProfessionalSignupData;
const otpData = itProfessionalOtpData;

/** Profile picture uploaded on Personal Details (PNG, matching the upload control's accepted types). */
const profileImagePath = path.resolve(__dirname, '../fixtures/profile-image.png');

/**
 * Full IT Professional signup: login → Sign Up → IT Professional → form → OTP (from a mail.tm inbox)
 * → dashboard, then the master admin verifies that professional's PakID in a second tab: admin login
 * + OTP → Userbase → INDUS Users → IT Professionals → the professional's row → Actions → Verify
 * PakID → row shows PakID verified, and finally the professional logs out and back in (second
 * emailed OTP) to see the PakID step completed on the activation checklist and open the profile
 * page from "Complete Profile".
 *
 * Static fixtures (defaults, placeholders) live in tests/data/it-professional-signup.json.
 * Every run generates a brand-new name/CNIC/email/phone (see uniqueItProfessionalData), so the
 * portal never sees a duplicate account. Each run leaves a real account behind on the portal.
 */
test.describe('IT Professional signup (end to end)', () => {
  // Two real email round-trips, the admin panel in a second tab and the profile wizard, so give it room.
  test.setTimeout(9 * 60_000);

  test('registers a new IT Professional, gets PakID-verified by the admin, and sees it completed after re-login', async ({
    page,
  }) => {
    // A fresh disposable inbox per run; its address is the email the portal sends the OTP to.
    const inbox = await createInbox(`pro${Date.now()}${Math.floor(Math.random() * 1000)}`);
    const professional = uniqueItProfessionalData(inbox.address);
    test.info().annotations.push({ type: 'professional', description: JSON.stringify(professional) });

    // Login → Sign Up
    await page.goto(env.portal.loginPath, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Sign Up', exact: true }).click();
    await expect(page).toHaveURL(/\/create-account\/?$/);

    // IT Professional → Create Account
    const rolePage = new RoleSelectionPage(page);
    await rolePage.roleCard('IT Professional').click();
    await rolePage.createAccountButton.click();
    await expect(page).toHaveURL(/\/create-account\/it-professional\/?$/);

    // Registration form
    const form = new ItProfessionalRegistrationPage(page);
    await form.expectVisible();
    await expect(form.name).toHaveAttribute('placeholder', formData.placeholders.name);
    await expect(form.cnic).toHaveAttribute('placeholder', formData.placeholders.cnic);
    await expect(form.email).toHaveAttribute('placeholder', formData.placeholders.email);
    await expect(form.phone).toHaveAttribute('placeholder', formData.placeholders.phone);
    await expect(form.yearsOfExperience).toHaveAttribute('placeholder', formData.placeholders.yearsOfExperience);
    await expect(form.phoneCountry).toContainText(formData.phoneCountryLabel);

    await form.fill(professional);

    // Password is masked by default and the eye button reveals it.
    await expect(form.password).toHaveAttribute('type', 'password');
    await form.eyeButton(form.password).click();
    await expect(form.password).toHaveAttribute('type', 'text');
    await form.eyeButton(form.password).click();
    await expect(form.password).toHaveAttribute('type', 'password');

    await expect(form.genderGroup.getByRole('radio', { name: professional.gender, exact: true })).toBeChecked();
    await expect(
      form.workStatusGroup.getByRole('radio', { name: professional.workStatus, exact: true }),
    ).toBeChecked();
    await expect(form.phone).toHaveValue(professional.phone);
    await expect(form.yearsOfExperience).toHaveValue(professional.yearsOfExperience);

    await form.submitButton.click();

    // OTP page
    const otpPage = new OtpPage(page);
    await otpPage.expectVisible();

    const otp = await fetchOtp(inbox, { subject: new RegExp(otpData.emailSubject, 'i') });
    test.info().annotations.push({ type: 'otp', description: otp });

    await otpPage.verify(otp);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    // Open the admin portal in a separate tab while preserving the professional session.
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

    // Userbase → INDUS Users → IT Professionals, through the sidebar and stakeholder tabs.
    const adminUsers = new AdminUsersPage(adminPage);
    await adminUsers.openIndusUsers();
    await adminUsers.selectItProfessional();

    // Locate the exact professional created during this test run before performing admin actions.
    await adminUsers.searchUser(professional.email);
    const professionalRow = adminUsers.userRow(professional.email);
    await expect(professionalRow).toHaveCount(1);
    await expect(professionalRow).toContainText(professional.email);
    await expect(professionalRow).toContainText(professional.cnic);
    await expect(await adminUsers.pakIdPill(professional.email)).toHaveAttribute('title', /PakID not verified/i);

    // Verify the professional's CNIC through the admin action menu.
    await adminUsers.verifyCnicForUser(professional.email, professional.cnic);
    await expect(adminUsers.verificationFlash(professional.email)).toContainText(
      `(CNIC on file: ${professional.cnic})`,
    );

    // Confirm PakID verification is reflected on the same professional's row.
    await adminUsers.expectPakIdVerified(professional.email);

    // The admin tab has served its purpose; the professional dashboard tab stays open.
    await adminPage.close();

    // Re-login the same professional after admin-side PakID verification.
    // The original tab is still signed in, so log out through the UI to get a fresh login. The
    // welcome preview still covers the dashboard on that tab; skipping it also keeps it from
    // coming back on the next login.
    await page.bringToFront();
    const dashboard = new DashboardPage(page);
    await dashboard.dismissOnboarding();
    await dashboard.logout();

    const professionalLogin = new StudentLoginPage(page);
    await professionalLogin.expectVisible();
    await professionalLogin.login(professional.email, professional.password);

    // Login also asks for an emailed OTP; the signup code is still in the inbox, so skip it.
    await otpPage.expectVisible();
    const loginOtp = await fetchOtp(inbox, {
      subject: new RegExp(otpData.emailSubject, 'i'),
      ignoreCodes: [otp],
    });
    test.info().annotations.push({ type: 'login-otp', description: loginOtp });
    await otpPage.verify(loginOtp);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    // The feature tour may follow now that the preview has been skipped.
    await dashboard.dismissOnboarding();

    await dashboard.expectActivationSection();
    // Confirm the admin-side CNIC verification is reflected as a completed PakID step.
    // IT Professionals share the same activation checklist as IT Students.
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

    // Complete only missing profile information, one wizard step at a time.
    const profilePage = new ProfilePage(page);
    await profilePage.expectVisible();

    // Preserve profile values already populated during registration and fill only missing required fields.
    // IT Professional wizard order: Personal → Education → Work Experience → Skills → Certifications → Projects.
    await profilePage.openPersonalDetails();
    await profilePage.completeMissingPersonalDetails(itProfessionalProfileData.personal);
    // Ensure a profile image is present before completing Personal Details.
    await profilePage.ensureProfileImage(profileImagePath);
    await profilePage.saveAndNext(PROFESSIONAL_PROFILE_STEP_HEADINGS.education);

    await profilePage.completeMissingEducationDetails(itProfessionalProfileData.education);
    await profilePage.saveAndNext(PROFESSIONAL_PROFILE_STEP_HEADINGS.experience);

    // Add one experience record for the newly registered professional.
    await profilePage.addExperience(itProfessionalProfileData.experience);
    await profilePage.saveAndNext(PROFESSIONAL_PROFILE_STEP_HEADINGS.skills);

    // Select valid skill/language options and assign proficiency ratings.
    await profilePage.completeSkillsAndLanguages(itProfessionalProfileData.skills);
    await profilePage.saveAndNext(PROFESSIONAL_PROFILE_STEP_HEADINGS.certifications);

    // Certifications step: add a certificate record.
    await profilePage.addCertificate(itProfessionalProfileData.certificate);
    await profilePage.saveAndNext(PROFESSIONAL_PROFILE_STEP_HEADINGS.projects);

    // Projects is the last step for IT Professionals; save without adding optional project records.
    const savedPct = await profilePage.saveProfile();
    expect(savedPct).toBeGreaterThan(completionPct);

    // Open the generated Digital CV after completing the profile.
    const digitalCv = new DigitalCvPage(page);
    await digitalCv.open();
    await digitalCv.expectCvOptions();

    // The full CV carries the professional's name as its title (heading level depends on the template).
    const cvPage = await digitalCv.openFullCv();
    await expect(cvPage.getByRole('heading', { name: new RegExp(`^${professional.name}$`, 'i') })).toBeVisible();
  });
});
