import { type Locator, expect, test } from '@playwright/test';
import { ReactAriaPage, escapeRegExp } from './react-aria.page';

/** Wizard tabs of the job form (buttons; a tab stays disabled until its step is reachable). */
export const POST_JOB_STEPS = {
  basicInfo: 'Step 1 : Basic Info',
  jobDetails: 'Step 2 : Job Details',
  compensation: 'Step 3 : Compensation & Settings',
  review: 'Review and Publish',
} as const;

/** The five job-type cards of step 1, in the order the portal renders them. */
export const JOB_TYPES = ['Onsite', 'Hybrid', 'Remote', 'Contract', 'Freelance'] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** The two job-shift radios of step 1. */
export const JOB_SHIFTS = ['Day', 'Night'] as const;
export type JobShift = (typeof JOB_SHIFTS)[number];

/**
 * "Post New Job" wizard: /jobs/new for a company account.
 *
 * Four tabs — Basic Info → Job Details → Compensation & Settings → Review and Publish — share one
 * URL; "Next" moves on without a navigation. Step 1 holds Job Title, the five job-type cards, City,
 * the vacancy stepper, the job-shift radios and the minimum-experience slider.
 *
 * City is filtered by the portal to the company's own country, which is what keeps a job in the
 * country chosen at signup; selectCityInCompanyCountry() verifies that rather than trusting it.
 */
export class PostJobPage extends ReactAriaPage {
  /**
   * A job-type card is selected purely through its styling: the portal gives it the brand
   * background and border and renders no aria-pressed/aria-checked/data-selected state. So the
   * marker class is the only signal available, and it is read in this one place.
   */
  private static readonly SELECTED_CARD_CLASS = /bg-brand-25/;

  get heading(): Locator {
    return this.main.getByRole('heading', { name: 'Post New Job' });
  }

  get nextButton(): Locator {
    return this.main.getByRole('button', { name: 'Next', exact: true });
  }

  get previousButton(): Locator {
    return this.main.getByRole('button', { name: 'Previous', exact: true });
  }

  get saveAsDraftButton(): Locator {
    return this.main.getByRole('button', { name: 'Save as draft', exact: true });
  }

  /**
   * Wizard tab button; `disabled` marks a step that cannot be opened yet.
   *
   * The review step's summary repeats "Step N : …" as the heading of each of its sections, so the
   * name matches twice there. The tab strip is always rendered above that summary, hence `.first()`.
   */
  stepTab(step: keyof typeof POST_JOB_STEPS): Locator {
    return this.main.getByRole('button', { name: POST_JOB_STEPS[step], exact: true }).first();
  }

  /**
   * Field-level validation the form renders in place when a step is rejected. "Only letters
   * allowed" is the Job Title rule (the field takes letters and spaces, no digits), which is why
   * this matches more than the usual "… is required".
   */
  private get validationMessage(): Locator {
    return this.main.getByText(/is required|must (be|contain)|only letters|please (select|enter)/i);
  }

  // ---- Step 1: Basic Info -------------------------------------------------------------------

  get jobTitle(): Locator {
    return this.byId('title');
  }

  get cityCombo(): Locator {
    return this.byId('city_id');
  }

  get jobTypeCards(): Locator {
    return this.fieldByLabel(/^Job Type/).getByRole('button');
  }

  jobTypeCard(type: JobType): Locator {
    return this.fieldByLabel(/^Job Type/).getByRole('button', { name: type, exact: true });
  }

  private get vacancyField(): Locator {
    return this.fieldByLabel(/^No\. of Vacancies/);
  }

  /** Vacancy count; the input carries no id or accessible name, only `inputmode="numeric"`. */
  get vacancyInput(): Locator {
    return this.vacancyField.locator('input[inputmode="numeric"]');
  }

  get vacancyPlus(): Locator {
    return this.vacancyField.getByRole('button', { name: '+', exact: true });
  }

  get vacancyMinus(): Locator {
    return this.vacancyField.getByRole('button', { name: '-', exact: true });
  }

