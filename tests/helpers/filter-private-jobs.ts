import { type Page, expect, test } from '@playwright/test';
import { StudentJobsPage, privateJobValues, type ListedJob, type PrivateFilter } from '../pages/student-jobs.page';

/** The Private filters, each checked on its own and reset again before the next. */
const FILTERS: PrivateFilter[] = ['Location', 'Job Type', 'Skills'];

export type PrivateFilterCheck = {
  filter: PrivateFilter;
  value: string;
  /** How many cards the filter left. */
  results: number;
  /** A value that was also tried and has no jobs at all, to see the empty state. */
  emptyFor?: string;
};

/**
 * The Private filter rail, carrying on from the search: the search is cleared first, then
 * Location, Job Type and Skills one at a time, each followed by Reset.
 *
 * Only Location asks the server; Job Type and Skills are done in the browser over the jobs the
 * page has loaded so far, and the listing grows as further pages load. So nothing here counts
 * cards against a fixed number or against one response. Each value is taken off a job that is on
 * screen at that moment, and what the filter leaves is then checked job by job:
 *
 *   - every card left really carries the value - its city, its type, or that skill;
 *   - the job the value came from is still among them;
 *   - after Reset the filter is empty again and a job that does NOT carry the value is back,
 *     which is what shows the filter was lifted rather than the list merely redrawn.
 *
 * A value nothing matches would make all of that vacuous, which is why values are never taken
 * from a control's own options: Location alone offers some seven hundred cities, nearly all of
 * which no job is in. Such a value is good for one thing, and the Job Type round uses it for
 * that - the one type no job has is applied as well, to see the portal's empty state.
 */
export async function filterPrivateJobs(page: Page, listedBeforeSearch: number): Promise<PrivateFilterCheck[]> {
  const jobs = new StudentJobsPage(page);
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });

  // ---- The search, cleared: the field is empty and the whole listing is back.
  await jobs.clearSearch();
  await expect
    .poll(async () => (await jobs.listedTitles()).length, {
      message: 'clearing the search should bring the whole Private listing back',
      timeout: 60_000,
    })
    .toBeGreaterThanOrEqual(listedBeforeSearch);
  await jobs.expectActiveSource('Private');
  annotate('jobs-search-cleared', `${(await jobs.listedTitles()).length} jobs back`);

  // Every Private job with its city, type and skills, to pick values from and check results by.
  const all = await jobs.allPrivateJobs();
  const byTitle = new Map(all.map((job) => [clean(job.title), job]));

  const checks: PrivateFilterCheck[] = [];

  for (const name of FILTERS) {
    const onScreen = await jobsOnScreen(jobs, byTitle, name);

    // ---- The value to filter by, taken off the jobs on screen: the one the most of them share
    // without all of them sharing it. Both halves matter - the jobs it keeps are what the filter
    // is checked by, and the jobs it drops are what Reset is checked by - so a value that would
    // leave a single card, or leave every card, is passed over while a better one exists.
    const values = [...new Set(onScreen.flatMap((job) => privateJobValues(name, job)))];
    expect(values.length, `the jobs on screen should give a "${name}" to filter by`).toBeGreaterThan(0);

    const carriers = (value: string) => onScreen.filter((job) => privateJobValues(name, job).includes(value));
    const ranked = values
      .map((value) => ({ value, kept: carriers(value).length }))
      .sort((a, b) => b.kept - a.kept);
    const value = (ranked.find((candidate) => candidate.kept < onScreen.length) ?? ranked[0]).value;

    const keeps = carriers(value)[0];
    const drops = onScreen.find((job) => !privateJobValues(name, job).includes(value));

    // ---- Applied, then the listing is waited on until it is only jobs that carry the value.
    await jobs.applyPrivateFilter(name, value);
    await expect
      .poll(async () => unmatched(await jobs.listedTitles(), byTitle, name, value), {
        message: `${name} "${value}" should leave only jobs that carry it, and leave some`,
        timeout: 60_000,
      })
      .toEqual([]);

    // The value came off a job the listing was showing, so it has to still be there: an empty
    // listing is a failure here, not an empty state - the page's own data says otherwise.
    const left = await jobs.listedTitles();
    expect(left, `${name} "${value}" should keep "${clean(keeps.title)}", which carries it`).toContain(
      clean(keeps.title),
    );
    annotate(
      `jobs-private-${slug(name)}`,
      `${value}: ${left.length} of ${onScreen.length} jobs kept${drops ? `, e.g. "${clean(drops.title)}" dropped` : ''}`,
    );

    const check: PrivateFilterCheck = { filter: name, value, results: left.length };

    // ---- Job Type only: a type that no job has, where the empty state is the right answer.
    //
    // The boxes offer five types and the jobs only use four, so the odd one out gives the empty
    // state for free. (Location would do as well - most of its cities have no jobs - but its list
    // is seven hundred long and dear to open.) The boxes are additive, so the matched type has to
    // come off first.
    if (name === 'Job Type') {
      const taken = new Set(all.flatMap((job) => privateJobValues(name, job)));
      const barren = (await jobs.privateCheckboxOptions(name)).find((type) => !taken.has(type));

      if (barren) {
        await jobs.reset();
        await jobs.applyPrivateFilter(name, barren);
        await expect(
          jobs.emptyState.first(),
          `no job is "${barren}", so the listing should say it found nothing`,
        ).toBeVisible({ timeout: 60_000 });
        check.emptyFor = barren;
        annotate('jobs-private-job-type-empty', `${barren}: empty state shown`);
      }
    }

    // ---- Reset: the filter is empty and the listing is no longer filtered by it.
    await jobs.reset();
    await jobs.expectPrivateFilterCleared(name);

    if (drops) {
      await expect
        .poll(async () => jobs.listedTitles(), {
          message: `Reset should bring back "${clean(drops.title)}", which ${name} "${value}" had filtered out`,
          timeout: 60_000,
        })
        .toContain(clean(drops.title));
    } else {
      await expect
        .poll(async () => (await jobs.listedTitles()).length, {
          message: 'Reset should leave the listing showing jobs',
          timeout: 60_000,
        })
        .toBeGreaterThan(0);
    }
    await jobs.expectActiveSource('Private');

    checks.push(check);
  }

  return checks;
}

/** The jobs the listing is showing, as the listing's own records of them. */
async function jobsOnScreen(
  jobs: StudentJobsPage,
  byTitle: Map<string, ListedJob>,
  name: PrivateFilter,
): Promise<ListedJob[]> {
  const titles = await jobs.listedTitles();
  const known = titles.map((title) => byTitle.get(title)).filter((job): job is ListedJob => Boolean(job));
  expect(known.length, `the listing should be showing jobs to take a "${name}" from`).toBeGreaterThan(0);
  return known;
}

/**
 * The cards on screen that do not carry `value`, by title, so a failure names them. An empty
 * listing counts as one such card: the empty state's heading is an `h3` like a job's, so "No
 * results found" shows up here and fails the check rather than passing it unnoticed.
 */
function unmatched(
  titles: string[],
  byTitle: Map<string, ListedJob>,
  name: PrivateFilter,
  value: string,
): string[] {
  if (titles.length === 0) return ['<nothing on screen>'];
  return titles.filter((title) => {
    const job = byTitle.get(title);
    return !job || !privateJobValues(name, job).includes(value);
  });
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function slug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}
