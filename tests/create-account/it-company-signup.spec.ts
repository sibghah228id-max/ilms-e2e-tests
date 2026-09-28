import { test, expect } from '@playwright/test';
import path from 'path';
import { RoleSelectionPage, ItCompanyRegistrationPage } from '../pages/create-account.page';
import { OtpPage } from '../pages/otp.page';
import { DashboardPage } from '../pages/dashboard.page';
import { ItCompanyProfilePage, IT_COMPANY_PROFILE_STEP_HEADINGS } from '../pages/it-company-profile.page';
import { itCompanyProfileData, itCompanySignupData, uniqueItCompanyData } from '../data/it-company-data';
import { IT_COMPANY_ACTIVATION_STEPS } from '../data/dashboard-onboarding';
import { studentSignupData } from '../data/student-data';
import { createInbox, fetchOtp } from '../helpers/mailtm';
import { env, currentEnvName } from '../data/environments';
import { AdminLoginPage } from '../pages/admin-login.page';
import { AdminOtpPage } from '../pages/admin-otp.page';
import { AdminUsersPage } from '../pages/admin-users.page';
import { StudentLoginPage } from '../pages/login.page';

const { form: formData } = itCompanySignupData;
// The OTP mail has the same subject for every role.
const { otp: otpData } = studentSignupData;

/** Company logo uploaded on Company Information (same PNG fixture as the other roles). */
const profileImagePath = path.resolve(__dirname, '../fixtures/profile-image.png');

/**
 * Full IT Company signup: login → Sign Up → IT Company → Create Account → form → OTP (from a
 * mail.tm inbox) → dashboard with the profile activation checklist.
 *
 * Static fixtures (dropdown values, placeholders, password) live in tests/data/it-company-data.ts.
 * Every run generates a brand-new company name/email/phone (see uniqueItCompanyData), so the
 * portal never sees a duplicate account. Each run leaves a real account behind on the portal.
 */