  /** The radiogroup is labelled with the field name the portal posts ("shift_id"). */
  get shiftGroup(): Locator {
    return this.page.getByRole('radiogroup', { name: /shift/i });
  }

  shiftRadio(shift: JobShift): Locator {
    return this.shiftGroup.getByRole('radio', { name: shift, exact: true });
  }

  private get experienceGroup(): Locator {
    return this.fieldByLabel(/^Minimum Experience/).locator('[role="group"]');
  }

  /** Visually hidden range input behind the handle; it reports the value and its bounds. */
  get experienceSlider(): Locator {
    return this.experienceGroup.getByRole('slider');
  }

  /** The bar the handle travels along. The value read-out below it is also `[data-orientation]`. */
  private get experienceTrack(): Locator {
    return this.experienceGroup.locator('[data-orientation="horizontal"]').first();
  }

  private get experienceHandle(): Locator {
    return this.experienceGroup.locator('.cursor-grab');
  }

  /** "1 year" / "N years" read-out rendered under the handle. */
  get experienceReadout(): Locator {
    return this.experienceGroup.locator('output');
  }

  /** Step 1 is rendered: the URL, the page heading and the first field. */
  async expectVisible(timeout = 60_000) {
    await expect(this.page).toHaveURL(/\/jobs\/new\/?$/, { timeout });
    await expect(this.heading).toBeVisible({ timeout });
    await expect(this.jobTitle).toBeVisible({ timeout });
    // Later steps are locked until step 1 is accepted, which is what a passing "Next" changes.
    await expect(this.stepTab('jobDetails')).toBeDisabled();
  }

  async fillJobTitle(title: string) {
    await this.jobTitle.fill(title);
    await expect(this.jobTitle).toHaveValue(title);
  }

  /** Names of the job-type cards that currently show as selected (normally exactly one). */
  async selectedJobTypes(): Promise<string[]> {
    const cards = await this.jobTypeCards.all();
    const selected: string[] = [];
    for (const card of cards) {
      const className = (await card.getAttribute('class')) ?? '';
      if (PostJobPage.SELECTED_CARD_CLASS.test(className)) {
        selected.push((await card.innerText()).trim());
      }
    }
    return selected;
  }

  /**
   * Picks one of the five job-type cards. The portal preselects "Onsite", so the card is clicked
   * only when it is not already the selected one, and afterwards exactly one card — the chosen
   * one — must show as selected, which also proves the previous selection was dropped.
   */
  async selectJobType(type: JobType) {
    await expect(this.jobTypeCards).toHaveCount(JOB_TYPES.length);
    await expect(this.jobTypeCards).toHaveText([...JOB_TYPES]);

    const selected = await this.selectedJobTypes();
    if (selected.length !== 1 || selected[0] !== type) {
      await this.jobTypeCard(type).click();
    }
    await expect
      .poll(() => this.selectedJobTypes(), {
        message: `exactly one job-type card should be selected, and it should be "${type}"`,
        timeout: 10_000,
      })
      .toEqual([type]);
  }

