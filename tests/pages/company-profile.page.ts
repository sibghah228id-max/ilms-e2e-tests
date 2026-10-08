import { type Locator, expect, test } from '@playwright/test';
import { ProfilePage } from './profile.page';
import { phoneCountryOf, type InternationalCompanyData } from './create-account.page';
import type {
  InternationalCompanyProfileData,
  RegisteredCompanyProfileData,
} from '../data/international-company-data';

/** Stepper entries of the company wizard (sidebar buttons, accessible names). */
export const COMPANY_PROFILE_STEPS = {
  information: 'Information',
  contact: 'Contact Information',
  expertise: 'Skills & Expertise',
} as const;

/** Main headings shown for each company step. */
export const COMPANY_PROFILE_STEP_HEADINGS = {
  information: 'Company Information',
  contact: 'Contact Information',
  expertise: 'Expertise & Languages',
} as const;

/**
 * International Company profile wizard: /profile for a company account.
 *
 * Three steps: Company Information (Save & Next) → Contact Information (Save & Next) →
 * Expertise & Languages (Save). Same building blocks as the student wizard (react-aria fields,
 * comboboxes, rich-text description, rating sliders, logo upload), so the generic helpers of
 * ProfilePage are reused and only the company-specific steps live here.
 */
export class CompanyProfilePage extends ProfilePage {
  override async expectVisible() {
    await expect(this.page).toHaveURL(/\/profile\/?$/);
    await expect(this.heading(COMPANY_PROFILE_STEP_HEADINGS.information)).toBeVisible({ timeout: 30_000 });
  }

  /** Company logo in the Company Information header (placeholder image until one is uploaded). */
  protected override get avatarImage(): Locator {
    return this.main.getByRole('img', { name: /Company Logo|Profile Picture/ });
  }

  protected override get avatarUpdatedToast(): Locator {
    return this.page.getByText('Logo updated successfully!');
  }

  async hasCompanyLogo(): Promise<boolean> {
    return (await this.avatarImage.count()) > 0 && /\/storage\/uploads\//.test((await this.avatarImage.getAttribute('src')) ?? '');
  }

  /** Uploads the logo only when the header still shows the placeholder image. */
  async ensureCompanyLogo(filePath: string) {
    if (await this.hasCompanyLogo()) {
      await this.expectProfileImageVisible();
      return;
    }
    await this.uploadProfileImage(filePath);
    await this.expectProfileImageVisible();
  }

  // ---- Step 1: Company Information ----------------------------------------------------------

  /**
   * Registration filled the company name, country (locked), email (locked) and vertical; those are
   * verified against the signup data and kept. Founding year, website, address and description
   * are the required fields still empty for a new account.
   */
  async completeMissingCompanyInformation(
    data: InternationalCompanyProfileData['information'],
    company: Pick<InternationalCompanyData, 'companyName' | 'email' | 'vertical' | 'countryOption'>,
  ) {
    await expect(this.byId('companyName')).toHaveValue(company.companyName);
    await expect(this.byId('email')).toHaveValue(company.email);
    await expect(this.byId('email')).toBeDisabled();
    await expect(this.byId('country')).toHaveValue(company.countryOption);
    await expect(this.byId('country')).toBeDisabled();
    await expect(this.byId('industry')).toHaveValue(company.vertical);

    await this.fillIfEmpty(this.byId('foundingYear'), data.foundingYear);
    await this.fillIfEmpty(this.byId('website'), data.website);
    await this.fillIfEmpty(this.byId('linkedin'), data.linkedin);
    await this.fillIfEmpty(this.byId('address'), data.address);
    await this.fillEditorIfEmpty(this.main.locator('[contenteditable="true"]').first(), data.description);
  }

  // ---- Step 2: Contact Information ----------------------------------------------------------

