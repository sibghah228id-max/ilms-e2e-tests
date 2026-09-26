import { type Page, expect, test } from '@playwright/test';
import { RoleSelectionPage, StudentRegistrationPage, type StudentData } from '../pages/create-account.page';
import { OtpPage } from '../pages/otp.page';
import { studentSignupData, uniqueStudentData } from '../data/student-data';
import { createInbox, fetchOtp } from './mailtm';
import { env } from '../data/environments';

/**
 * Registers a brand-new IT Student and leaves the page on /dashboard, logged in as that student.
 *
 * This is the same journey as tests/create-account/student-signup.spec.ts (login → Sign Up →
 * IT Student → form → emailed OTP), without that spec's form assertions. Use it as the setup for
 * tests that need a fresh, first-time account. Each call creates a real account on the portal.
 */
export async function registerStudent(page: Page): Promise<StudentData> {
  const inbox = await createInbox();
  const student = uniqueStudentData(inbox.address);
  test.info().annotations.push({ type: 'student', description: JSON.stringify(student) });

  await page.goto(env.portal.loginPath, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Sign Up', exact: true }).click();
  await expect(page).toHaveURL(/\/create-account\/?$/);

  const rolePage = new RoleSelectionPage(page);
  await rolePage.roleCard('IT Student').click();
  await rolePage.createAccountButton.click();
  await expect(page).toHaveURL(/\/create-account\/student\/?$/);

  const form = new StudentRegistrationPage(page);
  await form.fill(student);
  await form.submitButton.click();

  const otpPage = new OtpPage(page);
  await otpPage.expectVisible();
  const otp = await fetchOtp(inbox, { subject: new RegExp(studentSignupData.otp.emailSubject, 'i') });
  await otpPage.verify(otp);

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  return student;
}