  /**
   * Selects a city from the list the portal offers, which it filters to the company's own country.
   *
   * `companyCountry` is the live value of the locked Country field on the company profile, written
   * as the country name followed by its ISO-3166 alpha-3 code ("Australia AUS"); city options are
   * written as the city name followed by the alpha-2 code ("Sydney AU"). The two codes cannot be
   * compared directly (alpha-2 is not reliably the first two letters of alpha-3 — Austria is AUT
   * but AT), so `expected` names both the country the account is registered in and the alpha-2
   * code its cities carry, and both are checked before a city is picked:
   *
   *  - the profile must still name `expected.country`, otherwise the account moved and the city
   *    in the fixtures belongs to the wrong country;
   *  - every city the portal offers must carry `expected.cityCountryCode`, which is what proves
   *    the list really is the company's country and nobody else's.
   *
   * `expected.city` is taken when the list offers it, otherwise the first city is used. Returns
   * the selected option as the combobox reports it.
   */
  async selectCityInCompanyCountry(
    companyCountry: string,
    expected: { country: string; cityCountryCode: string; city?: string },
  ): Promise<string> {
    expect(
      companyCountry,
      `the company profile names "${companyCountry}" but the job fixtures expect ` +
        `"${expected.country}"; update country/cityCountryCode/city in the fixtures together`,
    ).toMatch(new RegExp(`^${escapeRegExp(expected.country)}\\b`, 'i'));

    const options = await this.optionNames(this.cityCombo);
    expect(options.length, 'the City list should offer at least one city').toBeGreaterThan(0);

    const cities = options.map(parseCityOption);
    const codes = [...new Set(cities.map((c) => c.code))];
    expect(
      codes,
      `the City list should hold cities of one country only, got ${options.join(', ')}`,
    ).toEqual([expected.cityCountryCode]);

    test.info().annotations.push({
      type: 'job-city-country',
      description: `${companyCountry} -> ${options.length} cities (${codes[0]})`,
    });

    const chosen = cities.find((c) => c.name === expected.city) ?? cities[0];
    if (expected.city && chosen.name !== expected.city) {
      console.warn(`[post-job] City "${expected.city}" is not offered for ${companyCountry}; using "${chosen.name}"`);
    }
    // The option's accessible name comes from its label slot (the city name); its text also carries
    // the country code from the description slot, so both renderings are accepted.
    await this.pickComboOption(
      this.cityCombo,
      chosen.name,
      new RegExp(`^${escapeRegExp(chosen.name)}(\\s+${escapeRegExp(chosen.code)})?$`),
    );
    await expect(this.cityCombo).toHaveValue(new RegExp(`^${escapeRegExp(chosen.name)}`));
    return (await this.cityCombo.inputValue()).trim();
  }

  async vacancies(): Promise<number> {
    return Number((await this.vacancyInput.inputValue()).trim());
  }

  /**
   * Sets the vacancy count to `target` with the "+" and "-" buttons, exercising both and keeping
   * the value above 0 throughout.
   *
   * The portal renders the stepper at 0 on a fresh form. "-" is therefore first checked at that
   * floor, where it must not produce a negative number, and the count is then raised to `target`
   * one click at a time. "-" is exercised on the way back from `target`, which needs `target` to
   * be at least 2 so the value never drops to 0.
   */
  async setVacancies(target: number) {
    expect(target, 'the vacancy target must be at least 2 so "-" can be tested above 0').toBeGreaterThanOrEqual(2);

    // "-" at the floor: the count must stay where it is instead of going negative.
    const start = await this.vacancies();
    if (start === 0) {
      await this.vacancyMinus.click();
      await expect(this.vacancyInput, '"-" must not take the vacancy count below 0').toHaveValue('0');
    }

    // One click, one vacancy, up or down to the target (a fresh form always counts up from 0).
    await this.stepVacanciesTo(target);

    // "-": one click, one vacancy fewer, and only while the count stays above 0.
    await this.vacancyMinus.click();
    await expect(this.vacancyInput, '"-" should lower the vacancy count by one').toHaveValue(String(target - 1));
    expect(target - 1, 'the vacancy count must stay above 0 while "-" is exercised').toBeGreaterThan(0);

    await this.vacancyPlus.click();
    await expect(this.vacancyInput).toHaveValue(String(target));
    expect(await this.vacancies(), 'the vacancy count must end up above 0').toBeGreaterThan(0);
  }

  /**
   * Clicks "+" or "-" one vacancy at a time until the count reads `target`, asserting the step
   * after every click. `target` is never below 1, so stepping down cannot reach 0 either.
   */
  private async stepVacanciesTo(target: number) {
    expect(target, 'the vacancy count must stay above 0').toBeGreaterThan(0);
    for (let value = await this.vacancies(); value !== target; ) {
      const up = value < target;
      await (up ? this.vacancyPlus : this.vacancyMinus).click();
      value += up ? 1 : -1;
      await expect(this.vacancyInput, `"${up ? '+' : '-'}" should change the vacancy count by one`).toHaveValue(
        String(value),
      );
    }
    await expect(this.vacancyInput).toHaveValue(String(target));
  }

