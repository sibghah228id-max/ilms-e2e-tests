import { type Page, type Locator, expect } from '@playwright/test';
import { ReactAriaPage, escapeRegExp } from './react-aria.page';
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
export class ProfilePage extends ReactAriaPage {
  readonly saveAndNextButton: Locator;
  readonly saveButton: Locator;
  readonly savedToast: Locator;
  /** Wall-clock time of the last Next.js refetch of /profile seen on this page (0 = none yet). */
  private lastProfileRefetchAt = 0;

  constructor(page: Page) {
    super(page);
    this.saveAndNextButton = page.getByRole('button', { name: 'Save & Next', exact: true });
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true });
    // Several saves in one run can leave stacked Toastify alerts with the same copy; assert the newest.
    this.savedToast = page.getByRole('alert').filter({ hasText: 'Data saved successfully!' }).last();
    page.on('request', (request) => {
      if (/\/profile\?_rsc=/.test(request.url())) this.lastProfileRefetchAt = Date.now();
    });
  }

  /**
   * Waits until the portal has stopped re-fetching the profile. After a save the app calls the
   * Next.js router refresh several times over the following seconds (observed ~1s, ~4s and
   * ~6-11s after "Save & Next"); each refetch of `/profile?_rsc=…` re-renders the step from the
   * saved data and discards any record added in the meantime. So editing waits until no such
   * refetch has started for `quiet` ms, giving up (but not failing) after `timeout` ms.
   */
  async waitForProfileRefetchesToSettle({ quiet = 5_500, timeout = 20_000 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await this.page.waitForLoadState('networkidle');
      const sinceLast = Date.now() - this.lastProfileRefetchAt;
      if (sinceLast >= quiet) return;
      await this.page.waitForTimeout(Math.min(quiet - sinceLast, deadline - Date.now()));
    }
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

  /**
   * "Save & Next" for the current step: waits for the success toast and for the next step's
   * heading, so the following assertions run against the new step.
   */
  async saveAndNext(nextHeading: string) {
    await this.saveAndNextButton.click();

    // A step that fails validation stays put, shows no toast and renders "… is required" style
    // messages; report those rather than a bare toast/heading timeout.
    const validationMessage = this.main.getByText(/is required|must (be|contain)/i);
    await expect(this.savedToast.or(validationMessage).first()).toBeVisible({ timeout: 30_000 });
    if (!(await this.savedToast.isVisible())) {
      throw new Error(`"Save & Next" was rejected: ${(await validationMessage.allInnerTexts()).join('; ')}`);
    }

    const next = this.heading(nextHeading);
    await expect(next.or(validationMessage).first()).toBeVisible({ timeout: 30_000 });
    if (!(await next.isVisible())) {
      throw new Error(`"Save & Next" was rejected: ${(await validationMessage.allInnerTexts()).join('; ')}`);
    }
    await expect(next).toBeVisible();
    // The saved profile is fetched again several times after the switch; let that settle before
    // editing, otherwise a record added now is wiped by the next re-render.
    await this.waitForProfileRefetchesToSettle();
  }

  /**
   * Clicks an "Add …" button and waits for its inline section heading. A section added while the
   * step is still reloading after a save is discarded by the re-render, so the refetch burst is
   * waited out first, and the section is checked again once the network is quiet and the click
   * is repeated if it vanished.
   */
  protected async addRecordSection(buttonName: string, sectionHeading: string) {
    await this.waitForProfileRefetchesToSettle();
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
    // The upload can take well over 10s on staging; the default 15s wait has timed out on it.
    const uploaded = this.page.waitForResponse(
      (r) => r.url().includes('/api/profile/avatar') && r.request().method() === 'POST',
      { timeout: 60_000 },
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
   *
   * Best effort only: the strip animates in and out and is re-rendered as completion changes, so
   * a click can land while the button has pointer events disabled (mid-transition) or after it has
   * detached. Either means the strip is going away by itself, so a failed click is never fatal.
   */
  async dismissProfileCompletionOverlays() {
    const candidates = [
      this.page.locator('div.sticky').getByRole('button', { name: 'Dismiss', exact: true }),
      this.page.locator('div.sticky').getByRole('button', { name: 'Close', exact: true }),
      this.page.getByRole('button', { name: 'Dismiss', exact: true }),
    ];
    for (const btn of candidates) {
      const target = btn.first();
      if (!(await target.isVisible().catch(() => false))) continue;

      for (let attempt = 0; attempt < 3; attempt++) {
        // Short timeout: if the button is not clickable quickly, it is most likely mid-transition.
        await target.click({ timeout: 2_000 }).catch(() => undefined);
        if (await target.isHidden().catch(() => true)) break;
        await this.page.waitForTimeout(500);
      }
      // Give the strip its exit animation, but never fail the step over it.
      await expect(target).toBeHidden({ timeout: 5_000 }).catch(() => undefined);
      break;
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
