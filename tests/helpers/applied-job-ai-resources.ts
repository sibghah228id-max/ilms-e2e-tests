import { type Page, expect, test } from '@playwright/test';
import { StudentJobsPage } from '../pages/student-jobs.page';
import { StudentPrivateJobPage, AI_RESOURCE_CARDS } from '../pages/student-private-job.page';

export type AppliedJobAiResourceSummary =
  | {
      opened: true;
      /** The applied job that was opened, by the title the listing showed for it. */
      job: string;
      /** The cards the popup offered. */
      cards: string[];
      /** How many applied jobs the account had to choose from. */
      appliedJobs: number;
    }
  | {
      opened: false;
      /** Why nothing was opened - an account with no application yet, which is not a failure. */
      reason: string;
      appliedJobs: 0;
    };

/**
 * An applied job, opened from the listing's "Applied" scope, and the "AI Resource" popup on it.
 *
 * The job is not named here: whichever application the account already carries is used, so this
 * runs against a fresh account and a well-used one alike. An account with no application at all is
 * reported back rather than failed - there is nothing wrong with a student who has not applied for
 * anything, and the caller decides what to make of it.
 *
 * Which jobs count as applied comes from the portal's own records rather than from the cards on
 * screen, because the listing's empty state is itself rendered as an `h3` ("No results found") and
 * so reads back as a job title (see StudentJobsPage.emptyState). The titles on screen are then
 * narrowed to those records, which is what keeps the empty state from ever being opened as a job.
 */
export async function openAppliedJobAiResources(page: Page): Promise<AppliedJobAiResourceSummary> {
  const jobs = new StudentJobsPage(page);
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });

  // ---- Jobs → All, which opens on Private: the jobs that are applied for on the portal itself.
  await jobs.openAllJobs();
  await jobs.expectActiveSource('Private');
  await jobs.expectScope('All Jobs');

  // What the account has actually applied for, as the portal records it.
  const records = await jobs.allPrivateJobs();
  const appliedRecords = records.filter((job) => job.has_applied);
  const appliedTitles = new Set(appliedRecords.map((job) => clean(job.title)));

  // ---- The "Applied" scope.
  await jobs.selectScope('Applied');

  // ---- Nothing applied for yet: the scope shows its empty state, and this run stops here.
  if (appliedRecords.length === 0) {
    await expect(
      jobs.emptyState,
      'with no application on the account the "Applied" scope should show its empty state',
    ).toBeVisible({ timeout: 60_000 });

    const reason = `the account has applied for none of the ${records.length} Private jobs, so there is no applied job to open`;
    annotate('jobs-applied-ai-skipped', reason);
    return { opened: false, reason, appliedJobs: 0 };
  }

  // ---- An applied job is there: wait for the scope to list one of the account's own.
  await expect
    .poll(async () => (await jobs.listedTitles()).filter((title) => appliedTitles.has(title)).length, {
      message: `the "Applied" scope should list at least one of the ${appliedRecords.length} jobs the account applied for`,
      timeout: 60_000,
    })
    .toBeGreaterThan(0);

  const listed = (await jobs.listedTitles()).filter((title) => appliedTitles.has(title));
  const title = listed[0];
  annotate('jobs-applied-ai-target', `"${title}" (${listed.length} of ${appliedRecords.length} applied jobs on screen)`);

  // ---- Its own page, through the card's "View Details".
  const route = await jobs.openJobDetails(title);
  const job = new StudentPrivateJobPage(page);
  await job.expectVisible(route, title);

  // It is the applied job it was picked as: the page carries the badge and offers no "Apply Now".
  await job.expectApplied();

  // ---- "AI Resource": the popup, and the three cards it offers.
  await job.openAiResource();
  const cards = await job.expectAiResourceCards();
  annotate('jobs-applied-ai-cards', cards.join(', '));

  return { opened: true, job: title, cards, appliedJobs: appliedRecords.length };
}

/** The names the popup is expected to offer, for a caller that wants to assert them too. */
export { AI_RESOURCE_CARDS };

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