  /**
   * Picks a job shift. The radio input is covered by its label, so the visible label text is
   * clicked (same react-aria pattern as the profile form's radios).
   */
  async selectJobShift(shift: JobShift) {
    await expect(this.shiftGroup.getByRole('radio')).toHaveCount(JOB_SHIFTS.length);
    if (!(await this.shiftRadio(shift).isChecked())) {
      await this.shiftGroup.getByText(shift, { exact: true }).click();
    }
    await expect(this.shiftRadio(shift)).toBeChecked();
  }

  /**
   * Sets Minimum Experience by dragging the slider handle along its bar.
   *
   * The handle is dragged to the position `years` sits at between the slider's own min and max, so
   * no pixel offsets are assumed. A drag can land a step or two off, so the keyboard finishes the
   * move exactly; both the slider's value and the visible "N years" read-out are then asserted.
   */
  async dragMinimumExperience(years: number) {
    const slider = this.experienceSlider;
    await slider.scrollIntoViewIfNeeded();
    const min = Number(await slider.getAttribute('min'));
    const max = Number(await slider.getAttribute('max'));
    expect(years, `Minimum Experience must be within the slider's ${min}–${max}`).toBeGreaterThanOrEqual(min);
    expect(years, `Minimum Experience must be within the slider's ${min}–${max}`).toBeLessThanOrEqual(max);
    expect(min, 'the experience slider should not offer a negative minimum').toBeGreaterThanOrEqual(0);

    const track = await this.experienceTrack.boundingBox();
    const handle = await this.experienceHandle.boundingBox();
    expect(track, 'the experience slider bar should be measurable').not.toBeNull();
    expect(handle, 'the experience slider handle should be measurable').not.toBeNull();

    const y = handle!.y + handle!.height / 2;
    await this.page.mouse.move(handle!.x + handle!.width / 2, y);
    await this.page.mouse.down();
    await this.page.mouse.move(track!.x + (track!.width * (years - min)) / (max - min), y, { steps: 15 });
    await this.page.mouse.up();

    // The drag itself has to do the work: landing near the target proves the handle followed the
    // pointer, so a drag that goes nowhere fails here instead of being covered up by the keyboard.
    const tolerance = Math.max(2, Math.ceil((max - min) / 20));
    await expect
      .poll(async () => Math.abs(Number(await slider.inputValue()) - years), {
        message: `dragging the handle should land within ${tolerance} of ${years} years`,
        timeout: 10_000,
      })
      .toBeLessThanOrEqual(tolerance);

    // The drag gets close; the keyboard lands on the exact value.
    await this.setSlider(slider, years);

    // The chosen value is the one the form shows the user.
    await expect(this.experienceReadout).toHaveText(`${years} ${years === 1 ? 'year' : 'years'}`);
    await expect(slider).toHaveAttribute('aria-valuetext', String(years));
  }

  /**
   * "Next" on step 1. A step that fails validation stays put and renders its "… is required"
   * messages, so those are reported instead of a bare timeout on the next step's fields.
   */
  async next() {
    await expect(this.nextButton).toBeEnabled();
    await this.nextButton.click();

    const validationMessage = this.validationMessage;
    const nextStep = this.requiredSkills;
    await expect(nextStep.or(validationMessage).first()).toBeVisible({ timeout: 60_000 });
    if (!(await nextStep.isVisible())) {
      throw new Error(`"Next" was rejected: ${(await validationMessage.allInnerTexts()).join('; ')}`);
    }
  }

  // ---- Step 2: Job Details ------------------------------------------------------------------

  get requiredSkills(): Locator {
    return this.main.getByRole('combobox', { name: /^Required Skills/ });
  }

  /** Job Description is a rich-text editor, the only contenteditable on the step. */
  get jobDescription(): Locator {
    return this.main.locator('[contenteditable="true"]').first();
  }

