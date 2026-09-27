import { type Page, type Locator, expect } from '@playwright/test';
import {
  ACTIVATION_CHECKLIST,
  STUDENT_ACTIVATION_STEPS,
  WELCOME_PREVIEW,
  type ActivationStep,
} from '../data/dashboard-onboarding';

/** Backend endpoint the portal reads and updates the walkthrough (preview/tour) state through. */
export const WALKTHROUGH_API = '/api/onboarding/walkthrough';

/**
 * "Welcome to INDUS Tech Connect" feature preview: a modal dialog shown on the dashboard until the
 * user finishes it (last-slide button) or clicks "Skip preview". Both outcomes are persisted through
 * the walkthrough API, so the preview is not shown again on later visits.
 */
export class WelcomePreviewDialog {
  readonly dialog: Locator;
  readonly label: Locator;
  readonly skipButton: Locator;
  readonly nextButton: Locator;
  readonly backButton: Locator;
  readonly finishButton: Locator;
  /** Title of the current slide. */
  readonly title: Locator;
  /** Description paragraph directly under the title. */
  readonly description: Locator;
  /** Bullet points of the current slide. */
  readonly points: Locator;
  /** Slide indicator dots; its aria-label reads "Slide N of M". */
  readonly slideIndicator: Locator;

  constructor(page: Page) {
    this.dialog = page.locator('[role="dialog"][aria-labelledby="feature-preview-title"]');
    this.label = this.dialog.getByText(WELCOME_PREVIEW.label, { exact: true });
    this.skipButton = this.dialog.getByRole('button', { name: WELCOME_PREVIEW.skipLabel, exact: true });
    this.nextButton = this.dialog.getByRole('button', { name: WELCOME_PREVIEW.nextLabel, exact: true });
    this.backButton = this.dialog.getByRole('button', { name: WELCOME_PREVIEW.backLabel, exact: true });
    this.finishButton = this.dialog.getByRole('button', { name: WELCOME_PREVIEW.finishLabel, exact: true });
    this.title = this.dialog.locator('#feature-preview-title');
    this.description = this.title.locator('xpath=following-sibling::p[1]');
    this.points = this.dialog.getByRole('listitem');
    this.slideIndicator = this.dialog.locator('[aria-label^="Slide "]');
  }

  /** Current slide position as shown by the indicator, e.g. { current: 1, total: 4 }. */
  async slidePosition(): Promise<{ current: number; total: number }> {
    const label = (await this.slideIndicator.getAttribute('aria-label')) ?? '';
    const match = label.match(/Slide (\d+) of (\d+)/);
    expect(match, `slide indicator label "${label}"`).not.toBeNull();
    return { current: Number(match![1]), total: Number(match![2]) };
  }

  /** The dashboard fetches the walkthrough state first, so the dialog appears after a short delay. */
  async expectVisible(timeout = 30_000) {
    await expect(this.dialog).toBeVisible({ timeout });
  }
}

/**
 * Step-by-step "Feature tour" that follows the preview. Not part of the spec under test, but it
 * overlays the dashboard, so tests dismiss it before reading the activation checklist.
 */
export class FeatureTourDialog {
  readonly dialog: Locator;
  readonly skipButton: Locator;

  constructor(page: Page) {
    this.dialog = page.locator('[role="dialog"][aria-labelledby="tour-step-title"]');
    this.skipButton = this.dialog.getByRole('button', { name: 'Skip', exact: true });
  }

  /**
   * Skips the tour if it shows up within `timeout`. The tour card repositions itself right after
   * appearing, so a first click can land beside the button; retry until the dialog is gone.
   */
  async skipIfShown(timeout = 10_000) {
    const shown = await this.dialog.waitFor({ state: 'visible', timeout }).then(() => true, () => false);
    if (!shown) return;

    await expect(async () => {
      await this.skipButton.click({ timeout: 3_000 });
      await expect(this.dialog).toBeHidden({ timeout: 3_000 });
    }).toPass({ timeout: 20_000, intervals: [500, 1_000] });
  }
}

