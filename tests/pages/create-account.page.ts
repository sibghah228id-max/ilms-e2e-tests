import { type Page, type Locator, expect } from '@playwright/test';

export const ROLES = ['IT Student', 'IT Professional', 'IT Company', 'Academia', 'International Company'] as const;

/**
 * Dialing-code prefix rendered in the leading slot of a phone input. The widget differs per
 * environment (a "PK | +92" country button on live, a searchable "Dialing code" combobox showing
 * "+92" on staging), so target the slot itself and assert on the "+92" text it contains.
 */
export function phoneCountryOf(phone: Locator): Locator {
  return phone.locator('xpath=ancestor::div[@data-input-size][1]').locator('section[data-leading="true"]');
}

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

/**
 * Waits until the portal login page is actually rendered, not just until the URL changed.
 * The portal is a Next.js app: after a client-side navigation the URL flips to /login
 * immediately while the page still shows a "Loading..." spinner, so a URL-only assertion
 * passes before anything visible happens.
 */
export async function expectLoginPageRendered(page: Page, loginUrl: string) {
  await expect(page).toHaveURL((url) => [loginUrl, `${loginUrl}/`].includes(url.href), { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /Login to your INDUS Tech Connect account/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
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
  /** Dialing-code prefix shown before the phone input (defaults to Pakistan, "+92"). */
  readonly phoneCountry: Locator;
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
    this.phoneCountry = phoneCountryOf(this.phone);
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

  /**
   * The University field is a react-aria ComboBox: its listbox only opens on real key
   * presses, so `fill()` sets the value without ever showing the options.
   *
   * The options are loaded from the server, so typing before they arrive leaves the listbox
   * closed. Retype (and nudge with ArrowDown) until it opens, up to 30s in total.
   */
  async selectUniversity(search: string, option: string) {
    await this.university.click();

    await expect(async () => {
      await this.university.clear();
      await this.page.keyboard.type(search, { delay: 30 });
      const opened = await this.university
        .getAttribute('aria-expanded')
        .then((v) => v === 'true')
        .catch(() => false);
      if (!opened) await this.page.keyboard.press('ArrowDown');
      await expect(this.university).toHaveAttribute('aria-expanded', 'true', { timeout: 3_000 });
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });

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

export type ItProfessionalData = {
  name: string;
  cnic: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: 'Male' | 'Female' | 'Other';
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  yearsOfExperience: string;
  workStatus: 'Employed' | 'Freelancer' | 'Unemployed';
};

/** IT Professional registration form: /create-account/it-professional */
export class ItProfessionalRegistrationPage {
  readonly name: Locator;
  readonly cnic: Locator;
  readonly dateOfBirth: Locator;
  readonly genderGroup: Locator;
  readonly email: Locator;
  /** Dialing-code prefix shown before the phone input (defaults to Pakistan, "+92"). */
  readonly phoneCountry: Locator;
  readonly phone: Locator;
  readonly password: Locator;
  readonly confirmPassword: Locator;
  readonly yearsOfExperience: Locator;
  readonly workStatusGroup: Locator;
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    this.name = page.locator('#name');
    this.cnic = page.locator('#cnic');
    this.dateOfBirth = page.locator('#dateOfBirth');
    this.genderGroup = page.getByRole('radiogroup', { name: 'Gender' });
    this.email = page.locator('#email');
    // Professional form uses #phoneNumber (student form uses #phone_e164).
    this.phone = page.locator('#phoneNumber');
    this.phoneCountry = phoneCountryOf(this.phone);
    this.password = page.locator('#password');
    this.confirmPassword = page.locator('#confirmPassword');
    this.yearsOfExperience = page.locator('#yearsExperience');
    this.workStatusGroup = page.getByRole('radiogroup', { name: 'Current Work Status' });
    this.submitButton = page.getByRole('button', { name: 'Create Account', exact: true });
  }

  async goto() {
    await this.page.goto('/create-account/it-professional', { waitUntil: 'networkidle' });
  }

  async expectVisible() {
    await expect(this.page).toHaveURL(/\/create-account\/it-professional\/?$/);
    await expect(this.name).toBeVisible();
  }

  /** The "Show password" eye button inside the same field wrapper as `input`. */
  eyeButton(input: Locator): Locator {
    return input.locator('xpath=..').getByRole('button', { name: /show password|hide password/i });
  }

  async fill(data: ItProfessionalData) {
    await this.name.fill(data.name);
    await this.cnic.fill(data.cnic);
    await this.dateOfBirth.fill(data.dateOfBirth);
    await this.genderGroup.getByText(data.gender, { exact: true }).click();
    await this.email.fill(data.email);
    await this.phone.fill(data.phone);
    await this.password.fill(data.password);
    await this.confirmPassword.fill(data.confirmPassword);
    await this.yearsOfExperience.fill(data.yearsOfExperience);
    await this.workStatusGroup.getByText(data.workStatus, { exact: true }).click();
  }
}

export type InternationalCompanyData = {
  companyName: string;
  /** Option in the "Verticals" combobox. */
  vertical: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  /** Text typed into the "Country" combobox and the option it must resolve to. */
  countrySearch: string;
  countryOption: string | RegExp;
};

/** International Company registration form: /create-account/international */
export class InternationalCompanyRegistrationPage {
  readonly companyName: Locator;
  readonly vertical: Locator;
  readonly email: Locator;
  /** Dialing-code prefix shown before the phone input (defaults to Pakistan, "+92"). */
  readonly phoneCountry: Locator;
  readonly phone: Locator;
  readonly password: Locator;
  readonly confirmPassword: Locator;
  readonly country: Locator;
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    this.companyName = page.locator('#companyName');
    this.vertical = page.getByRole('combobox', { name: /^Verticals/ });
    this.email = page.locator('#companyEmail');
    this.phone = page.locator('#companyPhone');
    this.phoneCountry = phoneCountryOf(this.phone);
    this.password = page.locator('#password');
    this.confirmPassword = page.locator('#confirmPassword');
    this.country = page.getByRole('combobox', { name: /^Country/ });
    this.submitButton = page.getByRole('button', { name: 'Create Account', exact: true });
  }

  async goto() {
    await this.page.goto('/create-account/international', { waitUntil: 'networkidle' });
  }

  async expectVisible() {
    await expect(this.page).toHaveURL(/\/create-account\/international\/?$/);
    await expect(this.companyName).toBeVisible();
  }

  /** The "Show password" eye button inside the same field wrapper as `input`. */
  eyeButton(input: Locator): Locator {
    return input.locator('xpath=..').getByRole('button', { name: /show password|hide password/i });
  }

  /**
   * Picks an option in a react-aria combobox (Verticals, Country). The listbox only opens on real
   * key presses and its items load from the server, so typing is retried until the option shows.
   */
  private async selectOption(combo: Locator, search: string, option: string | RegExp) {
    const item = this.page.getByRole('option', { name: option, exact: typeof option === 'string' });
    await combo.click();
    await expect(async () => {
      await combo.fill('');
      if (search) await this.page.keyboard.type(search, { delay: 30 });
      if ((await combo.getAttribute('aria-expanded')) !== 'true') await this.page.keyboard.press('ArrowDown');
      await expect(item).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
    await item.click();
    await expect(combo).not.toHaveValue('');
  }

  async fill(data: InternationalCompanyData) {
    await this.companyName.fill(data.companyName);
    await this.selectOption(this.vertical, data.vertical, data.vertical);
    await this.email.fill(data.email);
    await this.phone.fill(data.phone);
    await this.password.fill(data.password);
    await this.confirmPassword.fill(data.confirmPassword);
    await this.selectOption(this.country, data.countrySearch, data.countryOption);
  }
}

export type ItCompanyData = {
  companyName: string;
  /** Option in the "Company Type" combobox. */
  companyType: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  address: string;
  /** Text typed into the "City" combobox and the option it must resolve to. */
  citySearch: string;
  cityOption: string | RegExp;
  website: string;
  /** Option in the "Verticals" combobox. */
  vertical: string;
};

/** IT Company registration form: /create-account/it-company */
export class ItCompanyRegistrationPage {
  readonly companyName: Locator;
  readonly companyType: Locator;
  readonly email: Locator;
  /** Dialing-code prefix shown before the phone input (defaults to Pakistan, "+92"). */
  readonly phoneCountry: Locator;
  readonly phone: Locator;
  readonly password: Locator;
  readonly confirmPassword: Locator;
  readonly address: Locator;
  readonly city: Locator;
  readonly website: Locator;
  readonly vertical: Locator;
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    this.companyName = page.locator('#companyName');
    this.companyType = page.getByRole('combobox', { name: /^Company Type/ });
    this.email = page.locator('#email');
    this.phone = page.locator('#phoneNumber');
    this.phoneCountry = phoneCountryOf(this.phone);
    this.password = page.locator('#password');
    this.confirmPassword = page.locator('#confirmPassword');
    this.address = page.locator('#address');
    this.city = page.getByRole('combobox', { name: /^City/ });
    this.website = page.locator('#companyWebsite');
    this.vertical = page.getByRole('combobox', { name: /^Verticals/ });
    this.submitButton = page.getByRole('button', { name: 'Create Account', exact: true });
  }

  async goto() {
    await this.page.goto('/create-account/it-company', { waitUntil: 'networkidle' });
  }

  async expectVisible() {
    await expect(this.page).toHaveURL(/\/create-account\/it-company\/?$/);
    await expect(this.companyName).toBeVisible();
  }

  /** The "Show password" eye button inside the same field wrapper as `input`. */
  eyeButton(input: Locator): Locator {
    return input.locator('xpath=..').getByRole('button', { name: /show password|hide password/i });
  }

  /**
   * Picks an option in a react-aria combobox (Company Type, City, Verticals). The listbox only
   * opens on real key presses and its items load from the server, so typing is retried until the
   * option shows. City has 700+ entries, so it is filtered by typing first.
   */
  private async selectOption(combo: Locator, search: string, option: string | RegExp) {
    const item = this.page.getByRole('option', { name: option, exact: typeof option === 'string' });
    await combo.click();
    await expect(async () => {
      await combo.fill('');
      if (search) await this.page.keyboard.type(search, { delay: 30 });
      if ((await combo.getAttribute('aria-expanded')) !== 'true') await this.page.keyboard.press('ArrowDown');
      await expect(item).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
    await item.click();
    await expect(combo).not.toHaveValue('');
  }

  async fill(data: ItCompanyData) {
    await this.companyName.fill(data.companyName);
    await this.selectOption(this.companyType, data.companyType, data.companyType);
    await this.email.fill(data.email);
    await this.phone.fill(data.phone);
    await this.password.fill(data.password);
    await this.confirmPassword.fill(data.confirmPassword);
    await this.address.fill(data.address);
    await this.selectOption(this.city, data.citySearch, data.cityOption);
    await this.website.fill(data.website);
    await this.selectOption(this.vertical, data.vertical, data.vertical);
  }
}