  /**
   * "Qualification Required" opt-in, which reveals the Minimum Qualification dropdown.
   *
   * The checkbox has no accessible name of its own: the portal puts it in a `<label>` of its own
   * and the wording in a sibling element, so getByRole('checkbox', { name: … }) finds nothing.
   * It is therefore reached from that wording — the nearest enclosing block that holds a checkbox.
   */
  get qualificationRequiredCheckbox(): Locator {
    return this.main
      .getByText('Qualification Required', { exact: true })
      .locator('xpath=ancestor::div[.//input[@type="checkbox"]][1]')
      .getByRole('checkbox');
  }

  /** Minimum Qualification dropdown; rendered only once the opt-in above is ticked. */
  get qualificationCombo(): Locator {
    return this.byId('degree_level_id');
  }

  /**
   * Ticks "Qualification Required" and picks the minimum qualification it then offers (the portal
   * lists Bachelors, Masters and PhD). The checkbox input itself is wrapped in its label, so the
   * label is clicked, and the dropdown is awaited rather than assumed to be there already.
   */
  async setQualificationRequired(qualification: string) {
    const checkbox = this.qualificationRequiredCheckbox;
    await expect(checkbox, 'step 2 should offer the "Qualification Required" checkbox').toHaveCount(1);
    await expect(this.qualificationCombo, 'the qualification dropdown should be hidden until asked for').toHaveCount(0);

    if (!(await checkbox.isChecked())) {
      await checkbox.locator('xpath=ancestor::label[1]').click();
    }
    await expect(checkbox).toBeChecked();

    await expect(this.qualificationCombo, 'ticking "Qualification Required" should reveal the dropdown').toBeVisible({
      timeout: 30_000,
    });
    await this.pickComboOption(this.qualificationCombo, qualification, qualification);
    await expect(this.qualificationCombo, `the minimum qualification should be "${qualification}"`).toHaveValue(
      qualification,
    );
  }

  /**
   * Step 2 has opened: its own fields are rendered, step 1's are gone, its wizard tab is no longer
   * disabled and "Previous" offers the way back. Step 3 stays locked until step 2 is completed.
   */
  async expectJobDetailsStep() {
    await expect(this.requiredSkills).toBeVisible({ timeout: 60_000 });
    await expect(this.main.getByText(/^Job Description/)).toBeVisible();
    await expect(this.previousButton).toBeVisible();
    await expect(this.stepTab('jobDetails')).toBeEnabled();
    await expect(this.stepTab('compensation')).toBeDisabled();
    // Step 1's fields are unmounted rather than hidden, so the wizard really did move on.
    await expect(this.jobTitle).toHaveCount(0);
    await expect(this.cityCombo).toHaveCount(0);
  }

  /**
   * Fills step 2: one required skill as a tag and the job description, which are the step's only
   * required fields. Both are asserted to hold their value so "Next" is never clicked on an empty
   * step. A `qualification` additionally ticks the optional "Qualification Required" opt-in and
   * picks that minimum qualification; without one the opt-in is left alone.
   */
  async completeJobDetails({
    requiredSkill,
    description,
    qualification,
  }: {
    requiredSkill: string;
    description: string;
    qualification?: string;
  }) {
    await this.addTag(this.requiredSkills, requiredSkill);
    await this.fillEditorIfEmpty(this.jobDescription, description);
    await expect(this.skillTag(requiredSkill), `"${requiredSkill}" should be added as a required skill`).toBeVisible();
    await expect(this.jobDescription).not.toBeEmpty();

    if (qualification) {
      await this.setQualificationRequired(qualification);
    }
  }

  /** Tag chip of a selected required skill. */
  skillTag(skill: string): Locator {
    return this.requiredSkills.locator('xpath=ancestor::*[@role="group"][1]').getByText(skill, { exact: true });
  }

  /** "Next" on step 2; rejects with the form's own validation text, like next() on step 1. */
  async nextToJobSettings() {
    await expect(this.nextButton).toBeEnabled();
    await this.nextButton.click();

    const nextStep = this.applicationDeadline;
    await expect(nextStep.or(this.validationMessage).first()).toBeVisible({ timeout: 60_000 });
    if (!(await nextStep.isVisible())) {
      throw new Error(`"Next" was rejected on Job Details: ${(await this.validationMessage.allInnerTexts()).join('; ')}`);
    }
  }

