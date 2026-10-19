import { type Page, expect, test } from '@playwright/test';
import { StudentJobsPage, type ListedJob } from '../pages/student-jobs.page';

export type BookmarkSummary = {
  /** The job that was bookmarked, by the title the listing showed for it. */
  job: string;
  /** What the "Bookmarked" tile read before anything was changed, and after. */
  countBefore: number;
  countAfter: number;
  /** How many jobs the "Bookmarked" scope then listed. */
  bookmarkedListed: number;
  /** Whether the bookmark was taken off again, leaving the account as it was found. */
  restored: boolean;
};

/**
 * Bookmarking a job, and then finding it again through the listing's "Bookmarked" scope.
 *
 * Nothing is named in advance: the job is whichever card on screen is not bookmarked yet, and
 * its title is read off that card and used for everything after. Three things are checked at
 * each turn, because the icon alone proves little:
 *
 *   - the portal was told: the POST (or DELETE) that goes with the job's own slug answered OK;
 *   - the record agrees: the listing endpoint reports is_saved for that job afterwards;
 *   - the page agrees: the icon reads "Bookmarked" and the tile has gone up by exactly one.
 *
 * The bookmark is taken off again at the end, so the account is left as it was found and the
 * test can be run as often as one likes - the counts it asserts are relative, so jobs other
 * runs may have left bookmarked do not matter either.
 */
export async function bookmarkAndFindJob(page: Page): Promise<BookmarkSummary> {
  const jobs = new StudentJobsPage(page);
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });

  // ---- Jobs → All, which opens on Private: the source whose cards can be bookmarked.
  const listed = await jobs.openAllJobs();
  await jobs.expectActiveSource('Private');
  await jobs.expectShowing(listed, 'Private');
  await jobs.expectScope('All Jobs');

  // ---- The count as it stands, before anything is touched.
  const countBefore = await jobs.statCount('Bookmarked');
  expect(countBefore, 'the "Bookmarked" tile should be showing a number').not.toBeNaN();

  // ---- A job that is not bookmarked, and its title, which is what the rest of this follows.
  const job = await jobs.firstUnbookmarkedTitle();
  annotate('jobs-bookmark-target', `"${job}", with ${countBefore} already bookmarked`);

  // ---- Bookmarked: the call, the record, the icon and the count.
  await jobs.toggleBookmark(job);
  await expectSaved(jobs, job, true);
  await jobs.expectBookmarkCount(countBefore + 1, `bookmarking "${job}" should take the count to ${countBefore + 1}`);
  const countAfter = await jobs.statCount('Bookmarked');
  annotate('jobs-bookmark-added', `"${job}": ${countBefore} → ${countAfter}`);

  // ---- The listing narrowed to bookmarks: the job is there, and so is nothing else.
  await jobs.selectScope('Bookmarked');
  await expect
    .poll(async () => jobs.listedTitles(), {
      message: `the "Bookmarked" scope should list "${job}", which was just bookmarked`,
      timeout: 60_000,
    })
    .toContain(job);

  const bookmarkedTitles = await jobs.listedTitles();
  await expect(
    jobs.unbookmarkedToggles,
    'every job under the "Bookmarked" scope should be a bookmarked one',
  ).toHaveCount(0);
  await expect(jobs.bookmarkedToggles, 'the bookmarked jobs should be the cards on screen').toHaveCount(
    bookmarkedTitles.length,
  );

  // And each of those cards is a job the portal itself calls bookmarked.
  const saved = new Set(
    (await jobs.allPrivateJobs()).filter((record) => record.is_saved).map((record) => clean(record.title)),
  );
  expect(
    bookmarkedTitles.filter((title) => !saved.has(title)),
    'the "Bookmarked" scope should list only jobs the portal has saved',
  ).toEqual([]);
  annotate('jobs-bookmark-scope', `${bookmarkedTitles.length} jobs: ${bookmarkedTitles.join(', ')}`);

  // ---- Put it back: the bookmark comes off and the count returns to where it started.
  await jobs.selectScope('All Jobs');
  await jobs.toggleBookmark(job);
  await expectSaved(jobs, job, false);
  await jobs.expectBookmarkCount(countBefore, `removing the bookmark should take the count back to ${countBefore}`);
  annotate('jobs-bookmark-removed', `"${job}": back to ${countBefore}`);

  return {
    job,
    countBefore,
    countAfter,
    bookmarkedListed: bookmarkedTitles.length,
    restored: true,
  };
}

/** The portal's own record of whether a job is bookmarked, which the icon is only a picture of. */
async function expectSaved(jobs: StudentJobsPage, title: string, saved: boolean) {
  await expect
    .poll(
      async () => {
        const record = (await jobs.allPrivateJobs()).find((job: ListedJob) => clean(job.title) === title);
        expect(record, `the listing should still have a record for "${title}"`).toBeTruthy();
        return Boolean(record?.is_saved);
      },
      {
        message: `the portal should have "${title}" ${saved ? 'saved' : 'no longer saved'}`,
        timeout: 30_000,
      },
    )
    .toBe(saved);
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
