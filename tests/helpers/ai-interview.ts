import { type Page, expect, test } from '@playwright/test';
import { StudentPrivateJobPage, type TimelineEntry } from '../pages/student-private-job.page';
import { AiInterviewSheet } from '../pages/ai-interview.page';
import { openAppliedJobAiResources } from './applied-job-ai-resources';

export type AiInterviewSummary = {
  taken: true;
  /** The applied job the interview was taken against. */
  job: string;
  /** Questions answered, and what the intro said the interview would ask. */
  questions: number;
  total: number;
  /** The overall score the result showed, e.g. "22%". */
  score: string;
  /** The Timeline entries the interview left, as read once the page had been reloaded. */
  started: TimelineEntry;
  completed: TimelineEntry;
};

/**
 * Why no interview was taken: the account has no applied job, or - `attemptsUsedUp`, the sheet's own
 * message - the job's 3 interview attempts are already used.
 */
export type AiInterviewSkipped = { taken: false; reason: string; attemptsUsedUp?: string };

const STARTED = 'Interview Started';
const COMPLETED = 'Interview Completed';

/**
 * The AI Interview Simulation on an applied job, taken from the already-open "AI Resources" popup
 * through to the two Timeline entries it leaves behind.
 *
 *   the "AI Interview Simulation" card  ->  the interview being prepared  ->  "Start Interview
 *   Simulation"  ->  every question answered, one at a time  ->  analysing  ->  the result and
 *   its feedback  ->  closed  ->  the page reloaded  ->  "Interview Started" and "Interview Completed"
 *
 * Nothing about the interview is hard-coded: how many questions it asks comes from its own intro,
 * and each question is read off the chat as it arrives.
 *
 * The Timeline check is pinned to this interview rather than to any interview: the entries are
 * counted before it starts, and afterwards there has to be one more "Interview Completed", newer
 * than everything that was there before, carrying the score the result screen showed. Its
 * "Interview Started" is the newest one below it - which is a new entry, unless an earlier run had
 * started an interview and left it unfinished, in which case the portal resumes that session and
 * its existing "Interview Started" is the one that belongs to it.
 *
 * An application only allows 3 interviews. Once they are used the sheet says so instead of
 * offering one, and that is reported - in the console and the report - rather than failed: it
 * comes back as `taken: false` with the message, as does an account with no applied job at all.
 *
 * NOTE: taking the interview is not undoable. It records a completed interview against the job,
 * and uses up one of its 3 attempts.
 */
export async function takeAiInterviewOnAppliedJob(page: Page): Promise<AiInterviewSummary | AiInterviewSkipped> {
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });
  const jobPage = new StudentPrivateJobPage(page);
  const sheet = new AiInterviewSheet(page);

  // ---- Jobs → All → "Applied" → an applied job → "AI Resource".
  const resources = await openAppliedJobAiResources(page);
  if (!resources.opened) return { taken: false, reason: resources.reason };
  const job = resources.job;

  // What the Timeline held before, read from the job page under the popup.
  await expect(jobPage.timeline, 'the job page should carry a Timeline').toBeVisible({ timeout: 60_000 });
  const before = await jobPage.timelineEntries();

  // ---- The card, which is the "Start interview" the popup offers; then preparation, and the intro
  // that says how many questions are coming.
  await jobPage.startAiResource('AI Interview Simulation');
  const ready = await sheet.waitUntilPrepared();

  // ---- No attempt left on this application: not a failure, just reported. The message goes to the
  // console and the report, the sheet is closed, and the test ends here.
  if (!('total' in ready)) {
    console.log(`[ai-interview] "${job}": ${ready.exhausted} The AI Interview Simulation was not taken.`);
    annotate('ai-interview-attempts-used', `"${job}": ${ready.exhausted}`);
    await sheet.close();
    return { taken: false, reason: ready.exhausted, attemptsUsedUp: ready.exhausted };
  }
  const total = ready.total;

  const newestBefore = Math.max(0, ...before.map((entry) => entry.number));
  const startedBefore = before.filter((entry) => entry.title === STARTED).length;
  const completedBefore = before.filter((entry) => entry.title === COMPLETED).length;
  // An interview started but never finished is resumed rather than started afresh.
  const resuming = startedBefore > completedBefore;
  annotate(
    'ai-interview-timeline-before',
    `${before.length} entries; ${startedBefore} started, ${completedBefore} completed${resuming ? ' (an unfinished interview will resume)' : ''}`,
  );

  annotate('ai-interview-questions', `${total} questions, as the intro announces them`);
  await sheet.begin();

  // ---- Every question, then the analysis and the result.
  const outcome = await sheet.answerAll(total);
  annotate('ai-interview-asked', outcome.asked.map((q, i) => `${i + 1}. ${q}`).join(' | ').slice(0, 1000));

  const result = await sheet.expectResult(total);
  annotate('ai-interview-result', `${result.verdict} - ${result.score}`);

  // ---- Close the result, then reload so the Timeline is re-read from the server.
  await sheet.close();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: job }), 'the same job page should come back after the reload').toBeVisible({
    timeout: 60_000,
  });
  await expect(jobPage.timeline, 'the job page should carry a Timeline after the reload').toBeVisible({
    timeout: 60_000,
  });

  // ---- The Timeline: one more "Interview Completed", newer than anything that was there before.
  // Retried, since the entry can land a moment after the result does.
  await expect
    .poll(async () => (await jobPage.timelineEntries()).filter((entry) => entry.title === COMPLETED).length, {
      message: `the Timeline should gain an "${COMPLETED}" entry for this interview (it had ${completedBefore})`,
      timeout: 90_000,
    })
    .toBe(completedBefore + 1);

  const after = await jobPage.timelineEntries();
  annotate('ai-interview-timeline-after', after.slice(0, 4).map((e) => `${e.number} ${e.title} ${e.score}`).join(' | '));

  const completed = after.find((entry) => entry.title === COMPLETED);
  expect(completed, `the Timeline should carry an "${COMPLETED}" entry`).toBeDefined();
  expect(completed!.number, `the "${COMPLETED}" entry should be newer than everything there before`).toBeGreaterThan(
    newestBefore,
  );
  expect(completed!.detail, `the "${COMPLETED}" entry should be for "${job}"`).toContain(job);
  expect(completed!.score, `the "${COMPLETED}" entry should carry the score the result showed`).toBe(result.score);

  // Its "Interview Started": the newest one below it, and newer than the previous completed interview.
  const started = after.find((entry) => entry.title === STARTED && entry.number < completed!.number);
  expect(started, `the Timeline should carry an "${STARTED}" entry for the interview that was just completed`).toBeDefined();
  const previousCompleted = after.find((entry) => entry.title === COMPLETED && entry.number < completed!.number);
  if (previousCompleted) {
    expect(
      started!.number,
      `the "${STARTED}" entry should belong to this interview, not to the one completed at entry ${previousCompleted.number}`,
    ).toBeGreaterThan(previousCompleted.number);
  }
  expect(started!.detail, `the "${STARTED}" entry should be for "${job}"`).toContain(job);
  expect(
    after.filter((entry) => entry.title === STARTED).length,
    resuming
      ? `the resumed interview should not add a second "${STARTED}" entry`
      : `the interview should add one "${STARTED}" entry (there were ${startedBefore})`,
  ).toBe(resuming ? startedBefore : startedBefore + 1);

  return { taken: true, job, questions: outcome.questions, total, score: result.score, started: started!, completed: completed! };
}
