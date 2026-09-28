import { test, expect } from '@playwright/test';
import path from 'path';
import { RoleSelectionPage, InternationalCompanyRegistrationPage } from '../pages/create-account.page';
import { OtpPage } from '../pages/otp.page';
import { DashboardPage } from '../pages/dashboard.page';
import { CompanyProfilePage, COMPANY_PROFILE_STEP_HEADINGS } from '../pages/company-profile.page';
import {
  internationalCompanyProfileData,
  internationalCompanySignupData,
  uniqueInternationalCompanyData,
} from '../data/international-company-data';
import { studentSignupData } from '../data/student-data';
import { createInbox, fetchOtp } from '../helpers/mailtm';
import { env } from '../data/environments';

const { form: formData } = internationalCompanySignupData;
// The OTP mail has the same subject for every role.
const { otp: otpData } = studentSignupData;

/** Company logo uploaded on Company Information (same PNG fixture as the student avatar). */
const profileImagePath = path.resolve(__dirname, '../fixtures/profile-image.png');

/**
 * Full International Company signup: login → Sign Up → International Company → Create Account →
 * form → OTP (from a mail.tm inbox) → dashboard.
 *
 * Static fixtures (dropdown values, placeholders, password) live in tests/data/international-company-data.ts.
 * Every run generates a brand-new company name/email/phone (see uniqueInternationalCompanyData),
 * so the portal never sees a duplicate account. Each run leaves a real account behind on the portal.
 */
test.describe('International Company signup (end to end)', () => {
  // Real email round-trip plus the three-step company profile wizard, so give it room.
  test.setTimeout(8 * 60_000);

  test('registers a new International Company, verifies the emailed OTP, and completes the company profile', async ({ page }) => {
    // A fresh disposable inbox per run; its address is the email the portal sends the OTP to.
    const inbox = await createInbox(`intl${Date.now()}${Math.floor(Math.random() * 1000)}`);
    const company = uniqueInternationalCompanyData(inbox.address);
    test.info().annotations.push({ type: 'company', description: JSON.stringify(company) });

    // Login → Sign Up
    await page.goto(env.portal.loginPath, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Sign Up', exact: true }).click();
    await expect(page).toHaveURL(/\/create-account\/?$/);

    // International Company → Create Account
    const rolePage = new RoleSelectionPage(page);
    await rolePage.roleCard('International Company').click();
    await rolePage.createAccountButton.click();

    // Registration form
    const form = new InternationalCompanyRegistrationPage(page);
    await form.expectVisible();
    await expect(form.companyName).toHaveAttribute('placeholder', formData.placeholders.companyName);
    await expect(form.email).toHaveAttribute('placeholder', formData.placeholders.email);
    await expect(form.phone).toHaveAttribute('placeholder', formData.placeholders.phone);
    await expect(form.phoneCountry).toContainText(formData.phoneCountryLabel);

    await form.fill(company);

    // Password fields are masked by default and the eye button reveals them.
    await expect(form.password).toHaveAttribute('type', 'password');
    await form.eyeButton(form.password).click();
    await expect(form.password).toHaveAttribute('type', 'text');
    await form.eyeButton(form.password).click();
    await expect(form.password).toHaveAttribute('type', 'password');
    await expect(form.confirmPassword).toHaveAttribute('type', 'password');

    await expect(form.vertical).toHaveValue(company.vertical);
    await expect(form.country).toHaveValue(company.countryOption);
    await expect(form.phone).toHaveValue(company.phone);

    await form.submitButton.click();

    // OTP page
    const otpPage = new OtpPage(page);
    await otpPage.expectVisible();

    const otp = await fetchOtp(inbox, { subject: new RegExp(otpData.emailSubject, 'i') });
    test.info().annotations.push({ type: 'otp', description: otp });

    await otpPage.verify(otp);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    // Post-registration user guide: Next through the preview to its finishing button, with
    // "Skip preview" as the fallback, then dismiss the feature tour.
    const dashboard = new DashboardPage(page);
    await dashboard.completeOnboarding();

    // Company dashboard: greeting, role badge and the profile card for this company.
    await expect(page.getByText('Logged in as International')).toBeVisible();
    await expect(page.getByRole('heading', { name: company.companyName })).toBeVisible();

    // My Profile → company wizard, step 1: Company Information.
    await page.getByRole('link', { name: 'My Profile', exact: true }).click();
    const profile = new CompanyProfilePage(page);
    await profile.expectVisible();
    // The feature tour can follow the user onto the profile page; get it out of the way.
    await dashboard.tour.skipIfShown();

    // Preserve registration values and fill only the missing required fields; add a company logo.
    await profile.completeMissingCompanyInformation(internationalCompanyProfileData.information, company);
    await profile.ensureCompanyLogo(profileImagePath);
    await profile.saveAndNext(COMPANY_PROFILE_STEP_HEADINGS.contact);

    // Step 2: Contact Information (name, email, phone prefilled; designation missing).
    await profile.completeMissingContactInformation(internationalCompanyProfileData.contact, company);
    await profile.saveAndNext(COMPANY_PROFILE_STEP_HEADINGS.expertise);

    // Step 3: Expertise & Languages, then the final Save and its success confirmation.
    await profile.completeExpertiseAndLanguages(internationalCompanyProfileData.expertise);
    const savedPct = await profile.saveProfile();
    test.info().annotations.push({ type: 'profile-completion', description: String(savedPct) });
  });
});