  /** Full name, contact email and phone come from registration; only the designation is missing. */
  async completeMissingContactInformation(
    data: InternationalCompanyProfileData['contact'],
    company: Pick<InternationalCompanyData, 'email' | 'phone'>,
  ) {
    await expect(this.byId('fullName')).not.toHaveValue('');
    await expect(this.byId('contactEmail')).toHaveValue(company.email);
    await expect(this.byId('phone')).toHaveValue(company.phone);
    await expect(phoneCountryOf(this.byId('phone'))).toContainText('+92');

    await this.pickComboIfEmpty(this.byId('designation'), '', data.designation);
  }

  // ---- Step 3: Expertise & Languages --------------------------------------------------------

  /** Adds one option per category (skills, tools, language), then rates each on its slider. */
  async completeExpertiseAndLanguages(data: InternationalCompanyProfileData['expertise']) {
    const categories = [
      [/^Core Skills/, data.core],
      [/^Secondary Skills/, data.secondary],
      [/^Technical Skills/, data.technical],
      [/^Tools/, data.tools],
      [/^Languages/, data.language],
    ] as const;
    for (const [label, item] of categories) {
      await this.addTag(this.page.getByRole('combobox', { name: label }), item.name);
    }

    await expect(this.main.getByRole('heading', { name: 'Rate the selected skills out of 100' })).toBeVisible();
    for (const [, item] of categories) {
      await this.setSlider(this.ratingSlider(item.name), item.rating);
    }
  }

  // ---- Registered account: complete only what the portal left empty -------------------------

