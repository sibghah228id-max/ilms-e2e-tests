import { type Page, expect, test } from '@playwright/test';
import { StudentJobsPage, type ListedJob } from '../pages/student-jobs.page';
import { StudentPrivateJobPage } from '../pages/student-private-job.page';

export type PrivateApplySummary = {
  /** The job that was applied for, by the title the listing showed for it. */
  job: string;
  slug: string;
  /** How many screening questions it asked. */
  questions: number;
  /** What the "Applied" tile read before and after. */
  appliedBefore: number;
  appliedAfter: number;
  /** The call the submit made, as a path. */
  endpoint: string;
  /** What the portal said once the application was filed. */
  confirmation: string;
  /** How many jobs were open to apply for when the job was chosen. */
  candidates: number;
};

/**
 * Applying for a Private job, through the portal's own three-step flow, and then finding the
 * application again under the listing's "Applied" scope.
 *
 * The job is chosen from the listing rather than named here, and chosen so that the application
 * can actually be filed: it has to be a job the listing is showing, still active, still inside
 * its deadline, and one the student has not already applied for. That last condition is what
 * keeps the test off the duplicate-application path - the portal gives an applied job no "Apply
 * Now" at all, so a second application cannot be filed by accident, and a run that found every
 * job already applied for says so rather than failing obscurely.
 *
 * NOTE: unlike bookmarking, this cannot be undone - an application stays on the account, and
 * each run of this test uses up one of the Private jobs that are still open to it.
 */
export async function applyToPrivateJob(page: Page): Promise<PrivateApplySummary> {
  const jobs = new StudentJobsPage(page);
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });

  // ---- Jobs → All, which opens on Private: the jobs that are applied for on the portal itself.
  const listed = await jobs.openAllJobs();
  await jobs.expectActiveSource('Private');
  await jobs.expectShowing(listed, 'Private');
  await jobs.expectScope('All Jobs');

  const appliedBefore = await jobs.statCount('Applied');
  expect(appliedBefore, 'the "Applied" tile should be showing a number').not.toBeNaN();

  // ---- A job that can still be applied for, out of those on screen.
  const onScreen = new Set(await jobs.listedTitles());
  const records = await jobs.allPrivateJobs();
  const candidates = records.filter((job) => onScreen.has(clean(job.title)) && isOpenToApplications(job));

  expect(
    candidates.length,
    `none of the ${onScreen.size} jobs on screen is open to apply for - ${records.filter((job) => job.has_applied).length} of ${records.length} have been applied for already, so this run has nothing to apply to`,
  ).toBeGreaterThan(0);

  const target = candidates[0];
  const title = clean(target.title);
  annotate('jobs-apply-target', `"${title}" (${candidates.length} of ${onScreen.size} on screen still open)`);

  // The listing marks an applied job on its card, so the one that was picked should carry no mark.
  await expect(
    jobs.jobCard(title),
    `"${title}" should not be marked as applied before applying`,
  ).not.toContainText(/applied/i);

  // ---- Its own page, and the three-step apply.
  const route = await jobs.openJobDetails(title);
  const job = new StudentPrivateJobPage(page);
  await job.expectVisible(route, title);
  await job.expectNotApplied();

  const { questions, endpoint, confirmation } = await job.applyWithScreeningQuestions();
  annotate('jobs-apply-submitted', `"${title}": ${questions} questions, ${endpoint || 'no call seen'}`);
  annotate('jobs-apply-confirmation', confirmation || 'nothing was shown');

  // The portal announces a filed application; where it does, that is what it should be saying.
  if (confirmation) {
    expect(confirmation, 'the dialog that comes up should say the application was submitted').toMatch(
      /applicat(ion|ions) submitted|applied successfully|successfully applied/i,
    );
  }

  // ---- Filed: the page says so, and so does the portal's own record of the job.
  await job.expectApplied();
  await expectHasApplied(jobs, title, true);

  // ---- Back on the listing: the count is up by one and the card carries the mark.
  await job.openJobsFromBreadcrumb();
  await jobs.expectVisible();
  await expect
    .poll(async () => (await jobs.listedTitles()).length, {
      message: 'the Jobs listing should be showing jobs again',
      timeout: 60_000,
    })
    .toBeGreaterThan(0);

  await jobs.expectStatCount(
    'Applied',
    appliedBefore + 1,
    `applying for "${title}" should take the "Applied" count to ${appliedBefore + 1}`,
  );
  const appliedAfter = await jobs.statCount('Applied');
  await expect(jobs.jobCard(title), `"${title}" should now be marked as applied`).toContainText(/applied/i);

  // ---- And the listing narrowed to "Applied" has it.
  await jobs.selectScope('Applied');
  await expect
    .poll(async () => jobs.listedTitles(), {
      message: `the "Applied" scope should list "${title}", which was just applied for`,
      timeout: 60_000,
    })
    .toContain(title);

  const appliedTitles = await jobs.listedTitles();
  const everApplied = new Set(
    records
      .filter((record) => record.has_applied)
      .map((record) => clean(record.title))
      .concat(title),
  );
  expect(
    appliedTitles.filter((listedTitle) => !everApplied.has(listedTitle)),
    'the "Applied" scope should list only jobs that were applied for',
  ).toEqual([]);
  annotate('jobs-apply-scope', `${appliedTitles.length} jobs: ${appliedTitles.join(', ')}`);

  return {
    job: title,
    slug: String(target.slug ?? ''),
    questions,
    appliedBefore,
    appliedAfter,
    endpoint,
    confirmation,
    candidates: candidates.length,
  };
}

/** Still live, still inside its deadline, and not already applied for. */
function isOpenToApplications(job: ListedJob): boolean {
  if (job.has_applied) return false;
  if (job.status && job.status !== 'active') return false;

  const deadline = job.application_deadline ? Date.parse(job.application_deadline) : Number.NaN;
  return Number.isNaN(deadline) || deadline > Date.now();
}

/** The portal's own record of whether the student has applied, which the page is a picture of. */
async function expectHasApplied(jobs: StudentJobsPage, title: string, applied: boolean) {
  await expect
    .poll(
      async () => {
        const record = (await jobs.allPrivateJobs()).find((job) => clean(job.title) === title);
        expect(record, `the listing should still have a record for "${title}"`).toBeTruthy();
        return Boolean(record?.has_applied);
      },
      {
        message: `the portal should record "${title}" as ${applied ? 'applied for' : 'not applied for'}`,
        timeout: 30_000,
      },
    )
    .toBe(applied);
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
