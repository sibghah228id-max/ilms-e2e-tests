import { expect, type Locator, type Page } from '@playwright/test';
import { OtpPage } from '../pages/otp.page';
import type { InvalidPasswordCase } from '../data/password-policy';

/** The parts of a registration page object the password checks need; every role's form has them. */
export type SignupPasswordForm = {
  password: Locator;
  confirmPassword: Locator;
  submitButton: Locator;
};

/**
 * Enters `invalid.password` (confirmed with the same value, so only the policy rule can fail),
 * submits, and checks that the portal shows the expected message and does not move on to the
 * OTP step. The rest of the form is expected to be filled with valid data beforehand.
 */
export async function expectPasswordRejected(page: Page, form: SignupPasswordForm, invalid: InvalidPasswordCase) {
  await form.password.fill(invalid.password);
  await form.confirmPassword.fill(invalid.password);
  const formUrl = page.url();

  await form.submitButton.click();

  if (invalid.shownAs === 'field') {
    // Browser-side rule: the message is rendered under the Password field (and Confirm Password).
    await expect(page.getByText(invalid.message, { exact: true }).first()).toBeVisible();
  } else {
    // Server-side rule: the form is posted, the API rejects it and the portal toasts the message.
    await expect(page.getByRole('alert').filter({ hasText: invalid.message }).first()).toBeVisible({ timeout: 30_000 });
  }

  // Signup does not continue: still on the registration form, no OTP step, value left to correct.
  await expect(page).toHaveURL(formUrl);
  await expect(new OtpPage(page).heading).toHaveCount(0);
  await expect(form.password).toHaveValue(invalid.password);
}
