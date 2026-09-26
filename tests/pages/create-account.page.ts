import { type Page, type Locator, expect } from '@playwright/test';
import { ROLE_CONTENT } from '../data/role-content';

export const ROLES = ['IT Student', 'IT Professional', 'IT Company', 'Academia', 'International Company'] as const;

export const IT_STUDENT_BENEFITS = ROLE_CONTENT['IT Student'].benefits;

/** Role-selection step: /create-account */
export class RoleSelectionPage {
  readonly createAccountButton: Locator;
  readonly logoLink: Locator;
  readonly homeLink: Locator;
  /** Yellow (amber) notice box shown under the role cards. */
  readonly noticeBox: Locator;
  /** Green box shown for Academia (contact support). */
  readonly contactBox: Locator;
  readonly contactUsLink: Locator;

  constructor(private readonly page: Page) {
    this.createAccountButton = page.getByRole('button', { name: 'Create Account', exact: true });
    this.logoLink = page.getByRole('link').filter({ has: page.getByAltText('INDUS Tech Connect logo') });
    this.homeLink = page.locator('a[href="/login"]').filter({ has: page.locator('svg') });
    this.noticeBox = page.locator('div.bg-amber-50');
    this.contactBox = page.locator('div.bg-brand-50');
    this.contactUsLink = page.getByRole('link', { name: 'Contact Us' });
  }

  /** Checklist items (one per line) currently shown under the role cards. */
  async benefits(): Promise<string[]> {
    const text = await this.page.locator('div.mt-5.flex-col').innerText();
    return text.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  async goto() {
    await this.page.goto('/create-account', { waitUntil: 'networkidle' });
  }

  /** Role cards' accessible names include the icon alt text, so match on visible text. */
  roleCard(role: string): Locator {
    return this.page.getByRole('button').filter({ hasText: new RegExp(`^\\s*${role}\\s*$`) });
  }

  async borderColor(role: string): Promise<string> {
    return this.roleCard(role).evaluate((el) => getComputedStyle(el).borderColor);
  }
}

export type StudentData = {
  name: string;
  cnic: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: 'Male' | 'Female' | 'Other';
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  university: string;
};

/** IT Student registration form: /create-account/student */
export class StudentRegistrationPage {
  readonly name: Locator;
  readonly cnic: Locator;
  readonly dateOfBirth: Locator;
  readonly genderGroup: Locator;
  readonly email: Locator;
  readonly phone: Locator;
  readonly password: Locator;
  readonly confirmPassword: Locator;
  readonly university: Locator;
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    this.name = page.locator('#name');
    this.cnic = page.locator('#cnic');
    this.dateOfBirth = page.locator('#dateOfBirth');
    this.genderGroup = page.getByRole('radiogroup', { name: 'Gender' });
    this.email = page.locator('#email');
    this.phone = page.locator('#phone_e164');
    this.password = page.locator('#password');
    this.confirmPassword = page.locator('#confirmPassword');
    this.university = page.getByRole('combobox', { name: 'University' });
    this.submitButton = page.getByRole('button', { name: 'Create Account', exact: true });
  }

  async goto() {
    await this.page.goto('/create-account/student', { waitUntil: 'networkidle' });
  }

  /** The "Show password" eye button inside the same field wrapper as `input`. */
  eyeButton(input: Locator): Locator {
    return input.locator('xpath=..').getByRole('button', { name: /show password|hide password/i });
  }

  /** Validation message rendered below a field (a <p>), so field labels never match. */
  error(text: string | RegExp): Locator {
    return this.page.locator('p').filter({ hasText: text });
  }

  async selectUniversity(search: string, option: string) {
    await this.university.fill(search);
    await this.page.getByRole('option', { name: option, exact: true }).click();
    await expect(this.university).toHaveValue(option);
  }

  async fill(data: StudentData) {
    await this.name.fill(data.name);
    await this.cnic.fill(data.cnic);
    await this.dateOfBirth.fill(data.dateOfBirth);
    await this.genderGroup.getByText(data.gender, { exact: true }).click();
    await this.email.fill(data.email);
    await this.phone.fill(data.phone);
    await this.password.fill(data.password);
    await this.confirmPassword.fill(data.confirmPassword);
    await this.selectUniversity(data.university.split(' ')[0], data.university);
  }
}

/** YYYY-MM-DD for the date exactly `years` years before today. */
export function dateYearsAgo(years: number, extraDays = 0): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() + extraDays);
  return d.toISOString().slice(0, 10);
}
