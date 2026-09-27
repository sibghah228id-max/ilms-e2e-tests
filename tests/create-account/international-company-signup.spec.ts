import { test, expect } from '@playwright/test';
import { RoleSelectionPage, InternationalCompanyRegistrationPage } from '../pages/create-account.page';
import { OtpPage } from '../pages/otp.page';
import { internationalCompanySignupData, uniqueInternationalCompanyData } from '../data/international-company-data';
import { studentSignupData } from '../data/student-data';
import { createInbox, fetchOtp } from '../helpers/mailtm';
import { env } from '../data/environments';

const { form: formData } = internationalCompanySignupData;
// The OTP mail has the same subject for every role.
const { otp: otpData } = studentSignupData;

/**
 * Full International Company signup: login → Sign Up → International Company → Create Account →
 * form → OTP (from a mail.tm inbox) → dashboard.
 *
 * Static fixtures (dropdown values, placeholders, password) live in tests/data/international-company-data.ts.
 * Every run generates a brand-new company name/email/phone (see uniqueInternationalCompanyData),
 * so the portal never sees a duplicate account. Each run leaves a real account behind on the portal.
 */
test.describe('International Company signup (end to end)', () => {
  // Real email round-trip, so give it room.
  test.setTimeout(3 * 60_000);

  test('registers a new International Company and verifies the emailed OTP', async ({ page }) => {
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
  });
});
