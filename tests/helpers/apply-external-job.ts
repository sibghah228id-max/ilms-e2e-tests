import { type Page, expect, test } from '@playwright/test';
import {
  StudentJobsPage,
  filterField,
  filterParam,
  type GovFilter,
  type ListedJob,
} from '../pages/student-jobs.page';
import { StudentJobDetailsPage } from '../pages/student-job-details.page';

/** Every Government filter, applied together rather than one at a time. */
const ALL_FILTERS: GovFilter[] = ['Country', 'Organization', 'Job Type', 'Work Mode'];

export type ExternalApplySummary = {
  /** The value each filter was set to, all four active at once. */
  filters: Record<string, string>;
  /** How many jobs survived all four. */
  jobsListed: number;
  job: string;
  /** The route the card linked to, e.g. /jobs/gov-6a50…?source=pmyp */
  route: string;
  /** Where "Apply" went: the feed's own site, never the portal. */
  externalHost: string;
};

/**
 * A Government job from end to end: all four filters at once, then its details page, then the
 * external apply tab, then back to the listing through the breadcrumb.
 *
 * The four values are not picked at random. Most of the feed leaves work mode, job type or
 * country empty, so a combination chosen blindly matches nothing; instead a country is applied
 * first and a job that carries all four values is taken out of that response — the "anchor".
 * Its own values are what the other three filters are then set to, which is what guarantees the
 * combination has something to show, and the anchor is the job the rest of the flow follows.
 *
 * Applying is the feed's, not the portal's: the action is "Apply on <FEED>" and it opens the
 * job's own apply_url in a new tab. That tab is only looked at and closed — nothing is filled in
 * on someone else's site, and the portal tab has to be exactly as it was afterwards.
 */
export async function applyToFilteredGovernmentJob(page: Page): Promise<ExternalApplySummary> {
  const jobs = new StudentJobsPage(page);
  const details = new StudentJobDetailsPage(page);
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });

  // ---- Country, and with it a job that can carry the other three filters.
  const countries = (await jobs.filterOptions('Country')).filter((option) => !/^All /i.test(option));
  expect(countries.length, 'the Country filter should offer a country to choose').toBeGreaterThan(0);

  let listed: ListedJob[] = [];
  let anchor: ListedJob | undefined;
  const chosen: Record<string, string> = {};

  for (const country of countries) {
    listed = await jobs.applyFilter('Country', country);
    anchor = listed.find((job) => job.organization_type && job.job_type && job.work_mode && job.apply_url);
    if (anchor) {
      chosen.Country = country;
      break;
    }
  }
  expect(
    anchor,
    `no country (${countries.join(', ')}) listed a job with an organization type, job type, work mode and apply address, so no combination of all four filters can be checked`,
  ).toBeTruthy();

  // ---- The other three, taken from that job, so all four are active together.
  for (const name of ALL_FILTERS.slice(1)) {
    const value = String(anchor![filterField(name)]);
    listed = await jobs.applyFilter(name, value);
    chosen[name] = value;
  }

  // ---- Something survived all four, and it is the jobs the portal returned that are on screen.
  expect(listed.length, `${describe(chosen)} should still list a job`).toBeGreaterThan(0);
  await jobs.expectShowing(listed, 'all four filters');

  // ---- All four really are active: the rail shows them, every job that came back satisfies
  //      every one of them, and the listing was asked for with all four at once. That last one
  //      is only evidence when the page really did ask - with a combination it had cached the
  //      listing was read here instead, and the URL would then be this test's own.
  const asked = new URL(jobs.lastListingUrl).searchParams;
  for (const name of ALL_FILTERS) {
    if (!jobs.lastListingWasFetched) {
      expect(asked.get(filterParam(name)), `the listing should have been asked for ${name}`).toBe(chosen[name]);
    }
    await jobs.expectFilterSelected(name, chosen[name]);

    const field = filterField(name);
    const wrong = listed.filter((job) => String(job[field] ?? '').trim() !== chosen[name]);
    expect(
      wrong.map((job) => `${job.title.trim()} (${job[field] ?? '—'})`),
      `every job listed under ${describe(chosen)} should match ${name} "${chosen[name]}"`,
    ).toEqual([]);
  }
  annotate('jobs-all-filters', `${describe(chosen)} → ${listed.length} jobs`);

  // ---- One job out of those results, opened by its own card.
  const title = anchor!.title.replace(/\s+/g, ' ').trim();
  expect(await jobs.listedTitles(), `"${title}" should be among the filtered results`).toContain(title);

  const route = await jobs.openJobDetails(title);
  await details.expectVisible(route);
  await details.expectShowingJob(anchor!);
  annotate('jobs-details', `"${title}" at ${route}`);

  // ---- Apply: a new tab, on the feed's own site.
  const externalTab = await details.applyExternally();
  const externalUrl = externalTab.url();
  await details.expectExternalTab(externalTab, anchor!.apply_url);

  await externalTab.close();
  expect(externalTab.isClosed(), 'the external tab should be closed again').toBeTruthy();
  expect(page.context().pages(), 'the external tab should be gone from the browser').not.toContain(externalTab);
  annotate('jobs-apply-external', externalUrl);

  // ---- The portal tab was never taken anywhere: the job details page is still the one open.
  await details.expectVisible(route);
  await details.expectShowingJob(anchor!);

  // ---- Breadcrumb: back to the listing.
  await details.openJobsFromBreadcrumb();
  await jobs.expectVisible();
  await expect
    .poll(async () => (await jobs.listedTitles()).length, {
      message: 'the Jobs listing should be showing jobs again',
      timeout: 60_000,
    })
    .toBeGreaterThan(0);

  return {
    filters: chosen,
    jobsListed: listed.length,
    job: title,
    route,
    externalHost: new URL(externalUrl).host,
  };
}

/** "Country Australia, Organization Government, …", for an assertion message. */
function describe(chosen: Record<string, string>): string {
  return Object.entries(chosen)
    .map(([name, value]) => `${name} "${value}"`)
    .join(', ');
}
