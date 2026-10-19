import { type Page, expect, test } from '@playwright/test';
import { StudentJobsPage, type ListedJob } from '../pages/student-jobs.page';

export type JobsBrowseSummary = {
  privateJobs: number;
  governmentJobs: number;
  country: string;
  countryJobs: number;
  /** True when the chosen country had no jobs and the page showed its empty state instead. */
  countryEmpty: boolean;
  /** The unfiltered Government listing, for whoever carries on with the rest of the filters. */
  governmentListing: ListedJob[];
};

/**
 * Jobs for a student: the sidebar entry, the default Job Source, the Government feed and the
 * Country filter — each checked against the jobs the portal actually returned, not just against
 * the control that was clicked.
 *
 * Every step reads the listing out of the request the page made, so a filter that changes the
 * dropdown but not the results fails here: the titles rendered on screen are compared with the
 * titles in that response, and for the country filter every job is checked to belong to it.
 *
 * A country with no jobs is a pass as long as the page says so — see expectShowing().
 */
export async function browseStudentJobs(page: Page, country?: string): Promise<JobsBrowseSummary> {
  const jobs = new StudentJobsPage(page);
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });

  // ---- Sidebar: Jobs → All.
  const privateJobs = await jobs.openAllJobs();

  // ---- Private is what a first visit opens on, and the listing is the private one.
  await jobs.expectActiveSource('Private');
  await jobs.expectShowing(privateJobs, 'Private');
  expect(privateJobs.length, 'the Private source should have jobs to show').toBeGreaterThan(0);
  annotate('jobs-private', `${privateJobs.length} jobs, e.g. "${privateJobs[0].title.trim()}"`);

  // ---- Government: a different feed, so the listing has to change with the tab.
  const governmentJobs = await jobs.selectSource('Government');
  await jobs.expectShowing(governmentJobs, 'Government');
  expect(governmentJobs.length, 'the Government source should have jobs to show').toBeGreaterThan(0);

  const privateTitles = new Set(privateJobs.map((job) => job.title.trim()));
  const governmentTitles = governmentJobs.map((job) => job.title.trim());
  expect(
    governmentTitles.some((title) => !privateTitles.has(title)),
    'the Government listing should differ from the Private one, not just the selected tab',
  ).toBeTruthy();
  annotate('jobs-government', `${governmentJobs.length} jobs, e.g. "${governmentTitles[0]}"`);

  // ---- Country: offered only for the Government feed.
  await jobs.openFilter('Country');
  const options = await jobs.countryOptions();
  expect(options.length, 'the Country filter should offer something to choose').toBeGreaterThan(0);
  annotate('jobs-countries', options.join(', '));

  // "All countries" is the current setting, so the first real country is the one picked, unless
  // the caller named one.
  const chosen = country ?? options.find((name) => !/^all /i.test(name));
  expect(chosen, 'the Country filter should offer a country besides "All countries"').toBeTruthy();

  const countryJobs = await jobs.selectCountry(chosen!);
  await jobs.expectShowing(countryJobs, `Country "${chosen}"`);

  // The jobs that came back belong to the country that was picked — the point of the filter.
  const wrong = countryJobs.filter((job) => (job.country ?? '').trim() !== chosen);
  expect(
    wrong.map((job) => `${job.title.trim()} (${job.country})`),
    `every job listed under "${chosen}" should be from that country`,
  ).toEqual([]);

  annotate(
    'jobs-country-filter',
    countryJobs.length > 0
      ? `${chosen}: ${countryJobs.length} jobs, e.g. "${countryJobs[0].title.trim()}" in ${countryJobs[0].city ?? '—'}`
      : `${chosen}: no jobs, empty state shown`,
  );

  return {
    privateJobs: privateJobs.length,
    governmentJobs: governmentJobs.length,
    country: chosen!,
    countryJobs: countryJobs.length,
    countryEmpty: countryJobs.length === 0,
    governmentListing: governmentJobs,
  };
}
