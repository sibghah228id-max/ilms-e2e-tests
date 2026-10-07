import { type Page, type Locator, expect } from '@playwright/test';
import type { SkillRating, StudentProfileData } from '../data/student-profile-data';

/** Stepper entries (sidebar buttons, accessible names without the number/status). */
export const PROFILE_STEPS = {
  personal: 'Personal Details',
  education: 'Education',
  skills: 'Skills & Languages',
  experience: 'Experience (Optional)',
  achievements: 'Certifications & Achievements',
} as const;

/** Main headings shown for each step; "Save & Next" moves to the next one. */
export const PROFILE_STEP_HEADINGS = {
  personal: 'Personal Details',
  education: 'Educations',
  skills: 'Skills & Language',
  experience: 'Experience',
  achievements: 'Certificates',
} as const;

/** Main headings for the IT Professional wizard (Work Experience comes before Skills). */
export const PROFESSIONAL_PROFILE_STEP_HEADINGS = {
  personal: 'Personal Details',
  education: 'Educations',
  /** Work Experience step; the form heading matches the student Experience step. */
  experience: 'Experience',
  skills: 'Skills & Language',
  certifications: 'Certificates',
  projects: 'Projects',
} as const;

/**
 * Student profile wizard: /profile.
 *
 * Five steps share one page; a stepper on the side switches between them and "Save & Next" saves
 * the current step (toast "Data saved successfully!") and opens the next one. Text inputs are
 * react-aria fields whose labels end in "*", comboboxes only open on real key presses, and the
 * description fields are rich-text editors (contenteditable). Repeatable records (education,
 * experience, certificates, achievements, publications) are inline sections added with an
 * "Add …" button; their inputs carry stable ids such as `experiences.0.title`.
 */
export class ProfilePage {
  readonly main: Locator;
  readonly saveAndNextButton: Locator;
  readonly saveButton: Locator;
  readonly savedToast: Locator;

