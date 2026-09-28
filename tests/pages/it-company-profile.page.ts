import { expect, type Locator } from '@playwright/test';
import { CompanyProfilePage } from './company-profile.page';
import type { ItCompanyData } from './create-account.page';
import type { ItCompanyProfileData } from '../data/it-company-data';

/** Stepper entries of the IT Company wizard (sidebar buttons, accessible names). */
export const IT_COMPANY_PROFILE_STEPS = {
  companyInfo: 'Company Info',
  contact: 'Contact Information',
  stakeholders: 'Stakeholders / Partners',
  benefits: 'Benefits & Perks',
  expertise: 'Expertise',
  projects: 'Projects',
} as const;

/** Main headings shown for each IT Company step. */
export const IT_COMPANY_PROFILE_STEP_HEADINGS = {
  companyInfo: 'Company Information',
  contact: 'Contact Information',
  stakeholders: 'Stakeholder Details',
  benefits: 'Benefits & Perks',
  expertise: 'Expertise & Languages',
  projects: 'Projects',
} as const;

/**
 * IT Company profile wizard: /profile for a company registered in Pakistan.
 *
 * Six steps: Company Information → Contact Information → Stakeholder Details → Benefits & Perks →
 * Expertise & Languages → Projects (final "Save"). Shares the logo upload, expertise and save
 * handling with the international company wizard, so only the IT-specific steps live here.
 */
export class ItCompanyProfilePage extends CompanyProfilePage {
  // ---- Step 1: Company Information ----------------------------------------------------------

  /**
   * Registration filled the name, type, city, email (locked), vertical, website and head office;
   * the admin's SECP registration filled the NTN. Those are verified and kept. Headcount,
   * establishment date, LinkedIn, office phone, description and one Human Resource row are the
   * fields still empty for a new account.
   */
  async completeMissingCompanyInfo(
    data: ItCompanyProfileData['companyInfo'],
    company: Pick<ItCompanyData, 'companyName' | 'companyType' | 'cityOption' | 'email' | 'vertical' | 'website' | 'address'>,
  ) {
    await expect(this.byId('companyName')).toHaveValue(company.companyName);
    await expect(this.byId('companyType')).toHaveValue(company.companyType);
    await expect(this.byId('city')).toHaveValue(company.cityOption);
    await expect(this.byId('email')).toHaveValue(company.email);
    await expect(this.byId('email')).toBeDisabled();
    await expect(this.byId('industry')).toHaveValue(company.vertical);
    await expect(this.byId('website')).toHaveValue(company.website);
    await expect(this.byId('office')).toHaveValue(company.address);
    await expect(this.byId('companyNTN')).not.toHaveValue('');

    await this.pickComboIfEmpty(this.byId('employees'), '', data.employees);
    await this.fillIfEmpty(this.byId('estDate'), data.establishmentDate);
    await this.fillIfEmpty(this.byId('linkedin'), data.linkedin);
    await this.fillIfEmpty(this.byId('officePhone'), data.officePhone);
    await this.fillEditorIfEmpty(this.main.locator('[contenteditable="true"]').first(), data.description);

    // "Human Resource": the first area row (native <select> + headcount) is filled when empty.
    const areaSelect = this.main.locator('select').filter({ has: this.page.locator('option', { hasText: 'Select area' }) }).first();
    if (!(await areaSelect.inputValue())) {
      await areaSelect.selectOption({ label: data.humanResource.area });
    }
    await this.fillIfEmpty(this.main.getByPlaceholder('e.g. 10').first(), data.humanResource.count);
  }

  // ---- Step 2: Contact Information ----------------------------------------------------------