export type ActivationStepState = 'completed' | 'pending' | 'locked';

/**
 * "Activate your INDUS Tech Connect profile" checklist shown on /dashboard while required activation
 * steps (PakID verification, ≥80% profile completion) are outstanding.
 */
export class ActivationChecklist {
  readonly section: Locator;
  readonly heading: Locator;
  readonly description: Locator;
  /** "N of M completed" counter. */
  readonly progress: Locator;
  readonly items: Locator;

  constructor(page: Page) {
    this.section = page.locator('section[aria-labelledby="account-activation-title"]');
    this.heading = this.section.locator('#account-activation-title');
    this.description = this.heading.locator('xpath=following-sibling::p[1]');
    this.progress = this.section.getByText(ACTIVATION_CHECKLIST.progressPattern);
    this.items = this.section.getByRole('listitem');
  }

  /** The checklist renders once the dashboard has loaded the user's status. */
  async expectVisible(timeout = 30_000) {
    await expect(this.section).toBeVisible({ timeout });
  }

  /** Checklist row whose title is `title` (exact text of the step heading). */
  item(title: string): Locator {
    return this.items.filter({ has: this.section.page().getByText(title, { exact: true }) });
  }

  /** Description paragraph of the step titled `title`. */
  itemDescription(title: string): Locator {
    return this.item(title).getByText(title, { exact: true }).locator('xpath=following-sibling::p[1]');
  }

  /** Action link (enabled) or button (locked) of the step titled `title`. */
  action(title: string, label: string): Locator {
    return this.item(title).getByRole('link', { name: label }).or(this.item(title).getByRole('button', { name: label }));
  }

  /**
   * Visual state of a step: "completed" (green tick + "Completed" text), "locked" (action disabled
   * until an earlier step is done) or "pending" (action available).
   */
  async state(title: string): Promise<ActivationStepState> {
    const row = this.item(title);
    if (await row.getByText(ACTIVATION_CHECKLIST.completedLabel, { exact: true }).isVisible()) return 'completed';
    if (await row.getByRole('button', { disabled: true }).count()) return 'locked';
    return 'pending';
  }

  /** Parses "N of M completed". */
  async progressCounts(): Promise<{ done: number; total: number }> {
    const text = (await this.progress.innerText()).trim();
    const match = text.match(ACTIVATION_CHECKLIST.progressPattern);
    expect(match, `progress text "${text}"`).not.toBeNull();
    return { done: Number(match![1]), total: Number(match![2]) };
  }

  /** Number of rows marked "Completed". */
  async completedCount(): Promise<number> {
    return this.items.filter({ hasText: ACTIVATION_CHECKLIST.completedLabel }).count();
  }

  /** The dynamic profile completion percentage from the "Complete your profile" description. */
  async profileCompletionPct(stepTitle: string): Promise<number> {
    const text = await this.itemDescription(stepTitle).innerText();
    const match = text.match(ACTIVATION_CHECKLIST.completionPattern);
    expect(match, `completion text "${text}"`).not.toBeNull();
    return Number(match![1]);
  }
}

/**
 * Student dashboard (/dashboard) as a whole: the onboarding overlays, the activation checklist
 * and the sidebar. Composes the page objects above rather than repeating their selectors.
 */
export class DashboardPage {
  readonly preview: WelcomePreviewDialog;
  readonly tour: FeatureTourDialog;
  readonly checklist: ActivationChecklist;
  /** Sidebar "Log Out" entry (an anchor, hidden behind the onboarding overlays while they show). */
  readonly logoutLink: Locator;

  constructor(private readonly page: Page) {
    this.preview = new WelcomePreviewDialog(page);
    this.tour = new FeatureTourDialog(page);
    this.checklist = new ActivationChecklist(page);
    this.logoutLink = page.getByRole('link', { name: 'Log Out', exact: true });
  }

  async expectVisible(timeout = 30_000) {
    await expect(this.page).toHaveURL(/\/dashboard/, { timeout });
  }

