import { type Page, expect, test } from '@playwright/test';
import { StudentJobsPage, filterField, type GovFilter, type ListedJob } from '../pages/student-jobs.page';

/** What one filter did: the value that was picked and the listing it produced. */
export type JobFilterCheck = {
  filter: GovFilter;
  value: string;
  jobs: number;
  /** True when the filter matched nothing and the page showed its empty state instead. */
  empty: boolean;
};

/** The filters checked here, in order, each on its own and cleared again before the next. */
const FILTERS: GovFilter[] = ['Organization', 'Job Type', 'Work Mode'];

/**
 * The rest of the Government filter rail, carrying on from browseStudentJobs(), which leaves the
 * page on the Government feed with a country selected:
 *
 *   clear Country -> Organization -> Reset -> Job Type -> Reset -> Work Mode -> Reset
 *
 * One filter at a time, and the one before is always cleared first, so each result belongs to a
 * single filter. Each round checks three things, not just that the control looks selected:
 *
 *   - the portal was asked for it: the response awaited is the one carrying `?...=<value>`;
 *   - the cards on screen are the jobs that came back (expectShowing), or the empty state when
 *     nothing came back;
 *   - every job that came back really carries the value that was picked - organization_type for
 *     Organization, job_type for Job Type, work_mode for Work Mode.
 *
 * `defaultJobs` is the unfiltered Government listing the page started with. Clearing a filter
 * and Reset both go back to it from cache without a new request, so going back is asserted
 * against those jobs rather than against a response.
 */
export async function filterGovernmentJobs(
  page: Page,
  defaultJobs: ListedJob[],
  choices: Partial<Record<GovFilter, string>> = {},
): Promise<JobFilterCheck[]> {
  const jobs = new StudentJobsPage(page);
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });

  // ---- Country: cleared first, so what follows is not still filtered by it.
  const allCountries = await jobs.clearFilter('Country');
  await jobs.expectShowing(defaultJobs, 'Country cleared');
  annotate('jobs-country-cleared', `${allCountries}: back to ${defaultJobs.length} jobs`);

  const checks: JobFilterCheck[] = [];

  for (const name of FILTERS) {
    const field = filterField(name);
    const options = await jobs.filterOptions(name);
    expect(options.length, `the "${name}" filter should offer something to choose`).toBeGreaterThan(0);

    // A select starts on its "All ..." entry, which is no filter at all, so that one is never the
    // choice. Of the rest, a value the unfiltered listing already satisfies on its own is passed
    // over where there is an alternative: filtering by it would leave the same jobs on screen,
    // and a filter that did nothing would pass. The caller can name a value instead.
    const real = options.filter((option) => !/^All /i.test(option));
    const tellsNothing = (option: string) =>
      defaultJobs.length > 0 && defaultJobs.every((job) => String(job[field] ?? '').trim() === option);
    const value = choices[name] ?? real.find((option) => !tellsNothing(option)) ?? real[0];
    expect(value, `the "${name}" filter should offer a choice besides "All ..."`).toBeTruthy();

    // ---- Apply: the jobs returned for this value, and the cards on screen are those jobs.
    const filtered = await jobs.applyFilter(name, value!);
    await jobs.expectShowing(filtered, `${name} "${value}"`);

    // ---- The jobs returned really carry the value that was picked.
    const wrong = filtered.filter((job) => String(job[field] ?? '').trim() !== value);
    expect(
      wrong.map((job) => `${job.title.trim()} (${job[field] ?? '—'})`),
      `every job listed under ${name} "${value}" should have that ${String(field)}`,
    ).toEqual([]);

    annotate(
      `jobs-filter-${name.toLowerCase().replace(/\s+/g, '-')}`,
      filtered.length > 0
        ? `${value}: ${filtered.length} jobs, e.g. "${filtered[0].title.trim()}"`
        : `${value}: no jobs, empty state shown`,
    );

    // ---- Reset: the filter is cleared and the listing is the default one again.
    await jobs.reset();
    await jobs.expectFilterCleared(name);
    await jobs.expectShowing(defaultJobs, `${name} reset`);

    checks.push({ filter: name, value: value!, jobs: filtered.length, empty: filtered.length === 0 });
  }

  return checks;
}