  /**
   * Fills both the primary contact (required) and the secondary contact (optional). Picking a
   * designation re-renders its section and drops text typed before it, so each section's combobox
   * goes first and every text field is re-checked (and refilled if wiped) before returning.
   */
  async completeMissingContacts(data: ItCompanyProfileData['contact'], company: Pick<ItCompanyData, 'email'>) {
    const sections = [
      { prefix: 'primary', ...data.primary, email: company.email },
      { prefix: 'secondary', ...data.secondary },
    ];
    for (const s of sections) {
      await this.pickComboIfEmpty(this.byId(`${s.prefix}.designation`), '', s.designation);
      const fields: Array<[string, string]> = [
        [`${s.prefix}.fullName`, s.fullName],
        [`${s.prefix}.email`, s.email],
        [`${s.prefix}.phone`, s.phone],
      ];
      for (const [id, value] of fields) await this.fillIfEmpty(this.byId(id), value);
      for (const [id, value] of fields) await this.fillIfEmpty(this.byId(id), value);
      await expect(this.byId(`${s.prefix}.designation`)).toHaveValue(s.designation);
    }
  }

  // ---- Step 3: Stakeholder Details ----------------------------------------------------------

  /** Fills the first stakeholder section (shown by default) and adds one more per extra entry. */
  async addStakeholders(stakeholders: ItCompanyProfileData['stakeholders']) {
    for (let i = 0; i < stakeholders.length; i++) {
      const section = this.main.getByRole('heading', { name: `Stakeholder ${i + 1}`, exact: true });
      if (!(await section.isVisible())) {
        await this.page.getByRole('button', { name: 'Add Stakeholder', exact: true }).click();
        await expect(section).toBeVisible();
      }
      const s = stakeholders[i];
      // Designation first: its pick re-renders the section and drops text typed before it.
      await this.pickComboIfEmpty(this.byId(`stakeholders.${i}.designation`), '', s.designation);
      const fields: Array<[string, string]> = [
        [`stakeholders.${i}.fullName`, s.fullName],
        [`stakeholders.${i}.email`, s.email],
        [`stakeholders.${i}.phone`, s.phone],
      ];
      for (const [id, value] of fields) await this.fillIfEmpty(this.byId(id), value);
      for (const [id, value] of fields) await this.fillIfEmpty(this.byId(id), value);
    }
  }

  // ---- Step 4: Benefits & Perks -------------------------------------------------------------

  /**
   * The step is an accordion of five categories ("Health & Wellness", ...). Opening a category
   * reveals its options as label rows, each wrapping a visually hidden checkbox; clicking a row
   * toggles it. Every other available option of every category is selected. Returns the number
   * of options selected.
   */
  async selectAlternatingBenefits(): Promise<number> {
    let selected = 0;
    const categories = this.main.getByRole('button', {
      name: /^(Health & Wellness|Culture & Engagement|Office Equipment|Compensation & Awards|Learning & Growth)/,
    });
    await expect(categories).toHaveCount(5);
    for (let c = 0; c < 5; c++) {
      const category = categories.nth(c);
      const options = this.benefitOptions(category);
      if (!(await options.count())) await category.click();
      await expect(options.first()).toBeVisible();

      const n = await options.count();
      for (let i = 0; i < n; i += 2) {
        const option = options.nth(i);
        if (!(await option.locator('input[type="checkbox"]').isChecked())) await option.click();
        await expect(option.locator('input[type="checkbox"]'), `benefit "${await option.innerText()}" selected`).toBeChecked();
        selected++;
      }
    }
    return selected;
  }

  /** Option rows of a category: the list that follows its button while the category is open. */
  private benefitOptions(category: Locator): Locator {
    return category.locator('xpath=following-sibling::*[1]').locator('label').filter({ has: this.page.locator('input[type="checkbox"]') });
  }

  // ---- Step 6: Projects ---------------------------------------------------------------------

  /** Adds one project record; the step then ends with the wizard's final "Save". */
  async addProject(data: ItCompanyProfileData['project']) {
    // The step re-fetches after the previous save; a section added in that window is discarded,
    // so the shared helper re-checks it once the network is quiet and clicks again if needed.
    await this.addRecordSection('Add Project', 'Projects 1');

    await this.byId('projects.0.name').fill(data.name);
    await this.byId('projects.0.client').fill(data.client);
    await this.addTag(this.page.getByRole('combobox', { name: /^Skills Used/ }), data.skillUsed);
    await this.page.locator('textarea[name="projects.0.description"]').fill(data.description);
    await this.byId('projects.0.deliveryDate').fill(data.deliveryDate);
  }
}