  /**
   * Gets the welcome preview and the feature tour out of the way so the page underneath can be
   * used. Skipping the preview is persisted, so it does not come back on the next login; the tour
   * follows the preview after a short delay, so give it `tourTimeout` to show up.
   */
  async dismissOnboarding(tourTimeout = 10_000) {
    if (await this.preview.dialog.isVisible()) {
      await this.preview.skipButton.click();
      await expect(this.preview.dialog).toBeHidden();
    }
    await this.tour.skipIfShown(tourTimeout);
  }

  /**
   * Walks the welcome preview with "Next" until its finishing button, then skips the feature tour.
   * The preview appears only after the dashboard has fetched the walkthrough state, so it gets a
   * moment to show up; if it opens without a way forward, "Skip preview" is the fallback.
   */
  async completeOnboarding(previewTimeout = 10_000, tourTimeout = 10_000) {
    const shown = await this.preview.dialog.waitFor({ state: 'visible', timeout: previewTimeout }).then(() => true, () => false);
    if (shown) {
      while (await this.preview.nextButton.isVisible()) await this.preview.nextButton.click();
      if (await this.preview.finishButton.isVisible()) {
        await this.preview.finishButton.click();
      } else {
        await this.preview.skipButton.click();
      }
      await expect(this.preview.dialog).toBeHidden();
    }
    await this.tour.skipIfShown(tourTimeout);
  }

  /** Sidebar "Log Out"; the portal returns to the login page. */
  async logout() {
    await this.logoutLink.click();
    await expect(this.page).toHaveURL(/\/login/, { timeout: 15_000 });
  }

  async expectActivationSection() {
    await this.checklist.expectVisible();
    await expect(this.checklist.heading).toHaveText(ACTIVATION_CHECKLIST.heading);
    await expect(this.checklist.description).toHaveText(ACTIVATION_CHECKLIST.description);
    await expect(this.checklist.items).toHaveCount(STUDENT_ACTIVATION_STEPS.length);
  }

  /** "N of M completed" counter. */
  async expectProgress(done: number, total: number) {
    await expect(this.checklist.progress).toHaveText(`${done} of ${total} completed`);
  }

  /** A step's row: title, description (with `pct` filled in) and, unless completed, its action. */
  private async expectStep(step: ActivationStep, pct?: number) {
    await expect(this.checklist.item(step.title)).toBeVisible();
    await expect(this.checklist.itemDescription(step.title)).toHaveText(step.description.replace('{pct}', String(pct)));
    if ((await this.checklist.state(step.title)) !== 'completed') {
      await expect(this.checklist.action(step.title, step.action)).toBeVisible();
    }
  }

  async expectPakIdStep() {
    await this.expectStep(pakIdStep);
  }

  /** Reads the live completion percentage, checks the copy around it and returns it. */
  async expectProfileCompletionStep(): Promise<number> {
    const pct = await this.checklist.profileCompletionPct(profileStep.title);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
    await this.expectStep(profileStep, pct);
    return pct;
  }

  async expectPsebStep() {
    await this.expectStep(psebStep);
  }

  async expectTalentHubStep() {
    await this.expectStep(talentHubStep);
  }

  /**
   * PakID row shows "Completed" instead of its "Verify with PakID" action. The portal renders one
   * or the other, so the action must be gone once the verification has been recorded.
   */
  async expectPakIdCompleted() {
    const row = this.checklist.item(pakIdStep.title);
    await expect(row.getByText(ACTIVATION_CHECKLIST.completedLabel, { exact: true })).toBeVisible();
    await expect(this.checklist.action(pakIdStep.title, pakIdStep.action)).toHaveCount(0);
    expect(await this.checklist.state(pakIdStep.title)).toBe('completed');
  }

  /** "Complete Profile" inside the "Complete your profile" row; it is a link once PakID is verified. */
  async openCompleteProfile() {
    await this.checklist.item(profileStep.title).getByRole('link', { name: profileStep.action, exact: true }).click();
  }
}

const [pakIdStep, profileStep, psebStep, talentHubStep] = STUDENT_ACTIVATION_STEPS;
