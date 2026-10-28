import { test, expect } from '@playwright/test';
import credentials from '../data/student-login.json';
import { StudentLoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { browseStudentJobs } from '../helpers/browse-student-jobs';
import { filterGovernmentJobs } from '../helpers/filter-student-jobs';
import { applyToFilteredGovernmentJob } from '../helpers/apply-external-job';
import { searchForVisiblePrivateJob } from '../helpers/search-student-jobs';
import { filterPrivateJobs } from '../helpers/filter-private-jobs';
import { bookmarkAndFindJob } from '../helpers/bookmark-student-job';
import { applyToPrivateJob } from '../helpers/apply-private-job';
import { openAppliedJobAiResources, AI_RESOURCE_CARDS } from '../helpers/applied-job-ai-resources';
import { completeAiMockTest } from '../helpers/ai-mock-test';
import { takeAiInterviewOnAppliedJob } from '../helpers/ai-interview';

// Email, password and OTP come from tests/data/student-login.json only; change them there.
const { student: user } = credentials;

/**
 * Jobs for an ALREADY REGISTERED Student: signing in, then the Jobs section from the dashboard.
 *
 * Login is the shared one (StudentLoginPage.loginWithOtpIfShown, which drives OtpPage and enters
 * the stored code only when the portal asks for it), so this spec carries no login logic of its
 * own and no mailbox is involved. It starts from the dashboard the way the dashboard-login spec
 * leaves it, but runs on its own, so neither test depends on the other.
 *
 * What the Jobs part checks lives in three helpers, each carrying on where the last stopped:
 *
 *   browse-student-jobs.ts   the default source, the Government feed, the Country filter
 *   filter-student-jobs.ts   Country cleared, then Organization, Job Type and Work Mode one at a
 *                            time, each followed by Reset
 *   apply-external-job.ts    all four filters at once, a job's details page, the external apply
 *                            tab, and the breadcrumb back to the listing
 *   search-student-jobs.ts   searching the Private listing for a job that is on screen
 *   filter-private-jobs.ts   the search cleared, then Location, Job Type and Skills one at a
 *                            time, each followed by Reset
 *   bookmark-student-job.ts  bookmarking a job and finding it again under "Bookmarked"
 *   apply-private-job.ts     applying for a Private job and finding it again under "Applied"
 *   applied-job-ai-resources.ts  an applied job opened from "Applied", and its "AI Resource" popup
 *   ai-mock-test.ts          the AI Mock Test taken from that popup, and its Timeline entry
 *   ai-interview.ts          the AI Interview Simulation taken from that popup, and its Timeline entries
 *
 * The last two take the account as they find it: a listing with no job the student is eligible for,
 * or an account with no application yet, marks that test skipped with the reason instead of failing
 * it, so the rest of the spec still runs.
 *
 * Every step is checked against the jobs the portal really returned, not just against the
 * control that was clicked.
 */
test.describe('Student jobs (registered account)', () => {
  // Login round-trip, then two job feeds and a filtered one, all served by a slow staging box.
  test.setTimeout(10 * 60_000);

  test('opens Jobs from the sidebar, filters the listing, and applies to a Government job', async ({ page }) => {
    // ---- Login → OTP if asked → dashboard.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);

    // The user guide only shows on a first login; it is cleared out of the way either way, since
    // it would sit over the sidebar.
    await dashboard.completeOnboarding();
    await expect(dashboard.preview.dialog, 'the user guide should not be covering the page').toHaveCount(0);

    // ---- Jobs → All, Private by default, then Government, then the Country filter.
    const { governmentListing, ...summary } = await browseStudentJobs(page);
    test.info().annotations.push({ type: 'jobs', description: JSON.stringify(summary) });

    // ---- Country cleared, then Organization, Job Type and Work Mode, each one on its own and
    // each followed by Reset. governmentListing is the unfiltered listing every Reset goes back to.
    const filters = await filterGovernmentJobs(page, governmentListing);
    test.info().annotations.push({ type: 'jobs-filters', description: JSON.stringify(filters) });

    // ---- All four filters together, then the job's details page, the external apply tab, and
    // the breadcrumb back to the listing.
    const applied = await applyToFilteredGovernmentJob(page);
    test.info().annotations.push({ type: 'jobs-apply', description: JSON.stringify(applied) });
  });

  test('searches the Private listing, then filters it by location, job type and skills', async ({ page }) => {
    // ---- Login → OTP if asked → dashboard.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await dashboard.completeOnboarding();
    await expect(dashboard.preview.dialog, 'the user guide should not be covering the page').toHaveCount(0);

    // ---- Jobs → All → Private, a title off the listing, then that same title searched for.
    const search = await searchForVisiblePrivateJob(page);
    test.info().annotations.push({ type: 'jobs-search-summary', description: JSON.stringify(search) });

    // ---- Search cleared, then the Private rail: Location, Job Type and Skills, one at a time,
    // each followed by Reset. The Job Source stays Private throughout.
    const filters = await filterPrivateJobs(page, search.listedBefore);
    test.info().annotations.push({ type: 'jobs-private-filters', description: JSON.stringify(filters) });
  });

  test('bookmarks a job and finds it again under the "Bookmarked" scope', async ({ page }) => {
    // ---- Login → OTP if asked → dashboard.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await dashboard.completeOnboarding();
    await expect(dashboard.preview.dialog, 'the user guide should not be covering the page').toHaveCount(0);

    // ---- Jobs → All, a job that is not bookmarked, then the "Bookmarked" scope. The bookmark is
    // taken off again at the end, so the account is left as the test found it.
    const bookmark = await bookmarkAndFindJob(page);
    test.info().annotations.push({ type: 'jobs-bookmark', description: JSON.stringify(bookmark) });
  });

  /**
   * Applying cannot be undone: the application stays on the account, and this test uses up one of
   * the Private jobs that are still open to it. It picks a job that has not been applied for, so
   * runs do not collide with each other, and says so plainly if it ever runs out of them.
   */
  test('applies for a Private job and finds it again under the "Applied" scope', async ({ page }) => {
    // ---- Login → OTP if asked → dashboard.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await dashboard.completeOnboarding();
    await expect(dashboard.preview.dialog, 'the user guide should not be covering the page').toHaveCount(0);

    // ---- Jobs → All → a job still open to applications → Apply Now → confirm → screening
    // questions → the "Applied" scope.
    const applied = await applyToPrivateJob(page);
    test.info().annotations.push({ type: 'jobs-apply-private', description: JSON.stringify(applied) });

    // A listing with nothing the student is eligible for is not a failure - there may be no job
    // left that takes their qualification, or none they have not already applied for. The run is
    // marked skipped with the reason rather than red, and the tests after it still run.
    test.skip(!applied.applied, applied.applied ? '' : applied.reason);
  });

  /**
   * The "Applied" scope, an application already on the account, and the "AI Resource" popup on
   * that job's page.
   *
   * It uses whichever application the account already carries, so it does not depend on the apply
   * test above having run (or having found anything) - and an account that has applied for nothing
   * is reported and skipped rather than failed.
   */
  test('opens an applied job, checks the "AI Resource" popup and takes the AI Mock Test', async ({ page }) => {
    // The assessment is generated server-side, runs against its own countdown, and ends in an AI
    // analysis, so this one needs considerably longer than the rest of the spec.
    test.setTimeout(20 * 60_000);

    // ---- Login → OTP if asked → dashboard.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await dashboard.completeOnboarding();
    await expect(dashboard.preview.dialog, 'the user guide should not be covering the page').toHaveCount(0);

    // ---- Jobs → All → "Applied" → an applied job's "View Details" → "AI Resource" → the popup's
    // three cards.
    const resources = await openAppliedJobAiResources(page);
    test.info().annotations.push({ type: 'jobs-applied-ai', description: JSON.stringify(resources) });

    test.skip(!resources.opened, resources.opened ? '' : resources.reason);

    // The popup offered all three cards; the helper asserted each one, this records what they were.
    expect(resources.opened && resources.cards, 'the popup should offer all three AI Resource cards').toEqual([
      ...AI_RESOURCE_CARDS,
    ]);

    // ---- Straight on from the open popup: the AI Mock Test card, the whole assessment, the
    // "Detailed AI Insights" it ends on, and the Timeline entry it leaves on the job.
    const mockTest = await completeAiMockTest(page, resources.opened ? resources.job : '');
    test.info().annotations.push({ type: 'ai-mock-test', description: JSON.stringify(mockTest) });

    // All 3 attempts on this application already used: reported in the console, not failed.
    if (mockTest.attemptsUsedUp) return;

    // Every question the counter reported was answered - none skipped, none answered twice.
    expect(mockTest.questions, 'every question the assessment held should have been answered').toBe(mockTest.total);
  });

  /**
   * The same applied job and "AI Resource" popup, this time for the AI Interview Simulation: the
   * whole interview, its result and feedback, and the "Interview Started" / "Interview Completed"
   * entries it leaves on the job's Timeline.
   *
   * Like the test above it uses whichever application the account already carries, and an account
   * that has applied for nothing is reported and skipped rather than failed. An application only
   * allows 3 interviews; once they are used, that is shown in the console and the test passes.
   */
  test('opens an applied job, takes the AI Interview Simulation and finds it on the Timeline', async ({ page }) => {
    // The interview is generated server-side, runs against its own countdown, and ends in an AI
    // analysis, so this one needs considerably longer than the rest of the spec.
    test.setTimeout(20 * 60_000);

    // ---- Login → OTP if asked → dashboard.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await dashboard.completeOnboarding();
    await expect(dashboard.preview.dialog, 'the user guide should not be covering the page').toHaveCount(0);

    // ---- Jobs → All → "Applied" → an applied job → "AI Resource" →
    // the AI Interview Simulation card, every question, the analysis and result, and - after a
    // reload - both of its Timeline entries.
    const interview = await takeAiInterviewOnAppliedJob(page);
    test.info().annotations.push({ type: 'ai-interview', description: JSON.stringify(interview) });

    // All 3 attempts on this application already used: reported in the console, not failed.
    if (!interview.taken && interview.attemptsUsedUp) return;

    test.skip(!interview.taken, interview.taken ? '' : interview.reason);
    if (!interview.taken) return;

    // Every question the intro announced was answered - none skipped, none answered twice.
    expect(interview.questions, 'every question the interview asked should have been answered').toBe(interview.total);
  });
});
