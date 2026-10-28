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
 * What a job page says when it will not take an application from this student: the qualification,
 * degree or experience it asks for and the student has not got. Used only to quote the page back
 * in a skip message, never to decide anything, so a build that words it differently costs nothing.
 */
const REQUIREMENT_NOTICE = /qualificat|degree|master|bachelor|phd|eligib|requirement|do(es)? not meet/i;

/**
 * How the side panel labels the minimum qualification a job asks for. Anchored, so it matches the
 * label on its own and not a sentence that happens to mention qualifications; the optional words
 * cover the builds that render it as "Qualification" or "Minimum Qualification".
 */
const QUALIFICATION_LABEL = /^(minimum\s+)?qualification(\s+required)?$/i;

/** One entry on a job's Timeline. */
export type TimelineEntry = {
  /** The entry's number; the newest has the highest. */
  number: number;
  title: string;
  detail: string;
  /** The score a completed assessment came to, e.g. "22%"; empty for any other entry. */
  score: string;
};

/** The cards the "AI Resource" popup offers, in the order the job page lists them. */
export const AI_RESOURCE_CARDS = ['AI Mock Test', 'AI Interview Simulation', 'Smart Resource Engine'] as const;

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
    // The badge reads "Application Submitted" on current builds; older ones said just "Applied".
    this.appliedState = this.root
      .getByText(/^\s*(Applied|Application Submitted)\s*$/i)
      .locator('visible=true');
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

  /**
   * "Qualification Required" as the job's side panel shows it ("Bachelors", "Masters", "PhD"), or
   * '' when this job names none - a job that set no minimum shows the entry as "-", which comes
   * back as that dash rather than as an empty string.
   *
   * The value is the element after the label, which is how every label/value pair in this portal is
   * built (see PostJobPage.reviewValue), so the element type is deliberately not pinned down.
   */
  async qualificationRequired(): Promise<string> {
    const label = this.root.getByText(QUALIFICATION_LABEL).locator('visible=true');
    if ((await label.count()) === 0) return '';

    const value = label.first().locator('xpath=following-sibling::*[1]');
    if ((await value.count()) === 0) return '';

    return (await value.first().innerText()).replace(/\s+/g, ' ').trim();
  }

  /**
   * Why this job cannot be applied for, or '' when it can be.
   *
   * A job whose requirements the student does not meet - a minimum qualification it asks for, say -
   * still shows "Apply Now", but the portal renders it `disabled`, so clicking it only waits for an
   * element that is never going to become enabled. This reports that state instead of walking into
   * it, so a caller can leave the job alone and try another one.
   *
   * The button is given a moment to come good first: it also starts out disabled while the page is
   * still hydrating, and that is not a requirement the student fails.
   *
   * The reason itself is read from the page rather than assumed: the button's own tooltip where it
   * carries one, otherwise whatever the page says near it about requirements. A disabled button
   * with nothing to explain it is reported as exactly that.
   */
  async applyBlockedReason(): Promise<string> {
    if ((await this.applyNow.count()) === 0) return 'the page offers no "Apply Now"';

    const button = this.applyNow.first();
    const enabled = await expect(button).toBeEnabled({ timeout: 10_000 }).then(
      () => true,
      () => false,
    );
    if (enabled) return '';

    const tooltip = ((await button.getAttribute('title')) ?? '').replace(/\s+/g, ' ').trim();
    if (tooltip) return tooltip;

    const notice = this.root.getByText(REQUIREMENT_NOTICE).locator('visible=true');
    if (await notice.count()) {
      return (await notice.first().innerText()).replace(/\s+/g, ' ').trim().slice(0, 200);
    }

    return '"Apply Now" is disabled and the page gives no reason for it';
  }

  /** The application is filed: the action is gone and the page says so instead. */
  async expectApplied() {
    await expect(this.appliedState.first(), 'the job page should now read "Application Submitted"').toBeVisible({ timeout: 60_000 });
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

  // ---- AI Resource ---------------------------------------------------------------------------

  /** The "AI Resource" action on the job page, which opens the popup below. */
  get aiResource(): Locator {
    return this.root.getByRole('button', { name: /AI Resource/i }).locator('visible=true');
  }

  /**
   * The popup "AI Resource" opens. Taken as whatever dialog is up rather than by a title of its
   * own, because openAiResource() checks nothing is open before it clicks - so the dialog that is
   * there afterwards is the one that click opened. That keeps a missing card reported as a missing
   * card, instead of as a popup that could not be found.
   */
  get aiResourceDialog(): Locator {
    return this.page.getByRole('dialog').locator('visible=true');
  }

  /**
   * One of the popup's cards, by the name it is headed with. Each card is headed by an `h3`
   * (verified against staging on 2026-10-27), and the whole card is itself one button - the
   * "Start test" / "Start interview" / "View plan" wording inside it is not a button of its own.
   */
  aiResourceCard(name: string): Locator {
    return this.aiResourceDialog.getByRole('heading', { level: 3, name, exact: true });
  }

  /** The clickable card for `name`: the button the heading sits in. */
  aiResourceCardButton(name: string): Locator {
    // `has` is resolved inside each button, so the heading is matched from the page root here
    // rather than through aiResourceCard(), whose dialog prefix would never be found in a button.
    return this.aiResourceDialog
      .locator('button')
      .filter({ has: this.page.getByRole('heading', { level: 3, name, exact: true }) });
  }

  /**
   * Starts the AI Mock Test from the open popup - the card click is the "Start test" the card
   * shows. What follows is the AI Mock Test sheet; see AiMockTestSheet.
   */
  async startAiMockTest() {
    await this.startAiResource('AI Mock Test');
  }

  /**
   * Starts one of the popup's resources by clicking its card - the card is the "Start test" /
   * "Start interview" / "View plan" it shows.
   */
  async startAiResource(name: (typeof AI_RESOURCE_CARDS)[number]) {
    const card = this.aiResourceCardButton(name);
    await expect(card.first(), `the popup should offer the "${name}" card`).toBeVisible({ timeout: 30_000 });
    await card.first().click();
  }

  // ---- Timeline ------------------------------------------------------------------------------

  /**
   * The "Timeline" card in the job's side column: the application's own history, which the portal
   * adds an entry to for each thing that happens to it ("Application Submitted / Applied / Applied
   * to <job>", and an entry for a completed AI Mock Test).
   *
   * The heading sits in the card's header strip, so the card itself is two levels up from it.
   */
  get timeline(): Locator {
    return this.root
      .getByRole('heading', { level: 2, name: 'Timeline', exact: true })
      .locator('xpath=ancestor::div[2]');
  }

  /** Everything the Timeline currently reads, as one string. */
  async timelineText(): Promise<string> {
    return (await this.timeline.innerText()).replace(/\s+/g, ' ').trim();
  }

  /**
   * The Timeline, one entry at a time, newest first. Each entry reads as its number ("11"), its
   * title ("Interview Completed"), a line about it ("Mock interview completed for <job>"), when it
   * happened, and - for a completed assessment - the score it came to ("22%").
   */
  async timelineEntries(): Promise<TimelineEntry[]> {
    const lines = (await this.timeline.innerText())
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const entries: TimelineEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\d{1,3}$/.test(lines[i])) continue;
      const next = lines.findIndex((line, at) => at > i && /^\d{1,3}$/.test(line));
      const rest = lines.slice(i + 1, next === -1 ? undefined : next);
      entries.push({
        number: Number(lines[i]),
        title: rest[0] ?? '',
        detail: rest[1] ?? '',
        score: rest.find((line) => /^\d+%$/.test(line)) ?? '',
      });
    }
    return entries;
  }

  /**
   * The Timeline carries an entry matching `pattern`.
   *
   * Given a retrying assertion rather than a one-off read: an entry the portal writes after an
   * assessment can land a little after the page it was triggered from, so this keeps looking for
   * the length of its timeout instead of failing on the first look.
   */
  async expectTimelineEntry(pattern: RegExp, what: string, timeout = 90_000) {
    await expect(this.timeline, 'the job page should carry a Timeline').toBeVisible({ timeout: 60_000 });
    await expect(this.timeline.getByText(pattern).first(), what).toBeVisible({ timeout });
  }

  /** Opens the "AI Resource" popup, having first made sure nothing else was already open. */
  async openAiResource() {
    await expect(
      this.page.getByRole('dialog'),
      'nothing should already be open when "AI Resource" is clicked',
    ).toHaveCount(0);

    await expect(this.aiResource.first(), 'the job page should offer "AI Resource"').toBeVisible({ timeout: 30_000 });
    await this.aiResource.first().click();
    await expect(this.aiResourceDialog.first(), '"AI Resource" should open a popup').toBeVisible({ timeout: 30_000 });
  }

  /** The popup offers all three cards; returns them in the order they are expected. */
  async expectAiResourceCards(): Promise<string[]> {
    for (const card of AI_RESOURCE_CARDS) {
      await expect(
        this.aiResourceCard(card).first(),
        `the "AI Resource" popup should offer the "${card}" card`,
      ).toBeVisible({ timeout: 30_000 });
    }
    return [...AI_RESOURCE_CARDS];
  }

  /** "Jobs" in the breadcrumb, which goes back to the listing. */
  async openJobsFromBreadcrumb() {
    await expect(this.breadcrumb, 'the job page should carry a breadcrumb').toBeVisible({ timeout: 30_000 });
    const jobs = this.breadcrumb.getByRole('link', { name: 'Jobs', exact: true });
    await expect(jobs, 'the breadcrumb should offer "Jobs"').toBeVisible();
    await jobs.click();
  }
}
