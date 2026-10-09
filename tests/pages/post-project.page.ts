import { type Locator, expect } from '@playwright/test';
import { ReactAriaPage } from './react-aria.page';

/** Wizard tabs of the project form (buttons; a tab stays disabled until its step is reachable). */
export const POST_PROJECT_STEPS = {
  details: 'Step 1 : Project Details',
  budget: 'Step 2 : Budget & Settings',
  review: 'Step 3 : Review',
} as const;

/**
 * "Create Project" wizard: /projects/new for a company account.
 *
 * Three tabs — Project Details → Budget & Settings → Review — share one URL; "Next" moves on
 * without a navigation, and the Review step publishes.
 *
 * Note the portal neither disables "Review & Publish" while the request is in flight nor leaves
 * the wizard once the project has been created, so publish() clicks exactly once and waits on the
 * POST itself (see MyProjectsPage.expectProjectListedOnce for the duplicate check that pairs
 * with it).
 */
export class PostProjectPage extends ReactAriaPage {
  get heading(): Locator {
    return this.main.getByRole('heading', { name: 'Create Project' });
  }

  get nextButton(): Locator {
    return this.main.getByRole('button', { name: 'Next', exact: true });
  }

  get previousButton(): Locator {
    return this.main.getByRole('button', { name: 'Previous', exact: true });
  }

  /** "Review & Publish" on the Review step. */
  get reviewAndPublishButton(): Locator {
    return this.main.getByRole('button', { name: 'Review & Publish', exact: true });
  }

  /**
   * Wizard tab button. The Review step repeats "Step N : …" as the heading of each summary
   * section, so the name matches twice there; the tab strip is always rendered above the summary.
   */
  stepTab(step: keyof typeof POST_PROJECT_STEPS): Locator {
    return this.main.getByRole('button', { name: POST_PROJECT_STEPS[step], exact: true }).first();
  }

  /** Field-level validation the form renders in place when a step is rejected. */
  private get validationMessage(): Locator {
    return this.main.getByText(/is required|must (be|contain)|only letters|please (select|enter)/i);
  }

  // ---- Step 1: Project Details --------------------------------------------------------------

  get projectTitle(): Locator {
    return this.byId('title');
  }

  /** Plain textarea, not a rich-text editor. */
  get projectDescription(): Locator {
    return this.byId('description');
  }

  /** Multi-select tag combobox; its id is generated, so it is reached by its label. */
  get skillsRequired(): Locator {
    return this.main.getByRole('combobox', { name: /^Skills Required/ });
  }

  /** Tag chip of a selected skill. */
  skillTag(skill: string): Locator {
    return this.skillsRequired.locator('xpath=ancestor::*[@role="group"][1]').getByText(skill, { exact: true });
  }

  /** Step 1 is rendered: the URL, the page heading and the first field, with later steps locked. */
  async expectVisible(timeout = 60_000) {
    await expect(this.page).toHaveURL(/\/projects\/new\/?$/, { timeout });
    await expect(this.heading).toBeVisible({ timeout });
    await expect(this.projectTitle).toBeVisible({ timeout });
    await expect(this.stepTab('budget')).toBeDisabled();
  }

  /** Fills step 1 and asserts each field holds its value before the step is submitted. */
  async completeProjectDetails({
    title,
    description,
    skill,
  }: {
    title: string;
    description: string;
    skill: string;
  }) {
    await this.projectTitle.fill(title);
    await expect(this.projectTitle).toHaveValue(title);

    await this.projectDescription.fill(description);
    await expect(this.projectDescription).toHaveValue(description);

    await this.addTag(this.skillsRequired, skill);
    await expect(this.skillTag(skill), `"${skill}" should be added under Skills Required`).toBeVisible();
  }

  /** "Next" on step 1; a rejected step reports its own validation text. */
  async nextToBudgetAndSettings() {
    await this.moveNext(this.deadline, 'Project Details');
  }

  // ---- Step 2: Budget & Settings ------------------------------------------------------------

  /** Native date input; the portal sets its `min` to today, so only future dates are accepted. */
  get deadline(): Locator {
    return this.byId('deadline');
  }

  get currencyCombo(): Locator {
    return this.byId('currency_id');
  }

  get statusCombo(): Locator {
    return this.byId('status');
  }

  get visibilityCombo(): Locator {
    return this.byId('visibility');
  }

  /**
   * Field wrapper of the budget slider: the nearest ancestor of its label that also holds the
   * slider group, since the label and the slider are not siblings.
   */
  private get budgetField(): Locator {
    return this.main
      .locator('label')
      .filter({ hasText: /^Budget Range/ })
      .locator('xpath=ancestor::div[.//*[@role="group"]][1]');
  }

  get budgetGroup(): Locator {
    return this.budgetField.locator('[role="group"]').first();
  }

  /** The two hidden range inputs: [0] is the lower budget, [1] the upper. */
  get budgetSliders(): Locator {
    return this.rangeInputs(this.budgetGroup);
  }

  /** Step 2 is rendered: its fields are there, step 1's are gone and the Review tab is locked. */
  async expectBudgetAndSettingsStep() {
    await expect(this.deadline).toBeVisible({ timeout: 60_000 });
    await expect(this.budgetSliders).toHaveCount(2);
    await expect(this.currencyCombo).toBeVisible();
    await expect(this.statusCombo).toBeVisible();
    await expect(this.visibilityCombo).toBeVisible();
    await expect(this.previousButton).toBeEnabled();
    await expect(this.stepTab('budget')).toBeEnabled();
    await expect(this.stepTab('review')).toBeDisabled();
    await expect(this.projectTitle).toHaveCount(0);
  }

