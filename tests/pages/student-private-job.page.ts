import { type Page, type Locator, type Response, expect } from '@playwright/test';
import { escapeRegExp } from './react-aria.page';

/** What one application came to: the questions that were answered and the call that filed it. */
export type SubmittedApplication = {
  questions: number;
  /** The request the submit made, as a path - discovered, not assumed. */
  endpoint: string;
  /** What the portal said once it was filed, if it put a dialog up to say it. */
  confirmation: string;
};

/** The text answer left for a free-text screening question. */
const TEXT_ANSWER = 'Answered by the end-to-end test suite.';

/**
 * One job posted on the portal: /jobs/<slug>, reached from a card's "View Details".
 *
 * This is the Private counterpart of StudentJobDetailsPage, which covers the Government feed's
 * jobs; the two pages share their chrome (the breadcrumb, the title) but not their action. A
 * Government job sends the student off to the feed's own site, while a Private job is applied for
 * here, in three steps:
 *
 *   "Apply Now"  ->  a "Confirm Application" dialog  ->  a "Screening Questions" form
 *
 * Only submitting that form files the application; leaving before then records nothing. Once it
 * is filed the page has no "Apply Now" any more - it reads "Applied" instead, which is also how
 * a job applied for in some earlier run presents itself.
 */
export class StudentPrivateJobPage {
  /** The layout's <main>; like the Government page, this one nests a second inside it. */
  readonly root: Locator;
  readonly title: Locator;
  readonly breadcrumb: Locator;
  readonly applyNow: Locator;
  readonly appliedState: Locator;
  readonly confirmDialog: Locator;
  readonly questionsDialog: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('main').first();
    this.title = this.root.getByRole('heading', { level: 1 });
    this.breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
    this.applyNow = this.root.getByRole('button', { name: /^Apply Now$/i }).locator('visible=true');
    this.appliedState = this.root.getByText('Applied', { exact: true }).locator('visible=true');
    this.confirmDialog = page.getByRole('dialog').filter({ hasText: /Confirm Application/i });
    this.questionsDialog = page.getByRole('dialog').filter({ hasText: /Screening Questions/i });
  }

  /** The page for `route` is open, showing `title`. */
  async expectVisible(route: string, title: string, timeout = 60_000) {
    await expect(this.page, 'the card should have opened its own job').toHaveURL(
      new RegExp(`${escapeRegExp(route)}$`),
      { timeout },
    );
    await expect(this.title, 'the job page should head with the job title').toHaveText(title, { timeout });
  }

  /** The job is still open to apply for: the action is there and nothing says it was applied to. */
  async expectNotApplied() {
    await expect(this.applyNow, 'the job should offer "Apply Now"').toBeVisible({ timeout: 60_000 });
    await expect(this.appliedState, 'the job should not already be applied for').toHaveCount(0);
  }

  /** The application is filed: the action is gone and the page says so instead. */
  async expectApplied() {
    await expect(this.appliedState.first(), 'the job page should now read "Applied"').toBeVisible({ timeout: 60_000 });
    await expect(this.applyNow, 'an applied job should not offer "Apply Now" again').toHaveCount(0);
  }

  /**
   * Applies: the action, the confirmation, then the screening questions, whatever they are.
   *
   * The questions differ from job to job, so they are answered as they come rather than by a
   * script of this job's own: every free-text question is given an answer and every choice
   * question its first option. A job with nothing to ask shows no form at all, which is why the
   * form is only waited for as one of the two things that can happen next.
   *
   * The call that files it is awaited either way, and its path handed back, so an endpoint that
   * answers badly fails here with its status instead of silently. It is awaited from before the
   * confirmation is given, because a job with no questions is filed by that click alone - and it
   * is tied to this job's own route, so another call going out at the same time is not mistaken
   * for the application.
   */
  async applyWithScreeningQuestions(): Promise<SubmittedApplication> {
    await expect(this.applyNow, 'the job should offer "Apply Now"').toBeVisible({ timeout: 60_000 });

    const route = new URL(this.page.url()).pathname.replace(/\/$/, '');
    const filed = this.page.waitForResponse(
      (r) => r.request().method() !== 'GET' && r.url().includes(`/api${route}/`),
      { timeout: 120_000 },
    );
    await this.applyNow.first().click();

    // ---- "Confirm Application": a summary of the job, and Apply to go on to the questions.
    await expect(this.confirmDialog, 'applying should ask for confirmation first').toBeVisible({ timeout: 30_000 });
    await this.confirmDialog.getByRole('button', { name: /^Apply$/ }).click();

    // ---- The questions, if this job asks any.
    const form = this.questionsDialog.locator('form');
    await expect(
      form.or(this.appliedState).first(),
      'confirming should bring up the screening questions, or file the application outright',
    ).toBeVisible({ timeout: 60_000 });

    if ((await form.count()) === 0) {
      // Nothing to ask: confirming filed it, so only the call and the dialog are left to check.
      return { questions: 0, ...(await this.settle(filed)) };
    }

    const answers = form.locator('input[type="text"][name^="answer_"]');
    const choices = form.locator('[role="radiogroup"]');
    const written = await answers.count();
    const chosen = await choices.count();

    for (let i = 0; i < written; i++) {
      await answers.nth(i).fill(TEXT_ANSWER);
    }
    for (let i = 0; i < chosen; i++) {
      const options = choices.nth(i).locator('label');
      await expect(options.first(), 'a choice question should offer an option').toBeVisible();
      await options.first().click();
    }

    // ---- Submit the answers; the call that files the application goes out with them.
    await form.getByRole('button', { name: /^Apply$/ }).click();
    await expect(this.questionsDialog, 'the questions should be done with once they are submitted').toHaveCount(0, {
      timeout: 60_000,
    });

    return { questions: written + chosen, ...(await this.settle(filed)) };
  }

  /** The call that filed the application answered, and whatever it put on screen is cleared. */
  private async settle(filed: Promise<Response>): Promise<{ endpoint: string; confirmation: string }> {
    const response = await filed;
    const endpoint = response.url().replace(/^https?:\/\/[^/]+/, '');
    expect(
      response.ok(),
      `${response.request().method()} ${endpoint} answered ${response.status()}`,
    ).toBeTruthy();

    return { endpoint, confirmation: await this.dismissConfirmation() };
  }

  /**
   * Clears whatever the portal puts up once an application is filed, and hands back what it said.
   *
   * There is a dialog there - a filed application is announced - and until it goes the page
   * underneath cannot be used at all: its overlay covers the whole viewport and swallows every
   * click, the breadcrumb included. What closes it is not assumed: the button that says so is
   * taken if there is one, and Escape serves for a dialog that offers none.
   */
  async dismissConfirmation(): Promise<string> {
    const dialog = this.page.getByRole('dialog');
    if ((await dialog.count()) === 0) {
      return '';
    }

    const said = (await dialog.first().innerText()).replace(/\s+/g, ' ').trim();
    const closes = dialog
      .first()
      .getByRole('button', { name: /^(close|ok|okay|done|got it|continue|dismiss|back to jobs)$/i });

    if (await closes.count()) {
      await closes.first().click();
    } else {
      await this.page.keyboard.press('Escape');
    }

    await expect(dialog, `the dialog saying "${said.slice(0, 60)}" should close`).toHaveCount(0, { timeout: 30_000 });
    return said;
  }

  /** "Jobs" in the breadcrumb, which goes back to the listing. */
  async openJobsFromBreadcrumb() {
    await expect(this.breadcrumb, 'the job page should carry a breadcrumb').toBeVisible({ timeout: 30_000 });
    const jobs = this.breadcrumb.getByRole('link', { name: 'Jobs', exact: true });
    await expect(jobs, 'the breadcrumb should offer "Jobs"').toBeVisible();
    await jobs.click();
  }
}