  // ---- Step 3: Compensation & Settings ------------------------------------------------------

  /** Native date input; the portal sets its `min` to today, so only future dates are accepted. */
  get applicationDeadline(): Locator {
    return this.byId('application_deadline');
  }

  get statusCombo(): Locator {
    return this.byId('status');
  }

  /**
   * Field wrapper of the salary slider. Its label sits in a header row beside the "150k – 500k"
   * read-out rather than next to the slider, so the wrapper is the nearest ancestor holding both.
   */
  private get salaryField(): Locator {
    return this.main
      .locator('label')
      .filter({ hasText: /^Salary Range/ })
      .locator('xpath=ancestor::div[.//*[@role="group"]][1]');
  }

  private get salaryGroup(): Locator {
    return this.salaryField.locator('[role="group"]').first();
  }

  /** The two visually hidden range inputs: [0] is the minimum thumb, [1] the maximum. */
  get salarySliders(): Locator {
    return this.rangeInputs(this.salaryGroup);
  }

  /** "150k – 500k" read-out next to the field label. */
  get salaryReadout(): Locator {
    return this.salaryField.getByText(/^\s*\d+k\s*[–-]\s*\d+k\s*$/);
  }

  /** "Visible To" checkbox; the portal ships with both of them ticked. */
  visibleToCheckbox(audience: string): Locator {
    return this.main.getByRole('checkbox', { name: audience, exact: true });
  }

  /** Step 3 is rendered: its fields are there, step 2's are gone and publishing is still locked. */
  async expectJobSettingsStep() {
    await expect(this.applicationDeadline).toBeVisible({ timeout: 60_000 });
    await expect(this.salarySliders).toHaveCount(2);
    await expect(this.statusCombo).toBeVisible();
    await expect(this.addScreeningQuestionButton).toBeVisible();
    await expect(this.reviewAndPublishButton).toBeVisible();
    await expect(this.stepTab('compensation')).toBeEnabled();
    // The review tab unlocks only once this step has been accepted.
    await expect(this.stepTab('review')).toBeDisabled();
    await expect(this.requiredSkills).toHaveCount(0);
  }

  async setApplicationDeadline(isoDate: string) {
    // The portal sets `min` to today. ISO dates compare correctly as plain strings.
    const min = await this.applicationDeadline.getAttribute('min');
    if (min) {
      expect(
        isoDate >= min,
        `the Application Deadline ${isoDate} must not be before the portal's minimum ${min}`,
      ).toBeTruthy();
    }
    await this.applicationDeadline.fill(isoDate);
    await expect(this.applicationDeadline).toHaveValue(isoDate);
  }

  /**
   * Sets the salary range by dragging the two handles of the range slider, then checks the figure
   * the form shows the user. The dragging itself is the shared range-slider handling.
   */
  async setSalaryRange(minK: number, maxK: number) {
    await this.setRangeSlider(this.salaryGroup, minK, maxK);
    await expect(this.salaryReadout).toHaveText(new RegExp(`^\\s*${minK}k\\s*[–-]\\s*${maxK}k\\s*$`));
  }

  /**
   * Ticks the named "Visible To" audiences and leaves the others alone. The checkbox input is
   * covered by its label, so the visible label text is clicked. At least one must end up ticked,
   * which the portal requires.
   */
  async setVisibleTo(audiences: string[]) {
    expect(audiences.length, 'at least one "Visible To" audience must be selected').toBeGreaterThan(0);
    await expect(this.main.getByRole('checkbox')).toHaveCount(2);

    for (const audience of audiences) {
      const checkbox = this.visibleToCheckbox(audience);
      await expect(checkbox, `"${audience}" should be offered under "Visible To"`).toHaveCount(1);
      if (!(await checkbox.isChecked())) {
        await this.main.getByText(audience, { exact: true }).click();
      }
      await expect(checkbox).toBeChecked();
    }

    const checked = await this.main.getByRole('checkbox').evaluateAll((boxes) =>
      boxes.filter((box) => (box as HTMLInputElement).checked).length,
    );
    expect(checked, 'at least one "Visible To" checkbox must be ticked').toBeGreaterThan(0);
  }

