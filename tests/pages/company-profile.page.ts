import { type Locator, expect } from '@playwright/test';
import { ProfilePage } from './profile.page';
import type { InternationalCompanyData } from './create-account.page';
import type { InternationalCompanyProfileData } from '../data/international-company-data';

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
    await expect(this.page.getByRole('button', { name: /^PK \| \+92/ })).toBeVisible();

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