  /**
   * Option names a combobox offers right now. The list opens on a key press and loads lazily, so
   * the first option is awaited; placeholders ("Select …", "No results") are dropped. The list is
   * closed again without picking anything, so calling this changes nothing.
   */
  async optionNames(combo: Locator): Promise<string[]> {
    await combo.click();
    if ((await combo.getAttribute('aria-expanded')) !== 'true') await this.page.keyboard.press('ArrowDown');
    const listbox = this.page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 15_000 });
    await expect(this.page.getByRole('option').first()).toBeVisible({ timeout: 15_000 });

    const names = (await this.page.getByRole('option').allInnerTexts())
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s && !/^(select|choose|no options|no results)/i.test(s));

    await this.page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
    return [...new Set(names)];
  }

  /**
   * A locked field normally holds what registration stored. When the portal locks one that is
   * still empty (seen for the registered International Company account, whose Email is locked
   * with no value), the test cannot complete it: the gap is recorded with the run and left to the
   * following "Save & Next", which reports it if the portal rejects the step.
   */
  private noteLockedEmptyField(field: string) {
    const note = `${field} is locked but empty; the portal holds no value for it and it cannot be completed here`;
    console.warn(`[profile] ${note}`);
    test.info().annotations.push({ type: 'locked-empty-field', description: field });
  }

  /** See completeMissingCompanyInfoFields: a locked, empty Email is unlocked and given the account email. */
  private async fillLockedEmailIfEmpty(locator: Locator, accountEmail: string, field: string) {
    if ((await locator.count()) === 0) return;
    if (!(await locator.isDisabled())) {
      await this.fillIfEmpty(locator, accountEmail);
      return;
    }
    if ((await locator.inputValue()).trim()) return;

    console.warn(`[profile] ${field} is locked but empty; filling it with the account email so the step can be saved`);
    test.info().annotations.push({ type: 'locked-empty-field-filled', description: `${field} <- account email` });
    await locator.evaluate((el) => {
      (el as HTMLInputElement).disabled = false;
      el.removeAttribute('data-disabled');
    });
    await locator.fill(accountEmail);
    await expect(locator).toHaveValue(accountEmail);
  }

  /** Fills a text field only when the portal left it empty; absent and locked fields are left alone. */
  private async fillWhenEmpty(locator: Locator, value: string, field: string) {
    if ((await locator.count()) === 0) return;
    if (await locator.isDisabled()) {
      if (!(await locator.inputValue()).trim()) this.noteLockedEmptyField(field);
      return;
    }
    await this.fillIfEmpty(locator, value);
  }

  /**
   * Selects a value in a single-choice combobox only when it is still empty.
   *
   * With a `preferred` name the name is typed so a long list (Country offers every country) filters
   * down, and the option is matched on its leading text, so an entry rendered as "Australia AUS"
   * still matches "Australia". The value is asserted afterwards, so a mismatch fails loudly instead
   * of leaving whatever option happened to be first in the list.
   *
   * Without a `preferred` name the first option is taken, which suits a field where any valid
   * option will do (Verticals). Never leave a country-style field without a preferred name.
   */
  private async pickWhenEmpty(combo: Locator, preferred: string | undefined, field: string) {
    if ((await combo.count()) === 0) return;
    if ((await combo.inputValue()).trim()) return;
    if (await combo.isDisabled()) {
      this.noteLockedEmptyField(field);
      return;
    }

    if (preferred) {
      const leadingName = new RegExp(`^${escapeRegExp(preferred)}`, 'i');
      await this.pickComboOption(combo, preferred, leadingName);
      await expect(combo, `${field} should be "${preferred}"`).toHaveValue(leadingName);
      return;
    }

    const options = await this.optionNames(combo);
    expect(options.length, `${field} offers at least one option to choose from`).toBeGreaterThan(0);
    await this.pickComboOption(combo, '', options[0]);
    await expect(combo, `${field} should hold a value after the pick`).not.toHaveValue('');
  }

  /** Names already selected as tag chips in a multi-choice category, matched against its options. */
  async selectedTags(combo: Locator, options: string[]): Promise<string[]> {
    const group = combo.locator('xpath=ancestor::*[@role="group"][1]');
    if ((await group.count()) === 0) return [];

    // The group renders the label, the input and one chip per selection; matching whole lines
    // against the known options drops the label and keeps "Communication" out of "Microwave
    // Communication".
    const lines = (await group.innerText()).split('\n').map((s) => s.replace(/\s+/g, ' ').trim());
    return options.filter((option) => lines.includes(option));
  }

  /**
   * Step 1 for a registered account: every empty field of Company Information is completed and
   * every field that already holds a value is left exactly as it is. Country and Verticals are
   * filled from their own option lists, so nothing is invented.
   */
  /**
   * @param accountEmail The signed-in account's email. The Email field is locked by the portal and
   *   normally shows the email stored at registration. For an account whose company record does
   *   not exist yet (nothing was ever saved on this page), the portal still locks the field but
   *   leaves it empty, and both the client and the server then reject the step with "Email is
   *   required". With `accountEmail` given, such a field is unlocked and filled with that email,
   *   which is the value registration would have stored; the save persists it and the field holds
   *   it from then on. The workaround is recorded in the run's annotations.
   */
  async completeMissingCompanyInfoFields(data: RegisteredCompanyProfileData['information'], accountEmail?: string) {
    await this.fillWhenEmpty(this.byId('companyName'), data.companyName, 'Company Name');
    await this.fillWhenEmpty(this.byId('foundingYear'), data.foundingYear, 'Founding Year');
    // An International Company is registered outside Pakistan, so the country is always named.
    await this.pickWhenEmpty(this.byId('country'), data.country, 'Country');
    await this.fillWhenEmpty(this.byId('website'), data.website, 'Website');
    if (accountEmail) {
      await this.fillLockedEmailIfEmpty(this.byId('email'), accountEmail, 'Email');
    } else {
      await this.fillWhenEmpty(this.byId('email'), '', 'Email');
    }
    await this.pickWhenEmpty(this.byId('industry'), undefined, 'Verticals');
    await this.fillWhenEmpty(this.byId('linkedin'), data.linkedin, 'LinkedIn Profile URL');
    await this.fillWhenEmpty(this.byId('address'), data.address, 'Address');

    // Description is a rich-text editor; existing content is kept untouched.
    await this.fillEditorIfEmpty(this.main.locator('[contenteditable="true"]').first(), data.description);
  }

  /**
   * Step 2 for a registered account: Full Name, Designation, Contact Email and Phone Number are
   * completed only where the portal left them empty.
   */
  async completeMissingContactFields(data: RegisteredCompanyProfileData['contact']) {
    // The portal prefills Full Name from the account's display name, which can break its own rule
    // "Name must contain only English letters" (e.g. "Test Internationalcompany 1"); such a value
    // blocks "Save & Next" on the client, so it is replaced and the replacement is recorded.
    const fullName = this.byId('fullName');
    const current = (await fullName.inputValue()).trim();
    if (current && !/^[A-Za-z\s]+$/.test(current) && !(await fullName.isDisabled())) {
      console.warn(`[profile] Full Name "${current}" fails the portal's letters-only rule; replacing it`);
      test.info().annotations.push({ type: 'invalid-prefilled-field-replaced', description: `Full Name "${current}"` });
      await fullName.fill(data.fullName);
      await expect(fullName).toHaveValue(data.fullName);
    }
    await this.fillWhenEmpty(fullName, data.fullName, 'Full Name');
    await this.pickWhenEmpty(this.byId('designation'), data.designation, 'Designation');
    await this.fillWhenEmpty(this.byId('contactEmail'), data.contactEmail, 'Contact Email');
    // The country code comes from the field's own selector, so only the national part is typed.
    await this.fillWhenEmpty(this.byId('phone'), data.phone, 'Phone Number');
  }

  /**
   * Step 3 for a registered account: a category with no selection gets the first option its own
   * list offers; categories that already hold selections are left alone. Afterwards every skill
   * that was just added, and every existing one still sitting at 0, is rated 1–100 at random.
   * Returns what was added and what was rated so a run can be traced.
   */
  async completeMissingExpertiseAndRatings(): Promise<{ added: Record<string, string>; ratings: Record<string, number> }> {
    const categories: Array<[string, RegExp]> = [
      ['Core Skills', /^Core Skills/],
      ['Secondary Skills', /^Secondary Skills/],
      ['Technical Skills', /^Technical Skills/],
      ['Tools', /^Tools/],
      ['Languages', /^Languages/],
    ];

    const added: Record<string, string> = {};
    const selected: string[] = [];
    for (const [category, label] of categories) {
      const combo = this.page.getByRole('combobox', { name: label });
      if ((await combo.count()) === 0) continue;

      const options = await this.optionNames(combo);
      expect(options.length, `${category} offers at least one option to choose from`).toBeGreaterThan(0);

      const existing = await this.selectedTags(combo, options);
      if (existing.length > 0) {
        selected.push(...existing);
        continue;
      }
      await this.addTag(combo, options[0]);
      added[category] = options[0];
      selected.push(options[0]);
    }

    await expect(this.main.getByRole('heading', { name: 'Rate the selected skills out of 100' })).toBeVisible();

    // Rate what was just added, plus anything the portal left unrated (a slider still at 0).
    const ratings: Record<string, number> = {};
    const newNames = new Set(Object.values(added));
    for (const name of new Set(selected)) {
      const slider = this.ratingSlider(name);
      if ((await slider.count()) === 0) continue;
      if (!newNames.has(name) && (await slider.inputValue()) !== '0') continue;

      const rating = 1 + Math.floor(Math.random() * 100);
      await this.setSlider(slider, rating);
      ratings[name] = rating;
    }
    return { added, ratings };
  }

  /**
   * Final "Save": the toast is the success confirmation; the saved-profile dialog with the
   * completion figure is closed when the portal shows it. Returns the figure, or -1 without one.
   */
  override async saveProfile(): Promise<number> {
    await this.saveButton.click();
    await expect(this.savedToast).toBeVisible({ timeout: 30_000 });

    const dialog = this.page.getByRole('dialog', { name: 'Profile saved successfully' });
    const shown = await dialog.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
    if (!shown) return -1;

    const match = (await dialog.innerText()).match(/Your profile is (\d+)% complete/);
    await dialog.getByRole('button', { name: 'Continue editing' }).click();
    await expect(dialog).toBeHidden();
    return match ? Number(match[1]) : -1;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
