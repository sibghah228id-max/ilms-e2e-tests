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
});
