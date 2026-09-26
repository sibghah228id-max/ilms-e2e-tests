import { test, expect } from '@playwright/test';
import { RoleSelectionPage, StudentRegistrationPage } from '../pages/create-account.page';
import { OtpPage } from '../pages/otp.page';
import { studentSignupData, uniqueStudentData, yopmailInbox } from '../data/student-data';
import { fetchOtpFromYopmail } from '../helpers/yopmail';
import { env } from '../data/environments';

const { form: formData, otp: otpData } = studentSignupData;

/**
 * Full IT Student signup: login → Sign Up → IT Student → form → OTP (from yopmail) → dashboard.
 *
 * Static fixtures (defaults, placeholders, OTP subject) live in tests/data/student-signup.json.
 * Every run generates a brand-new name/CNIC/email/phone (see uniqueStudentData), so the
 * portal never sees a duplicate account. Each run leaves a real account behind on the portal.
 */
test.describe('IT Student signup (end to end)', () => {
  // Real email round-trip, so give it room.
  test.setTimeout(3 * 60_000);

  test('registers a new IT Student and verifies the emailed OTP', async ({ page, browser }) => {
    const student = uniqueStudentData();
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

    const otp = await fetchOtpFromYopmail(browser, yopmailInbox(student.email), {
      subject: new RegExp(otpData.emailSubject, 'i'),
    });
    test.info().annotations.push({ type: 'otp', description: otp });

    await otpPage.verify(otp);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  });
});
