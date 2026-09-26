import { type Page, type Locator, expect } from '@playwright/test';
import { ACTIVATION_CHECKLIST, WELCOME_PREVIEW } from '../data/dashboard-onboarding';

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