  async setDeadline(isoDate: string) {
    // The portal sets `min` to today. ISO dates compare correctly as plain strings.
    const min = await this.deadline.getAttribute('min');
    if (min) {
      expect(isoDate >= min, `the Deadline ${isoDate} must not be before the portal's minimum ${min}`).toBeTruthy();
    }
    await this.deadline.fill(isoDate);
    await expect(this.deadline).toHaveValue(isoDate);
  }

  /**
   * Sets the budget range by dragging the two handles of the slider, then checks both read-outs.
   * The slider moves in steps of 500 over 0–1,000,000, which setRangeSlider enforces.
   */
  async setBudgetRange(lower: number, upper: number) {
    await this.setRangeSlider(this.budgetGroup, lower, upper);
    // Each handle carries its own read-out of the value it sits on.
    await expect(this.budgetGroup.locator('output')).toHaveCount(2);
    await expect(this.budgetGroup.locator('output').nth(0)).toHaveText(new RegExp(`^\\s*${lower}\\s*$`));
    await expect(this.budgetGroup.locator('output').nth(1)).toHaveText(new RegExp(`^\\s*${upper}\\s*$`));
  }

  /** Currency list; the portal names currencies in full ("Pakistani Rupee"), not as codes. */
  async selectCurrency(currency: string) {
    await this.pickComboOption(this.currencyCombo, currency, currency);
    await expect(this.currencyCombo).toHaveValue(currency);
  }

  /** Status list: Open, Draft or Closed (the portal preselects Open). */
  async selectStatus(status: string) {
    await this.pickComboOption(this.statusCombo, status, status);
    await expect(this.statusCombo).toHaveValue(status);
  }

  /** Visibility list: Public or Private (the portal preselects Public). */
  async selectVisibility(visibility: string) {
    await this.pickComboOption(this.visibilityCombo, visibility, visibility);
    await expect(this.visibilityCombo).toHaveValue(visibility);
  }

  /** "Next" on step 2; a rejected step reports its own validation text. */
  async nextToReview() {
    await this.moveNext(this.reviewAndPublishButton, 'Budget & Settings');
    await expect(this.stepTab('review')).toBeEnabled();
  }

  /** Clicks "Next" and waits for `nextStepMarker`, reporting validation text if the step is kept. */
  private async moveNext(nextStepMarker: Locator, stepName: string) {
    await expect(this.nextButton).toBeEnabled();
    await this.nextButton.click();

    await expect(nextStepMarker.or(this.validationMessage).first()).toBeVisible({ timeout: 60_000 });
    if (!(await nextStepMarker.isVisible())) {
      throw new Error(`"Next" was rejected on ${stepName}: ${(await this.validationMessage.allInnerTexts()).join('; ')}`);
    }
  }

  // ---- Step 3: Review -----------------------------------------------------------------------

  /**
   * Value shown for a label in the review summary.
   *
   * The summary mixes two layouts: Description and Media put the label and its value next to each
   * other, while every row of the two-column grid wraps its label in a container of its own, so
   * there the value is the sibling of that wrapper rather than of the label. Both are covered;
   * where a label has a direct sibling, that one wins (document order).
   */
  reviewValue(label: string): Locator {
    return this.main
      .getByText(label, { exact: true })
      .locator('xpath=(./following-sibling::*[1] | ../following-sibling::*[1])[1]');
  }

  /**
   * The review summary carries what was entered. Each entry is checked against the value the
   * wizard was given, so a step that silently dropped a field fails here rather than at publish.
   */
  async expectReviewSummary(expected: Record<string, string | RegExp>) {
    await expect(this.reviewAndPublishButton).toBeVisible({ timeout: 60_000 });
    // Both filled-in steps are summarised, each headed by its step name.
    for (const step of ['details', 'budget'] as const) {
      await expect(this.main.getByText(POST_PROJECT_STEPS[step], { exact: true })).not.toHaveCount(0);
    }
    for (const [label, value] of Object.entries(expected)) {
      const shown = this.reviewValue(label);
      await expect(shown, `the review summary should show exactly one "${label}"`).toHaveCount(1);
      await expect(shown, `the review summary should show ${label} as ${value}`).toHaveText(value);
    }
  }

  /**
   * Publishes the project with a single click on "Review & Publish".
   *
   * The portal leaves the button enabled and stays on the wizard while the POST is in flight, so
   * a second click would create the project twice. The click therefore happens exactly once here
   * and the POST is awaited: callers get a settled state to continue from and never need to click
   * again. Returns the id the portal assigned, when it reports one.
   */
  async publish(): Promise<void> {
    const created = this.page.waitForResponse(
      (response) => /\/api\/projects\b/.test(response.url()) && response.request().method() === 'POST',
      { timeout: 90_000 },
    );

    await expect(this.reviewAndPublishButton).toBeEnabled();
    await this.reviewAndPublishButton.click();

    const response = await created;
    expect(response.ok(), `publishing the project responded ${response.status()}`).toBeTruthy();
    // Let the request settle before anything navigates, so the project is really stored.
    await this.page.waitForLoadState('networkidle');
  }
}
