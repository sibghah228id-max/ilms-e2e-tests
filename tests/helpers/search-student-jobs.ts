import { type Page, expect, test } from '@playwright/test';
import { StudentJobsPage } from '../pages/student-jobs.page';

export type JobSearchSummary = {
  /** The title taken off the listing before searching, and then searched for. */
  searched: string;
  /** How many jobs were on screen before the search. */
  listedBefore: number;
  /** How many the search left. */
  results: number;
};

/**
 * Searching the Private listing for a job that is already on screen.
 *
 * The term is never a title written into the test: one of the titles the listing is showing is
 * taken off the page and searched for, so the search is always asked for a job the portal has
 * just said it has. A search that then finds nothing is a failure, not an empty state - that is
 * the whole point of this check, and it is why the empty state is asserted to be absent instead
 * of being accepted the way a filter's empty result is.
 *
 * Of the titles on offer the first one that no other title contains is preferred, so that one
 * result is the right expectation; where every title is a substring of another, the first is
 * taken and only "the job is among the results" is held to.
 */
export async function searchForVisiblePrivateJob(page: Page): Promise<JobSearchSummary> {
  const jobs = new StudentJobsPage(page);
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });

  // ---- Jobs → All, which opens on Private, and the jobs it is showing.
  const listed = await jobs.openAllJobs();
  await jobs.expectActiveSource('Private');
  await jobs.expectShowing(listed, 'Private');

  const titles = await jobs.listedTitles();
  expect(titles.length, 'the Private listing should be showing jobs to search for').toBeGreaterThan(0);

  // ---- The title to search for, taken off the listing rather than written down here.
  const unique = (title: string) => !titles.some((other) => other !== title && other.includes(title));
  const chosen = titles.find(unique) ?? titles[0];
  annotate('jobs-search-term', `"${chosen}" of ${titles.length} listed`);

  // ---- Search for it.
  const results = await jobs.searchJobs(chosen);

  // ---- It has to be found: it was on screen a moment ago.
  await expect(
    jobs.emptyState,
    `searching for "${chosen}" found nothing, though the listing was showing that job`,
  ).toHaveCount(0);
  expect(results.length, `searching for "${chosen}" should leave the job it names`).toBeGreaterThan(0);
  expect(results, `searching for "${chosen}" should still list it`).toContain(chosen);

  // ---- And what is left is only jobs that answer to the search.
  const unrelated = results.filter((title) => !title.toLowerCase().includes(chosen.toLowerCase()));
  expect(unrelated, `every job left after searching "${chosen}" should carry that title`).toEqual([]);

  // A title no other title contains can only match itself, so the search should have left it alone.
  if (unique(chosen)) {
    expect(results, `"${chosen}" is unique in the listing, so the search should leave only it`).toEqual([chosen]);
  }

  annotate('jobs-search', `"${chosen}": ${results.length} of ${titles.length} jobs left`);

  return { searched: chosen, listedBefore: titles.length, results: results.length };
}