  async selectStatus(status: string) {
    await this.pickComboOption(this.statusCombo, status, status);
    await expect(this.statusCombo).toHaveValue(status);
  }

  // ---- Step 3: screening questions ----------------------------------------------------------

  /** "Add" next to the Screening Questions heading; it opens the question modal. */
  get addScreeningQuestionButton(): Locator {
    return this.main.getByRole('button', { name: 'Add', exact: true });
  }

  /** The question modal; it first asks for the question type, then for the question itself. */
  get questionDialog(): Locator {
    return this.page.getByRole('dialog');
  }

  /** The question text as the screening list renders it. */
  screeningQuestion(question: string): Locator {
    return this.main.getByText(question, { exact: true });
  }

  /**
   * Type badge of a listed screening question ("Text" or "Multiple Choice"). Each row renders the
   * badge and then the question text, so the badge is the element right before it.
   */
  screeningQuestionBadge(question: string): Locator {
    return this.screeningQuestion(question).locator('xpath=preceding-sibling::*[1]');
  }

  /** The listed row of a screening question: its badge, the question and any answer options. */
  screeningQuestionRow(question: string): Locator {
    return this.screeningQuestion(question).locator('xpath=..');
  }

  /** Opens the modal and picks a question type; returns with the question form showing. */
  private async openQuestionDialog(type: 'Text Answer' | 'Multiple Choice') {
    await this.addScreeningQuestionButton.click();
    const dialog = this.questionDialog;
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText('Choose Question Type', { exact: true })).toBeVisible();

