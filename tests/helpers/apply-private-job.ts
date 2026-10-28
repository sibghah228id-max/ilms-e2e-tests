import { type Page, expect, test } from '@playwright/test';
import { StudentJobsPage, type ListedJob } from '../pages/student-jobs.page';
import { StudentPrivateJobPage } from '../pages/student-private-job.page';

/**
 * The minimum qualification the student applies against. Written as a pattern so a build that
 * renders it "Bachelor's" or "Bachelor" still matches the "Bachelors" the portal's own job wizard
 * offers (see PostJobPage: the dropdown is Bachelors | Masters | PhD, spelled without apostrophes).
 */
const REQUIRED_QUALIFICATION = /^bachelor('?s)?\b/i;

/**
 * A job with no minimum qualification is open to the student too: the side panel then shows "-"
 * (or another dash), or leaves the row out altogether, which reads back as ''.
 */
const NO_QUALIFICATION = /^[-–—\s]*$/;

/** The student can apply against this "Qualification Required" value: Bachelors, or none set. */
function acceptsQualification(qualification: string): boolean {
  return NO_QUALIFICATION.test(qualification) || REQUIRED_QUALIFICATION.test(qualification);
}

/**
 * How many jobs the run opens looking for one it can apply for. A cap, so a listing where every
 * job asks for more than the student holds fails with a clear message instead of walking the feed.
 */
const MAX_JOBS_TO_INSPECT = 10;

/**
 * What the run came to. Finding nothing to apply for is NOT a failure: a listing can hold no job
 * the student is eligible for, or none they have not already applied for, and either way the
 * application step simply does not happen. The caller is told so through `applied: false` and
 * decides what to do, rather than the helper failing the whole test from in here.
 */
export type PrivateApplySummary =
  | ({ applied: true } & PrivateApplyDetails)
  | {
      applied: false;
      /** Why no application was filed. */
      reason: string;
      /** How many jobs were open to apply for at all. */
      candidates: number;
    };

export type PrivateApplyDetails = {
  /** The job that was applied for, by the title the listing showed for it. */
  job: string;
  slug: string;
  /** "Qualification Required" as that job's side panel showed it. */
  qualification: string;
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

  if (candidates.length === 0) {
    const reason =
      `none of the ${onScreen.size} jobs on screen is open to apply for - ` +
      `${records.filter((job) => job.has_applied).length} of ${records.length} have been applied for already, ` +
      'so this run had nothing to apply to';
    annotate('jobs-apply-skipped', reason);
    return { applied: false, reason, candidates: 0 };
  }

  annotate('jobs-apply-candidates', `${candidates.length} of ${onScreen.size} on screen still open to apply for`);

  // ---- The job to apply for, found by opening the open ones in turn.
  //
  // Being open to applications is not enough. The student applies only for a job that asks for the
  // qualification they hold, and the portal renders "Apply Now" disabled on a job whose minimum
  // they do not meet, so clicking it would only wait on a button that is never going to enable.
  // Neither fact is in the listing - the records carry no qualification - so each candidate is
  // opened and its side panel read, and one that does not match is left alone and the next tried.
  //
  // The scan is capped at MAX_JOBS_TO_INSPECT so a listing full of jobs the student cannot apply
  // for ends in a clear failure rather than walking the whole feed.
  const job = new StudentPrivateJobPage(page);
  const shortlist = candidates.slice(0, MAX_JOBS_TO_INSPECT);
  const skipped: string[] = [];
  let applied:
    | { title: string; slug: string; qualification: string; questions: number; endpoint: string; confirmation: string }
    | undefined;

  for (const candidate of shortlist) {
    const candidateTitle = clean(candidate.title);

    // The listing marks an applied job on its card, so the one being tried should carry no mark.
    await expect(
      jobs.jobCard(candidateTitle),
      `"${candidateTitle}" should not be marked as applied before applying`,
    ).not.toContainText(/applied|application submitted/i);

    const candidateRoute = await jobs.openJobDetails(candidateTitle);
    await job.expectVisible(candidateRoute, candidateTitle);
    await job.expectNotApplied();

    // Qualification first: it is a read of the side panel, where the button check has to wait out
    // the page settling, so this rules a job out without paying for that wait.
    const qualification = await job.qualificationRequired();
    const why = !acceptsQualification(qualification)
      ? `Qualification Required is "${qualification}", not Bachelors, "-" or none`
      : await job.applyBlockedReason();

    if (why) {
      skipped.push(`"${candidateTitle}" (${why})`);
      annotate('jobs-apply-skipped', `"${candidateTitle}": ${why}`);

      // Back to the listing to try the next one.
      await job.openJobsFromBreadcrumb();
      await expectListingShowingJobs(jobs);
      continue;
    }

    annotate(
      'jobs-apply-target',
      `"${candidateTitle}" (Qualification Required "${qualification || 'not shown'}")` +
        (skipped.length ? `, after skipping ${skipped.length}: ${skipped.join(', ')}` : ''),
    );
    applied = {
      title: candidateTitle,
      slug: String(candidate.slug ?? ''),
      qualification,
      ...(await job.applyWithScreeningQuestions()),
    };
    break;
  }

  if (!applied) {
    const reason =
      'No Private job found with Qualification Required = Bachelors, "-" or none, and an enabled Apply button. ' +
      `Checked ${shortlist.length} of the ${candidates.length} Private jobs still open to apply ` +
      `for: ${skipped.join(', ')}`;
    annotate('jobs-apply-skipped', reason);
    return { applied: false, reason, candidates: candidates.length };
  }

  const { title, slug, qualification: appliedQualification, questions, endpoint, confirmation } = applied;
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
  await expectListingShowingJobs(jobs);

  await jobs.expectStatCount(
    'Applied',
    appliedBefore + 1,
    `applying for "${title}" should take the "Applied" count to ${appliedBefore + 1}`,
  );
  const appliedAfter = await jobs.statCount('Applied');
  await expect(jobs.jobCard(title), `"${title}" should now be marked as applied`).toContainText(/applied|application submitted/i);

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
    applied: true,
    job: title,
    slug,
    qualification: appliedQualification,
    questions,
    appliedBefore,
    appliedAfter,
    endpoint,
    confirmation,
    candidates: candidates.length,
  };
}

/**
 * The listing is back and has jobs on it. Used after leaving a job page, both when backing out of
 * one that refused an application and after the one that took it, since the next step either way
 * reads the listing.
 */
async function expectListingShowingJobs(jobs: StudentJobsPage) {
  await jobs.expectVisible();
  await expect
    .poll(async () => (await jobs.listedTitles()).length, {
      message: 'the Jobs listing should be showing jobs again',
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
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
