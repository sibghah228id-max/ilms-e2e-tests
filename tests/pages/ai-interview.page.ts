import { type Page, type Locator, expect } from '@playwright/test';

/** What the interview came to. */
export type InterviewOutcome = {
  /** Questions answered, which is also what the intro said the interview would ask. */
  questions: number;
  /** "This simulation will ask you N tailored questions", as the intro screen put it. */
  total: number;
  /** The questions, as the interviewer asked them. */
  asked: string[];
};

/** What the result screen showed. */
export type InterviewResult = {
  /** The overall score, e.g. "22%" - the same figure the Timeline entry carries. */
  score: string;
  /** The result's own heading, e.g. "Keep Practicing!". */
  verdict: string;
};

/**
 * The answer given to every interview question. Typed rather than spoken: the staging interview
 * is a chat - a textbox and a "Send answer" button - so no microphone is involved.
 */
const ANSWER =
  'In my last role I owned the end-to-end Playwright suite: I clarified requirements with the team, ' +
  'designed tests for the positive, negative and edge cases, automated the stable ones in CI, and ' +
  'reported defects with clear reproduction steps. The result was faster releases with fewer regressions.';

/**
 * The "AI Interview Simulation" sheet, opened from the "AI Resources" popup on an applied job's page.
 *
 * Read off the staging portal on 2026-10-28, where the flow runs entirely inside one dialog:
 *
 *   card click -> "Preparing your interview"     the questions are generated server-side (seconds
 *                                                to a minute; a session left unfinished resumes).
 *                                                An application allows 3 interviews; after that
 *                                                the sheet says so here and goes no further.
 *             -> "Interview Simulation"          an intro: "will ask you 5 tailored questions",
 *                                                and "Start Interview Simulation"
 *             -> a chat                          one question at a time, each a paragraph, answered
 *                                                in "Type your answer here..." and "Send answer"
 *             -> "Analyzing your performance..." ~15 s
 *             -> the result                      a score, Communication / Technical Skills /
 *                                                Confidence, an Expert Summary, "Detailed AI
 *                                                Insights" (one row per question), "Your
 *                                                Performance", and "Finish Preparation"
 *
 * "Send answer" is disabled while the textbox is empty and while the interviewer is still writing
 * the next question, so it is only ever pressed once the current question has its answer.
 */
export class AiInterviewSheet {
  readonly sheet: Locator;
  readonly heading: Locator;
  readonly preparing: Locator;
  readonly intro: Locator;
  readonly introText: Locator;
  readonly startInterview: Locator;
  readonly answerBox: Locator;
  readonly sendAnswer: Locator;
  readonly analysing: Locator;
  readonly score: Locator;
  readonly insights: Locator;
  readonly insightRows: Locator;
  readonly expertSummary: Locator;
  readonly performance: Locator;

  constructor(private readonly page: Page) {
    this.sheet = page.getByRole('dialog').last();
    this.heading = this.sheet.getByRole('heading', { level: 1, name: 'AI Interview Simulation' });
    this.preparing = this.sheet.getByRole('heading', { name: /preparing your interview/i });
    this.intro = this.sheet.getByRole('heading', { level: 2, name: 'Interview Simulation', exact: true });
    this.introText = this.sheet.getByText(/will ask you \d+ .*questions/i);
    this.startInterview = this.sheet.getByRole('button', { name: /start interview simulation/i });
    this.answerBox = this.sheet.getByRole('textbox', { name: /type your answer/i });
    this.sendAnswer = this.sheet.getByRole('button', { name: /send answer/i });
    this.analysing = this.sheet.getByRole('heading', { name: /analy[sz]ing your performance/i });
    this.score = this.sheet.getByRole('progressbar');
    this.insights = this.sheet.getByRole('heading', { name: 'Detailed AI Insights' });
    // One row per question, each headed "Question N / M"; the header row is left out.
    this.insightRows = this.sheet.getByRole('row').filter({ hasText: /question\s+\d+\s*\/\s*\d+/i });
    this.expertSummary = this.sheet.getByText(/^expert summary/i);
    this.performance = this.sheet.getByRole('heading', { name: 'Your Performance' });
  }

  /** The chat's messages - the interviewer's questions and the answers given, in order. */
  get messages(): Locator {
    return this.sheet.getByRole('paragraph');
  }

  /**
   * Waits out the server-side preparation and stops on the intro screen, returning how many
   * questions it says the interview will ask - or, for an application whose interview attempts are
   * all used up ("You have used all 3 interview attempts for this application."), what the sheet
   * said instead, since such a job can no longer be interviewed for at all.
   */
  async waitUntilPrepared(timeout = 4 * 60_000): Promise<{ total: number } | { exhausted: string }> {
    await expect(this.heading, 'the AI Interview Simulation sheet should open').toBeVisible({ timeout: 30_000 });
    await expect(this.preparing, 'the interview should finish being prepared').toHaveCount(0, { timeout });
    await expect(
      this.intro.or(this.attemptsUsed).first(),
      'the prepared interview should open on its "Interview Simulation" screen',
    ).toBeVisible({ timeout: 60_000 });

    if (await this.attemptsUsed.count()) {
      return { exhausted: (await this.attemptsUsed.first().innerText()).replace(/\s+/g, ' ').trim() };
    }
    await expect(this.startInterview, 'the intro should offer "Start Interview Simulation"').toBeVisible();

    const text = (await this.introText.first().innerText()).replace(/\s+/g, ' ');
    const match = text.match(/will ask you (\d+)/i);
    expect(match, `the intro said "${text}"`).not.toBeNull();
    const total = Number(match![1]);
    expect(total, `the intro said "${text}"`).toBeGreaterThan(0);
    return { total };
  }