    // The type is offered as a card per type, each naming the type and what it does.
    await dialog.getByRole('button', { name: new RegExp(`^${escapeRegExp(type)}`) }).click();
    await expect(dialog.locator('[id="question"]')).toBeVisible({ timeout: 15_000 });
  }

  /** Submits the modal and waits for it to close, reporting its validation text if it stays open. */
  private async submitQuestionDialog() {
    const dialog = this.questionDialog;
    await dialog.getByRole('button', { name: 'Add Question', exact: true }).click();

    const stillOpen = await dialog.waitFor({ state: 'hidden', timeout: 20_000 }).then(() => false, () => true);
    if (stillOpen) {
      const messages = await dialog.getByText(/is required|must (be|contain)|please (select|enter)/i).allInnerTexts();
      throw new Error(`"Add Question" was rejected: ${messages.join('; ') || 'the modal stayed open'}`);
    }
  }

  /** Adds a Text Answer screening question and checks it is listed afterwards. */
  async addTextAnswerQuestion(question: string) {
    await this.openQuestionDialog('Text Answer');
    await this.questionDialog.locator('[id="question"]').fill(question);
    await this.submitQuestionDialog();

    await expect(this.screeningQuestion(question)).toBeVisible({ timeout: 30_000 });
    await expect(this.screeningQuestionBadge(question)).toHaveText('Text');
  }

  /**
   * Adds a Multiple Choice screening question with its answer options and checks it is listed.
   *
   * The modal opens with two empty option fields, which is also the portal's minimum; "Add New"
   * appends another one for each option beyond those two.
   */
  async addMultipleChoiceQuestion(question: string, options: string[]) {
    expect(options.length, 'a multiple-choice question needs at least 2 options').toBeGreaterThanOrEqual(2);
    await this.openQuestionDialog('Multiple Choice');

    const dialog = this.questionDialog;
    await dialog.locator('[id="question"]').fill(question);

    const optionFields = dialog.locator('input[id^="options."]');
    for (let index = 0; index < options.length; index++) {
      if ((await optionFields.count()) <= index) {
        await dialog.getByRole('button', { name: 'Add New', exact: true }).click();
        await expect(optionFields).toHaveCount(index + 1);
      }
      await optionFields.nth(index).fill(options[index]);
      await expect(optionFields.nth(index)).toHaveValue(options[index]);
    }
    // No stray blank option is left behind for the portal to reject.
    await expect(optionFields, 'the modal should hold one field per answer option').toHaveCount(options.length);
    await this.submitQuestionDialog();

    await expect(this.screeningQuestion(question)).toBeVisible({ timeout: 30_000 });
    await expect(this.screeningQuestionBadge(question)).toHaveText('Multiple Choice');
    // The row lists the options it was given.
    for (const option of options) {
      await expect(this.screeningQuestionRow(question)).toContainText(option);
    }
  }

  /** Both question types are listed, which is what the step is meant to end up with. */
  async expectScreeningQuestions(textQuestion: string, multipleChoiceQuestion: string) {
    await expect(this.screeningQuestion(textQuestion)).toBeVisible();
    await expect(this.screeningQuestionBadge(textQuestion)).toHaveText('Text');
    await expect(this.screeningQuestion(multipleChoiceQuestion)).toBeVisible();
    await expect(this.screeningQuestionBadge(multipleChoiceQuestion)).toHaveText('Multiple Choice');
    await expect(this.main.getByText('No screening questions added yet.')).toHaveCount(0);
  }

  // ---- Review and publish -------------------------------------------------------------------

  /** "Review & Publish": on step 3 it opens the review, on the review step it publishes. */
  get reviewAndPublishButton(): Locator {
    return this.main.getByRole('button', { name: 'Review & Publish', exact: true });
  }

  /** Opens the review step from step 3. */
  async openReview() {
    await expect(this.reviewAndPublishButton).toBeEnabled();
    await this.reviewAndPublishButton.click();

    // The review tab stays disabled right up to the moment the review step opens, so it becoming
    // enabled is the signal; a rejected step instead renders its validation text in place.
    const opened = await expect(this.stepTab('review'))
      .toBeEnabled({ timeout: 60_000 })
      .then(() => true, () => false);
    if (!opened) {
      throw new Error(`"Review & Publish" was rejected: ${(await this.validationMessage.allInnerTexts()).join('; ')}`);
    }
  }

  /**
   * Value shown for a label in the review summary. Each entry renders the label and then its
   * value as the next element — a paragraph for plain values, a wrapper holding chips for the
   * required skills and the description — so the element type is deliberately not pinned down.
   */
  reviewValue(label: string): Locator {
    return this.main.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]');
  }

  /**
   * The review summary carries what was entered. Each entry is checked against the value the
   * wizard was given, so a step that silently dropped a field fails here rather than at publish.
   */
  async expectReviewSummary(expected: Record<string, string | RegExp>) {
    // All three step sections are summarised, each headed by its step name.
    for (const step of ['basicInfo', 'jobDetails', 'compensation'] as const) {
      await expect(this.main.getByText(POST_JOB_STEPS[step], { exact: true })).not.toHaveCount(0);
    }
    for (const [label, value] of Object.entries(expected)) {
      const shown = this.reviewValue(label);
      await expect(shown, `the review summary should show exactly one "${label}"`).toHaveCount(1);
      await expect(shown, `the review summary should show ${label} as ${value}`).toHaveText(value);
    }
  }

  /**
   * Publishes from the review step. The portal POSTs the job and then returns to the jobs list, so
   * both are awaited: a failed POST is reported with its status instead of a navigation timeout.
   */
  async publish() {
    const created = this.page.waitForResponse(
      (response) => /\/api\/jobs\/create/.test(response.url()) && response.request().method() === 'POST',
      { timeout: 90_000 },
    );
    await this.reviewAndPublishButton.click();

    const response = await created;
    expect(response.ok(), `publishing the job responded ${response.status()}`).toBeTruthy();
    await expect(this.page).toHaveURL(/\/jobs\/?(\?.*)?$/, { timeout: 60_000 });
  }
}

/** "Gold Coast AU" -> { name: "Gold Coast", code: "AU" }; an option without a code keeps code "". */
function parseCityOption(option: string): { name: string; code: string } {
  const match = option.trim().match(/^(.*?)\s+([A-Z]{2})$/);
  return match ? { name: match[1].trim(), code: match[2] } : { name: option.trim(), code: '' };
}