test.describe('IT Company signup (end to end)', () => {
  // Two real email round-trips, the admin panel in a second tab and the six-step profile wizard.
  test.setTimeout(10 * 60_000);

  test('registers a new IT Company, gets verified by the admin, and completes the company profile', async ({ page }) => {
    // A fresh disposable inbox per run; its address is the email the portal sends the OTP to.
    const inbox = await createInbox(`itco${Date.now()}${Math.floor(Math.random() * 1000)}`);
    const company = uniqueItCompanyData(inbox.address);
    test.info().annotations.push({ type: 'company', description: JSON.stringify(company) });

    // Login → Sign Up
    await page.goto(env.portal.loginPath, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Sign Up', exact: true }).click();
    await expect(page).toHaveURL(/\/create-account\/?$/);

    // IT Company → Create Account
    const rolePage = new RoleSelectionPage(page);
    await rolePage.roleCard('IT Company').click();
    await rolePage.createAccountButton.click();

    // Registration form
    const form = new ItCompanyRegistrationPage(page);
    await form.expectVisible();
    await expect(form.companyName).toHaveAttribute('placeholder', formData.placeholders.companyName);
    await expect(form.email).toHaveAttribute('placeholder', formData.placeholders.email);
    await expect(form.phone).toHaveAttribute('placeholder', formData.placeholders.phone);
    await expect(form.address).toHaveAttribute('placeholder', formData.placeholders.address);
    await expect(form.phoneCountry).toContainText(formData.phoneCountryLabel);

    await form.fill(company);

    // Password fields are masked by default and the eye button reveals them.
    await expect(form.password).toHaveAttribute('type', 'password');
    await form.eyeButton(form.password).click();
    await expect(form.password).toHaveAttribute('type', 'text');
    await form.eyeButton(form.password).click();
    await expect(form.password).toHaveAttribute('type', 'password');
    await expect(form.confirmPassword).toHaveAttribute('type', 'password');

    await expect(form.companyType).toHaveValue(company.companyType);
    await expect(form.city).toHaveValue(company.cityOption);
    await expect(form.vertical).toHaveValue(company.vertical);
    await expect(form.phone).toHaveValue(company.phone);

    await form.submitButton.click();

    // OTP page
    const otpPage = new OtpPage(page);
    await otpPage.expectVisible();

    const otp = await fetchOtp(inbox, { subject: new RegExp(otpData.emailSubject, 'i') });
    test.info().annotations.push({ type: 'otp', description: otp });

    await otpPage.verify(otp);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    // Welcome preview / feature tour first, then the activation checklist underneath.
    const dashboard = new DashboardPage(page);
    await dashboard.completeOnboarding();

    // "Activate your INDUS Tech Connect profile" with the five company steps, each with its action;
    // a brand-new company has completed none of them.
    const progress = await dashboard.expectActivationChecklist(IT_COMPANY_ACTIVATION_STEPS);
    expect(progress.total).toBe(IT_COMPANY_ACTIVATION_STEPS.length);
    expect(progress.total).toBeGreaterThanOrEqual(5);
    expect(progress.done).toBe(await dashboard.checklist.completedCount());
    expect(progress.done).toBe(0);

    // SECP verification waits for the owner's PakID; the other steps are actionable straight away.
    expect(await dashboard.checklist.state('Verify your company with SECP')).toBe('locked');
    for (const step of IT_COMPANY_ACTIVATION_STEPS.filter((s) => s.title !== 'Verify your company with SECP')) {
      expect(await dashboard.checklist.state(step.title)).toBe('pending');
      await expect(dashboard.checklist.action(step.title, step.action)).toBeEnabled();
    }

    // Open the admin portal in a separate tab while preserving the company session.
    const adminPage = await page.context().newPage();
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
      throw new Error(`Admin OTP for "${currentEnvName()}" is emailed; only staging has a fixed code.`);
    }
    await expect(adminPage).toHaveURL(/\/securecontroller\/dashboard/);

    // Userbase → INDUS Users → IT Companies, then the exact company registered in this run.
    const adminUsers = new AdminUsersPage(adminPage);
    await adminUsers.openIndusUsers();
    await adminUsers.selectItCompany();
    await adminUsers.searchUser(company.email);
    const companyRow = adminUsers.userRow(company.email);
    await expect(companyRow).toHaveCount(1);
    await expect(companyRow).toContainText(company.companyName);
    for (const pill of ['PakID', 'SECP', 'FBR', 'PSEB']) {
      await expect(await adminUsers.verificationPill(company.email, pill)).toHaveAttribute('title', /not verified/i);
    }

    // Verify PakID (the company registered without a CNIC, so the panel assigns one), then
    // register the company with SECP + FBR; both are reflected on the same row.
    await adminUsers.verifyPakIdForUser(company.email);
    await adminUsers.expectVerified(company.email, 'PakID');
    await adminUsers.registerSecpAndFbrForUser(company.email);
    await adminUsers.expectVerified(company.email, 'SECP');
    await adminUsers.expectVerified(company.email, 'FBR');
    await adminPage.close();

    // Re-login the same company after admin-side verification (second emailed OTP).
    await page.bringToFront();
    await dashboard.dismissOnboarding();
    await dashboard.logout();
    const companyLogin = new StudentLoginPage(page);
    await companyLogin.expectVisible();
    await companyLogin.login(company.email, company.password);
    await otpPage.expectVisible();
    const loginOtp = await fetchOtp(inbox, { subject: new RegExp(otpData.emailSubject, 'i'), ignoreCodes: [otp] });
    test.info().annotations.push({ type: 'login-otp', description: loginOtp });
    await otpPage.verify(loginOtp);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    await dashboard.completeOnboarding();

    // PakID and SECP now show as completed, so the counter moves to 2 of 5 and the profile step unlocks.
    const verified = await dashboard.expectActivationChecklist(IT_COMPANY_ACTIVATION_STEPS);
    expect(await dashboard.checklist.state('Verify your identity with PakID')).toBe('completed');
    expect(await dashboard.checklist.state('Verify your company with SECP')).toBe('completed');
    expect(verified.done).toBe(await dashboard.checklist.completedCount());
    expect(verified.done).toBeGreaterThanOrEqual(2);

    // Complete Profile opens the company profile wizard.
    await dashboard.openCompleteProfile();
    await expect(page).toHaveURL(/\/profile\/?$/);
    await expect(page.getByRole('heading', { name: 'Company Information' })).toBeVisible({ timeout: 30_000 });

    // Company profile wizard: complete only what registration and verification left empty.
    const profile = new ItCompanyProfilePage(page);
    await dashboard.tour.skipIfShown();

    // Step 1: Company Information (registration values kept) plus the company logo.
    await profile.completeMissingCompanyInfo(itCompanyProfileData.companyInfo, company);
    await profile.ensureCompanyLogo(profileImagePath);
    await profile.saveAndNext(IT_COMPANY_PROFILE_STEP_HEADINGS.contact);

    // Step 2: Contact Information, primary and secondary contacts.
    await profile.completeMissingContacts(itCompanyProfileData.contact, company);
    await profile.saveAndNext(IT_COMPANY_PROFILE_STEP_HEADINGS.stakeholders);

    // Step 3: Stakeholder Details, first stakeholder plus one added with "Add Stakeholder".
    await profile.addStakeholders(itCompanyProfileData.stakeholders);
    await profile.saveAndNext(IT_COMPANY_PROFILE_STEP_HEADINGS.benefits);

    // Step 4: Benefits & Perks, every other available option in each category.
    expect(await profile.selectAlternatingBenefits()).toBeGreaterThan(0);
    await profile.saveAndNext(IT_COMPANY_PROFILE_STEP_HEADINGS.expertise);

    // Step 5: Expertise & Languages with ratings out of 100.
    await profile.completeExpertiseAndLanguages(itCompanyProfileData.expertise);
    await profile.saveAndNext(IT_COMPANY_PROFILE_STEP_HEADINGS.projects);

    // Step 6: Projects, one record, then the wizard's final Save and its confirmation.
    await profile.addProject(itCompanyProfileData.project);
    const savedPct = await profile.saveProfile();
    test.info().annotations.push({ type: 'profile-completion', description: String(savedPct) });
  });
});