  /** What the sheet shows instead of an interview once the application's attempts are used up. */
  get attemptsUsed(): Locator {
    return this.sheet.getByText(/used all \d+ interview attempts/i);
  }

  /** "Start Interview Simulation", through to the first question. */
  async begin() {
    await this.startInterview.click();
    await expect(this.answerBox, 'the interview should open on its first question').toBeVisible({ timeout: 60_000 });
    await expect(this.messages.first(), 'the interviewer should ask the first question').toBeVisible({
      timeout: 2 * 60_000,
    });
  }

  /**
   * Answers every question the interview asks, one at a time, and returns them.
   *
   * The interview is a chat, so a question is one new message: after each answer the next question
   * is waited for by the message count growing past the answer just sent, rather than by a sleep.
   * The loop follows the intro's own count, so an interview of any length is handled, and the last
   * answer is sent exactly once.
   */
  async answerAll(total: number): Promise<InterviewOutcome> {
    const asked: string[] = [];

    for (let n = 1; n <= total; n++) {
      // The question on screen is the newest message, and the box is empty and ready for its answer.
      await expect(this.answerBox, `question ${n} should be ready to answer`).toBeEditable({ timeout: 2 * 60_000 });
      await expect(this.answerBox).toHaveValue('');
      const before = await this.messages.count();
      const question = (await this.messages.last().innerText()).replace(/\s+/g, ' ').trim();
      expect(question, `question ${n} should have been asked`).not.toBe('');
      asked.push(question);

      await this.answerBox.fill(ANSWER);
      await expect(this.answerBox, `question ${n} should hold its answer before it is sent`).toHaveValue(ANSWER);
      await expect(this.sendAnswer, `an answer to question ${n} should enable "Send answer"`).toBeEnabled({
        timeout: 2 * 60_000,
      });
      await this.sendAnswer.click();

      // The last answer: the chat gives way to the analysis at once, so there is nothing more to
      // wait for here - expectResult() picks it up from the analysing screen.
      if (n === total) break;

      // The answer has gone into the chat as its newest message, and then the next question has to
      // arrive before it is answered, so no question is ever answered twice or skipped.
      await expect
        .poll(async () => this.messages.count(), { message: `answer ${n} should join the chat`, timeout: 60_000 })
        .toBeGreaterThan(before);
      await expect
        .poll(async () => this.messages.count(), {
          message: `the interviewer should ask question ${n + 1}`,
          timeout: 2 * 60_000,
        })
        .toBeGreaterThan(before + 1);
    }

    return { questions: asked.length, total, asked };
  }

  /**
   * The analysis that follows the last answer, and the result it ends on: the score, one insight
   * row per question answered, the Expert Summary and "Your Performance".
   */
  async expectResult(total: number): Promise<InterviewResult> {
    await expect(this.analysing, 'the finished interview should show that it is being analysed').toBeVisible({
      timeout: 60_000,
    });
    await expect(this.analysing, 'the analysis should finish').toHaveCount(0, { timeout: 5 * 60_000 });

    await expect(this.score, 'the result should show the overall score').toBeVisible({ timeout: 60_000 });
    await expect(this.insights, 'the result should show "Detailed AI Insights"').toBeVisible();
    await expect(this.insightRows, 'the insights should cover every question answered').toHaveCount(total);
    await expect(this.expertSummary.first(), 'the result should carry the Expert Summary').toBeVisible();
    await expect(this.performance, 'the result should carry "Your Performance" feedback').toBeVisible();

    const score = (await this.score.innerText()).match(/\d+%/)?.[0] ?? '';
    expect(score, 'the score should read as a percentage').not.toBe('');
    const verdict = (await this.sheet.getByRole('heading', { level: 2 }).first().innerText()).trim();
    return { score, verdict };
  }

  /**
   * Closes the sheet through its header X - the one button with no text of its own. "Finish
   * Preparation" is deliberately not used: the task is to close the result, not to move on from it.
   *
   * The X can lead back to the "AI Resources" popup the sheet was opened from rather than to the
   * job page, so whatever is still open after it is closed through its own X in turn, until the job
   * page is left with no dialog. Each X is waited out - by a dialog going, or the one left showing
   * something else - before the next is pressed.
   */
  async close() {
    const dialogs = this.page.getByRole('dialog');
    const heading = async () =>
      (await dialogs.count()) ? (await dialogs.last().getByRole('heading', { level: 1 }).first().innerText().catch(() => '')) : '';

    for (let layer = 0; layer < 3 && (await dialogs.count()) > 0; layer++) {
      const open = await dialogs.count();
      const showing = await heading();
      await dialogs.last().getByRole('button').filter({ hasText: /^$/ }).first().click();
      await expect
        .poll(async () => (await dialogs.count()) < open || (await heading()) !== showing, {
          message: `the X on "${showing}" should close it`,
          timeout: 30_000,
        })
        .toBe(true);
    }
    await expect(dialogs, 'the sheet should close').toHaveCount(0, { timeout: 30_000 });
  }
}
