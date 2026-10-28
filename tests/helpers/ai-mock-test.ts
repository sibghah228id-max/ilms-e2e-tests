import { type Page, expect, test } from '@playwright/test';
import { StudentPrivateJobPage } from '../pages/student-private-job.page';
import { AiMockTestSheet } from '../pages/ai-mock-test.page';

export type AiMockTestSummary = {
  /** The applied job the test was taken against. */
  job: string;
  /** Questions answered, and what the counter said the test held. */
  questions: number;
  total: number;
  /** Whether the analysing state was caught before the insights replaced it. */
  analysed: boolean;
  /** What the Timeline read once the page had been reloaded. */
  timeline: string;
};

/**
 * The AI Mock Test on an applied job, taken from the already-open "AI Resources" popup through to
 * the Timeline entry it leaves behind.
 *
 *   the "AI Mock Test" card  ->  the questions being prepared  ->  "Start the Assessment"
 *   ->  every question answered, one at a time  ->  the finish  ->  analysing
 *   ->  "Detailed AI Insights"  ->  closed  ->  the page reloaded  ->  the Timeline entry
 *
 * Nothing about the assessment is hard-coded: how many questions there are comes from the portal's
 * own "Question N of M" counter, and the answering loop follows that counter forward. The portal
 * keeps the advance button disabled until the question on screen has an answer, so an unanswered
 * question can never be skipped, and the finishing press happens exactly once - the loop stops as
 * soon as the last question has been sent.
 *
 * NOTE: taking the test is not undoable. It records a completed assessment against the job, which
 * is exactly what the Timeline check at the end then looks for.
 */
export async function completeAiMockTest(page: Page, job: string): Promise<AiMockTestSummary> {
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });
  const jobPage = new StudentPrivateJobPage(page);
  const sheet = new AiMockTestSheet(page);

  // ---- The card, which is the "Start test" the popup offers.
  await jobPage.startAiMockTest();

  // ---- The questions are generated server-side; a test an earlier run generated is served at once.
  await sheet.waitUntilPrepared();
  await sheet.beginAssessment();

  const { total } = await sheet.position();
  annotate('ai-mock-test-questions', `${total} questions, as the counter reports them`);

  // ---- Every question, then the finish, the analysing state and the insights.
  const outcome = await sheet.completeAssessment();
  annotate(
    'ai-mock-test-result',
    `${outcome.questions} of ${outcome.total} answered; analysing state ${outcome.analysed ? 'seen' : 'passed too quickly to catch'}`,
  );

  // The insights are what the analysis ends on; completeAssessment waited for them, this is the
  // assertion the test is really making.
  await expect(sheet.insights.first(), 'the results should show "Detailed AI Insights"').toBeVisible();

  // ---- Close the insights, then reload so the Timeline is re-read from the server rather than
  // from whatever the page was holding when the assessment finished.
  await sheet.close();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: job }), 'the job page should come back after the reload').toBeVisible({
    timeout: 60_000,
  });

  // ---- The Timeline: the completed assessment should be an entry on it. Kept as a retrying
  // assertion, since the entry can land a moment after the assessment itself.
  await jobPage.expectTimelineEntry(
    // The entry is titled "Mock Test Completed" ("Mock test completed for <job>" underneath).
    /(ai )?mock test completed/i,
    'the Timeline should carry an entry for the AI Mock Test that was just completed',
  );

  const timeline = await jobPage.timelineText();
  annotate('ai-mock-test-timeline', timeline.slice(0, 300));

  return { job, questions: outcome.questions, total: outcome.total, analysed: outcome.analysed, timeline };
}