  constructor(protected readonly page: Page) {
    this.main = page.locator('main');
    this.saveAndNextButton = page.getByRole('button', { name: 'Save & Next', exact: true });
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true });
    // Several saves in one run can leave stacked Toastify alerts with the same copy; assert the newest.
    this.savedToast = page.getByRole('alert').filter({ hasText: 'Data saved successfully!' }).last();
  }

  async expectVisible() {
    await expect(this.page).toHaveURL(/\/profile\/?$/);
    await expect(this.heading(PROFILE_STEP_HEADINGS.personal)).toBeVisible({ timeout: 30_000 });
  }

  /** Step heading in the form area. */
  heading(name: string): Locator {
    return this.main.getByRole('heading', { level: 1, name, exact: true });
  }

  /** Stepper button for a step; its text also carries the status ("Pending", "Completed", ...). */
  stepButton(step: keyof typeof PROFILE_STEPS): Locator {
    return this.page.getByRole('button', { name: PROFILE_STEPS[step], exact: true });
  }

  async openStep(step: keyof typeof PROFILE_STEPS) {
    await this.stepButton(step).click();
    await expect(this.heading(PROFILE_STEP_HEADINGS[step])).toBeVisible();
  }

  async openPersonalDetails() {
    await this.openStep('personal');
  }

  /** Input with id `id` (ids of repeatable records contain dots, so an attribute selector is used). */
  protected byId(id: string): Locator {
    return this.page.locator(`[id="${id}"]`);
  }

  /** Fills a text-like input only when it is still empty; existing values are left untouched. */
  async fillIfEmpty(locator: Locator, value: string) {
    // A step can re-render once more shortly after it opens (its data is fetched again), which
    // wipes a value typed in that window. Re-check once the network is quiet and refill if so.
    await expect(async () => {
      if (!(await locator.inputValue()).trim()) {
        await locator.fill(value);
      }
      await this.page.waitForLoadState('networkidle');
      await expect(locator).not.toHaveValue('', { timeout: 1_000 });
    }).toPass({ timeout: 20_000, intervals: [500, 1_000] });
  }

  /**
   * Picks an option in a react-aria combobox. The listbox opens only on real key presses, so the
   * search text is typed; `optionName` selects a specific option, otherwise the first match wins.
   * Multi-select comboboxes keep their popover open after a pick, so it is closed explicitly.
   */
  async pickComboOption(combo: Locator, search: string, optionName?: string | RegExp, { multi = false } = {}) {
    // A string name must match exactly ("Communication" is also part of "Microwave Communication").
    const option = optionName
      ? this.page.getByRole('option', { name: optionName, exact: typeof optionName === 'string' })
      : this.page.getByRole('option').first();
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

    // The list re-renders while the search text filters it, so a click can land on an option that
    // is being replaced and commit nothing (the typed text then looks like a value until the form
    // validates). Repeat the whole pick until the combobox reports the chosen option as its value.
    await expect(async () => {
      await combo.click();
      if (search) {
        await combo.fill('');
        await this.page.keyboard.type(search, { delay: 30 });
      }
      if ((await combo.getAttribute('aria-expanded')) !== 'true') await this.page.keyboard.press('ArrowDown');
      await expect(option).toBeVisible({ timeout: 3_000 });

      const chosen = normalize(await option.innerText());
      await option.click();
      if (!multi) {
        await expect
          .poll(async () => normalize(await combo.inputValue()), { timeout: 3_000 })
          .toBe(chosen);
        // Option lists load lazily; a pick made against a list that is still loading is dropped
        // when the data arrives. Re-check once the network has settled so such a revert retries.
        await this.page.waitForLoadState('networkidle');
        await expect
          .poll(async () => normalize(await combo.inputValue()), { timeout: 2_000 })
          .toBe(chosen);
      }
    }).toPass({ timeout: 45_000, intervals: [500, 1_000, 2_000] });

    // Single-select comboboxes close on their own after a pick, and Escape while they are still
    // open would revert the selection. Multi-select ones stay open, so only those get Escape.
    const listbox = this.page.getByRole('listbox');
    const stillOpen = await listbox.waitFor({ state: 'hidden', timeout: 2_000 }).then(() => false, () => true);
    if (stillOpen) await this.page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
  }

  /** Single-value combobox: picks an option only when nothing is selected yet. */
  async pickComboIfEmpty(combo: Locator, search: string, optionName?: string | RegExp) {
    if (!(await combo.inputValue()).trim()) {
      await this.pickComboOption(combo, search, optionName);
    }
    await expect(combo).not.toHaveValue('');
  }

  /** Multi-select combobox: adds `optionName` as a tag unless that tag is already present. */
  async addTag(combo: Locator, optionName: string) {
    const tag = combo.locator('xpath=ancestor::*[@role="group"][1]').getByText(optionName, { exact: true });
    if (await tag.count()) return;
    await this.pickComboOption(combo, optionName, optionName, { multi: true });
    // Typed search text stays in the input after a multi-select pick; clear it for the next one.
    if (await combo.inputValue()) await combo.fill('');
    await expect(tag).toBeVisible();
  }

  /** Types into a rich-text editor only when it has no content yet. */
  async fillEditorIfEmpty(editor: Locator, text: string) {
    if (!(await editor.innerText()).trim()) {
      await editor.click();
      await this.page.keyboard.type(text);
    }
    await expect(editor).toContainText(text.slice(0, 40));
  }

  /**
   * Moves a react-aria range slider to `target` with the keyboard (PageUp/PageDown for big steps,
   * arrows for single steps), driven by the value the slider actually reports after each key.
   */
  async setSlider(slider: Locator, target: number) {
    expect(target, 'slider rating must be within 1–100').toBeGreaterThanOrEqual(1);
    expect(target).toBeLessThanOrEqual(100);

    await slider.focus();
    let current = Number(await slider.inputValue());
    for (let guard = 0; current !== target && guard < 200; guard++) {
      const diff = target - current;
      const key = Math.abs(diff) >= 10 ? (diff > 0 ? 'PageUp' : 'PageDown') : diff > 0 ? 'ArrowRight' : 'ArrowLeft';
      await slider.press(key);
      const next = Number(await slider.inputValue());
      if (next === current) throw new Error(`Slider did not move on ${key} (stuck at ${current}, target ${target})`);
      current = next;
    }
    await expect(slider).toHaveValue(String(target));
  }

  /**
   * "Save & Next" for the current step: waits for the success toast and for the next step's
   * heading, so the following assertions run against the new step.
   */
  async saveAndNext(nextHeading: string) {
    await this.saveAndNextButton.click();
    await expect(this.savedToast).toBeVisible({ timeout: 30_000 });

    // A step that fails validation stays put and shows "… is required" messages; report those
    // rather than a bare missing-heading timeout.
    const next = this.heading(nextHeading);
    const validationMessage = this.main.getByText(/is required|must (be|contain)/i);
    await expect(next.or(validationMessage).first()).toBeVisible({ timeout: 30_000 });
    if (!(await next.isVisible())) {
      throw new Error(`"Save & Next" was rejected: ${(await validationMessage.allInnerTexts()).join('; ')}`);
    }
    await expect(next).toBeVisible();
    // The saved profile is fetched again right after the switch; let that settle before editing.
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Clicks an "Add …" button and waits for its inline section heading. A section added while the
   * step is still reloading after a save is discarded by the re-render, so the section is checked
   * again once the network is quiet and the click is repeated if it vanished.
   */
  protected async addRecordSection(buttonName: string, sectionHeading: string) {
    // Prefer the first matching heading: some roles reuse the same title for every record
    // (e.g. IT Professional education sections are all "Education Details").
    const section = this.main.getByRole('heading', { name: sectionHeading, exact: true }).first();
    await expect(async () => {
      if (!(await section.isVisible())) {
        await this.page.getByRole('button', { name: buttonName, exact: true }).click();
        await expect(section).toBeVisible({ timeout: 5_000 });
      }
      await this.page.waitForLoadState('networkidle');
      await expect(section).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
  }

  /**
   * Final "Save" on the last step. Besides the toast, the portal opens a "Profile saved
   * successfully" dialog that reports the new completion percentage; it is acknowledged here so
   * the page can be used afterwards. Returns that percentage.
   */
  async saveProfile(): Promise<number> {
    await this.saveButton.click();
    await expect(this.savedToast).toBeVisible({ timeout: 30_000 });

    const dialog = this.page.getByRole('dialog', { name: 'Profile saved successfully' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    const match = (await dialog.innerText()).match(/Your profile is (\d+)% complete/);
    expect(match, 'completion percentage in the saved-profile dialog').not.toBeNull();

    await dialog.getByRole('button', { name: 'Continue editing' }).click();
    await expect(dialog).toBeHidden();
    return Number(match![1]);
  }

  // ---- Step 1: Personal Details -------------------------------------------------------------

  /**
   * Registration already filled name, email, phone, date of birth and gender; those are checked
   * and kept. City, address and description are the required fields still empty for a new account.
   */
  async completeMissingPersonalDetails(data: StudentProfileData['personal']) {
    await expect(this.byId('fullName')).not.toHaveValue('');
    await expect(this.byId('email')).not.toHaveValue('');
    await expect(this.byId('phone_e164')).not.toHaveValue('');
    await expect(this.byId('dob')).not.toHaveValue('');
    await expect(this.page.getByRole('radiogroup', { name: 'Gender' }).getByRole('radio', { checked: true })).toHaveCount(1);

    await this.pickComboIfEmpty(this.page.getByRole('combobox', { name: /^City/ }), data.citySearch, new RegExp(`^${data.citySearch}`));
    await this.fillIfEmpty(this.byId('address'), data.address);
    await this.fillEditorIfEmpty(this.main.locator('[contenteditable="true"]').first(), data.description);
  }

  // ---- Step 1: profile image ----------------------------------------------------------------

  /** Hidden file input behind the "Upload avatar" control next to the avatar (PNG/JPEG). */
  protected get avatarInput(): Locator {
    return this.page.locator('#avatar-upload');
  }

  /** Uploaded avatar shown in the Personal Details header; absent while the placeholder icon shows. */
  protected get avatarImage(): Locator {
    return this.main.getByRole('img', { name: 'Profile Picture' });
  }

  async hasProfileImage(): Promise<boolean> {
    return (await this.avatarImage.count()) > 0;
  }

  /**
   * Uploads an image through the hidden file input. The portal opens a "Crop profile picture"
   * dialog first; confirming it posts the avatar straight away (independent of "Save & Next").
   */
  async uploadProfileImage(filePath: string) {
    await this.avatarInput.setInputFiles(filePath);

    const cropDialog = this.page.getByRole('dialog', { name: 'Crop profile picture' });
    await expect(cropDialog).toBeVisible();
    const uploaded = this.page.waitForResponse(
      (r) => r.url().includes('/api/profile/avatar') && r.request().method() === 'POST',
    );
    await cropDialog.getByRole('button', { name: 'Crop & upload' }).click();

    const response = await uploaded;
    expect(response.ok(), `avatar upload responded ${response.status()}`).toBeTruthy();
    await expect(cropDialog).toBeHidden();
    await expect(this.avatarUpdatedToast).toBeVisible();
  }

  /** Success toast after the upload; companies get different wording (see CompanyProfilePage). */
  protected get avatarUpdatedToast(): Locator {
    return this.page.getByText('Avatar updated successfully!');
  }

  /** The avatar is rendered from the stored upload rather than the placeholder icon. */
  async expectProfileImageVisible() {
    await expect(this.avatarImage).toBeVisible();
    await expect(this.avatarImage).toHaveAttribute('src', /\/storage\/uploads\//);
  }

  /** Uploads a profile image only when none is present yet. */
  async ensureProfileImage(filePath: string) {
    if (await this.hasProfileImage()) {
      await this.expectProfileImageVisible();
      return;
    }
    await this.uploadProfileImage(filePath);
    await this.expectProfileImageVisible();
  }

  // ---- Step 2: Education --------------------------------------------------------------------

  /**
   * Completes the first education record. IT Students already have one from registration (the
   * university chosen at signup may already be in it); IT Professionals start with none, so an
   * "Add Education" record is created first (section heading "Education Details"). Whatever is
   * present is kept, the rest of that same record is completed, and no second record is added.
   */
  async completeMissingEducationDetails(
    data: Omit<StudentProfileData['education'], 'semester' | 'fypName' | 'fypDetails'> & {
      semester?: string;
      endYear?: string;
      /** Required only when the chosen semester is 7th or 8th (final year). */
      fypName?: string;
      fypDetails?: string;
    },
  ) {
    // Fields: Degree Type, Institution, Campus and Semester are dropdowns; Program and Student ID
    // are text inputs; Start Year is a month picker. The step fetches its option lists after it
    // opens, and picking Campus reloads the dependent lists. A selection made before such a reload
    // keeps its text but loses its key, so Degree Type is picked last, once the network is quiet,
    // and everything is re-checked right before the caller saves.
    await this.page.waitForLoadState('networkidle');

    // Students get educations.0 from signup; IT Professionals show an empty step until added.
    // The added section is headed "Education Details" (not "Education 1").
    if ((await this.byId('educations.0.institutionId').count()) === 0) {
      await this.addRecordSection('Add Education', 'Education Details');
    }

    await this.pickComboIfEmpty(this.byId('educations.0.institutionId'), data.institutionSearch, data.institution);
    await this.pickComboIfEmpty(this.byId('educations.0.campusId'), '', new RegExp(`^${escapeRegExp(data.campus)}`));

    // Program is a free-text input (placeholder "e.g. BS Computer Science") typed by the user.
    const program = this.main.getByRole('textbox', { name: /^Program/ });
    await this.fillIfEmpty(program, data.program);

    await this.fillIfEmpty(this.byId('educations.0.studentId'), data.studentId);

    // Semester is student-only; professionals use Subjects / End Year instead.
    const semester = this.byId('educations.0.semester');
    if ((await semester.count()) > 0 && data.semester) {
      await this.pickComboIfEmpty(semester, '', data.semester);
    }

    // Choosing the 7th or 8th semester reveals the final-year project fields, both required.
    const fypName = this.main.getByRole('textbox', { name: /^FYP Name/ });
    const fypDetails = this.main.getByRole('textbox', { name: /^FYP Details/ });
    const finalYear = /^(7|8)(th)?\b/i.test(data.semester ?? '');
    if (finalYear) {
      await expect(fypName, 'FYP Name should appear for the 7th/8th semester').toBeVisible();
      await expect(fypDetails, 'FYP Details should appear for the 7th/8th semester').toBeVisible();
      expect(data.fypName, 'fypName is required in the test data for the 7th/8th semester').toBeTruthy();
      expect(data.fypDetails, 'fypDetails is required in the test data for the 7th/8th semester').toBeTruthy();
      await this.fillIfEmpty(fypName, data.fypName!);
      await this.fillIfEmpty(fypDetails, data.fypDetails!);
    } else {
      await expect(fypName, 'FYP fields should stay hidden before the 7th semester').toHaveCount(0);
    }

    await this.fillIfEmpty(this.byId('educations.0.startYear'), data.startYear);

    const endYear = this.byId('educations.0.endYear');
    if ((await endYear.count()) > 0 && data.endYear) {
      await this.fillIfEmpty(endYear, data.endYear);
    }

    await this.page.waitForLoadState('networkidle');
    await this.pickComboIfEmpty(this.byId('educations.0.degreeType'), data.degreeType.slice(0, 4), new RegExp(`^${data.degreeType}`));

    const requiredIds = [
      'educations.0.degreeType',
      'educations.0.institutionId',
      'educations.0.campusId',
      'educations.0.studentId',
      'educations.0.startYear',
    ];
    if ((await semester.count()) > 0 && data.semester) requiredIds.push('educations.0.semester');
    if ((await endYear.count()) > 0 && data.endYear) requiredIds.push('educations.0.endYear');

    for (const id of requiredIds) {
      await expect(this.byId(id), `${id} should still hold its value before saving`).not.toHaveValue('');
    }
    await expect(program, 'Program should still hold its value before saving').not.toHaveValue('');
    if (finalYear) {
      await expect(fypName, 'FYP Name should still hold its value before saving').not.toHaveValue('');
      await expect(fypDetails, 'FYP Details should still hold its value before saving').not.toHaveValue('');
    }
  }

  // ---- Step 3: Skills & Languages -----------------------------------------------------------

  /** Adds one option per category, then rates each selected item on its 0–100 slider. */
  async completeSkillsAndLanguages(data: StudentProfileData['skills']) {
    const categories: Array<[RegExp, SkillRating]> = [
      [/^Core Skills/, data.core],
      [/^Secondary Skills/, data.secondary],
      [/^Technical Skills/, data.technical],
      [/^Languages/, data.language],
    ];
    for (const [label, skill] of categories) {
      await this.addTag(this.page.getByRole('combobox', { name: label }), skill.name);
    }

    await expect(this.main.getByRole('heading', { name: 'Rate the selected skills out of 100' })).toBeVisible();
    for (const [, skill] of categories) {
      await this.setSlider(this.ratingSlider(skill.name), skill.rating);
    }
  }

  /**
   * Rating slider for a selected skill. The slider has no accessible name of its own: each rating
   * row shows the skill name followed by a group holding the range input, so the slider is found
   * through the element that follows the name. (The same name also appears as a tag chip in the
   * combobox, but that chip has no slider next to it.)
   */
  ratingSlider(skillName: string): Locator {
    return this.main.getByText(skillName, { exact: true }).locator('xpath=following-sibling::*[1]').getByRole('slider');
  }

  /**
   * Dismisses sticky/sidebar "Profile Completion" strips that sit over the top of the form and
   * intercept clicks (common once completion climbs during the wizard).
   */
  async dismissProfileCompletionOverlays() {
    const candidates = [
      this.page.locator('div.sticky').getByRole('button', { name: 'Dismiss', exact: true }),
      this.page.locator('div.sticky').getByRole('button', { name: 'Close', exact: true }),
      this.page.getByRole('button', { name: 'Dismiss', exact: true }),
    ];
    for (const btn of candidates) {
      if (await btn.first().isVisible().catch(() => false)) {
        await btn.first().click();
        await expect(btn.first()).toBeHidden({ timeout: 5_000 }).catch(() => undefined);
        break;
      }
    }
  }

  // ---- Step 4: Experience -------------------------------------------------------------------

  /** Adds a single experience record; nothing exists here for a freshly registered student. */
  async addExperience(data: StudentProfileData['experience']) {
    await this.dismissProfileCompletionOverlays();
    await expect(this.main.getByRole('heading', { name: /^Experience \d+$/ })).toHaveCount(0);
    await this.addRecordSection('Add Experience', 'Experience 1');

    // React-aria radios: the <input> is covered by its <label>, so click the visible label text
    // (same pattern as Gender on the registration form). Skip if already selected.
    const jobTypeGroup = this.page.getByRole('radiogroup', { name: 'Job Type' });
    const jobTypeRadio = jobTypeGroup.getByRole('radio', { name: data.jobType, exact: true });
    if (!(await jobTypeRadio.isChecked())) {
      await jobTypeGroup.getByText(data.jobType, { exact: true }).click();
    }
    await expect(jobTypeRadio).toBeChecked();

    await this.byId('experiences.0.title').fill(data.jobTitle);
    await this.byId('experiences.0.company').fill(data.company);
    await this.byId('experiences.0.startDate').fill(data.startDate);
    await this.byId('experiences.0.endDate').fill(data.endDate);
    await this.addTag(this.page.getByRole('combobox', { name: /^Skills Gained/ }), data.skillGained);
    await this.fillEditorIfEmpty(this.main.locator('[contenteditable="true"]').last(), data.description);
  }

  // ---- Step 5: Certificates, Achievements, Publications -------------------------------------

  async addCertificate(data: StudentProfileData['certificate']) {
    await this.addRecordSection('Add Certificate', 'Certificate 1');

    await this.byId('certifications.0.name').fill(data.name);
    await this.byId('certifications.0.organization').fill(data.issuingOrganization);
    await this.byId('certifications.0.issuedDate').fill(data.issuedDate);
    await this.byId('certifications.0.credential').fill(data.credential);
  }

  async addAchievement(data: StudentProfileData['achievement']) {
    await this.addRecordSection('Add Achievement', 'Achievement 1');

    await this.byId('achievements.0.awardType').fill(data.award);
    await this.byId('achievements.0.organization').fill(data.issuingOrganization);
    await this.byId('achievements.0.awardedDate').fill(data.awardedDate);
  }

  async addPublication(data: StudentProfileData['publication']) {
    await this.addRecordSection('Add Publication', 'Publication 1');

    await this.byId('publications.0.title').fill(data.title);

    // Category offers a list when it is a combobox; otherwise it is a plain text field.
    const category = this.byId('publications.0.category');
    if ((await category.getAttribute('role')) === 'combobox') {
      await this.pickComboOption(category, data.category.slice(0, 3));
    } else {
      await category.fill(data.category);
    }
    await expect(category).not.toHaveValue('');

    await this.byId('publications.0.publishDate').fill(data.publishDate);
    await this.byId('publications.0.linkOrDoi').fill(data.link);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
