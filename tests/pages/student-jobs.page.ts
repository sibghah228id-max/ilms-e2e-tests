import { type Page, type Locator, type Response, expect } from '@playwright/test';

/** The two entries of the "Job Source" filter. */
export type JobSource = 'Private' | 'Government';

/** A job as the listing endpoints return it (only the fields the assertions use). */
export type ListedJob = {
  id?: number;
  title: string;
  country?: string | null;
  city?: string | null;
  organization_name?: string | null;
};

/** Private jobs come from the portal's own listing… */
const PRIVATE_JOBS_API = /\/api\/jobs\?[^"]*scope=all/;
/** …while Government jobs are served from the external feed, on a different endpoint. */
const GOVERNMENT_JOBS_API = /\/api\/external\/jobs\?/;

/**
 * Jobs for a student: /jobs, reached from the sidebar's "Jobs" group → "All".
 *
 * The page is a "Filters" rail beside the listing. "Job Source" is a pair of tabs (role=tab with
 * aria-selected, NOT buttons) that switch the page between two different feeds:
 *
 *   Private     → GET /api/jobs?scope=all&page=…       (jobs posted on the portal)
 *   Government  → GET /api/external/jobs?page=…        (the external government feed)
 *
 * and the rail itself changes with them — Private filters by Location, Government by Country,
 * Organization and Work Mode.
 *
 * Switching source leaves the previous panel in the DOM, hidden, so there are then two tablists
 * and two sets of job cards. Everything here is therefore matched on what is visible; a plain
 * `main h3` would also pick up the fifteen cards of the panel that is no longer on screen.
 */
export class StudentJobsPage {
  readonly main: Locator;
  readonly filtersHeading: Locator;
  readonly jobSourceLabel: Locator;

  constructor(private readonly page: Page) {
    this.main = page.locator('main');
    this.filtersHeading = this.main.getByText('Filters', { exact: true });
    this.jobSourceLabel = this.main.getByText('Job Source', { exact: true });
  }

  /**
   * Sidebar: the "Jobs" group, then its "All" entry. Both the Jobs group and the Projects group
   * have an entry titled "All", so the link is taken by its href; the group is only clicked when
   * the entry is not already showing (the sidebar remembers which groups are open).
   *
   * The listing is fetched as the page opens, so the first request is awaited here and handed
   * back — that is the list the page then renders.
   */
  async openAllJobs(): Promise<ListedJob[]> {
    const allJobs = this.page.locator('a[href="/jobs"]');

    if (!(await allJobs.first().isVisible().catch(() => false))) {
      await this.page.locator('aside [title="Jobs"]').first().click();
    }
    await expect(allJobs.first(), 'the sidebar "Jobs" group should offer "All"').toBeVisible({ timeout: 30_000 });

    const listed = this.waitForJobs(PRIVATE_JOBS_API);
    await allJobs.first().click();
    const jobs = await listed;

    await this.expectVisible();
    return jobs;
  }

  async expectVisible(timeout = 90_000) {
    await expect(this.page).toHaveURL(/\/jobs\/?(\?.*)?$/, { timeout });
    await expect(this.jobSourceLabel, 'the Jobs page should offer the Job Source filter').toBeVisible({ timeout });
    await expect(this.sourceTab('Private')).toBeVisible();
    await expect(this.sourceTab('Government')).toBeVisible();
  }

  // ---- Job Source ----------------------------------------------------------------------------

  /** A Job Source tab. Only the visible tablist counts; the previous one stays in the DOM. */
  sourceTab(source: JobSource): Locator {
    return this.main.getByRole('tab', { name: source, exact: true }).locator('visible=true');
  }

  /** `source` is the active Job Source and the other one is not. */
  async expectActiveSource(source: JobSource) {
    const other: JobSource = source === 'Private' ? 'Government' : 'Private';
    await expect(this.sourceTab(source), `"${source}" should be the active Job Source`).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 30_000 },
    );
    await expect(this.sourceTab(other), `"${other}" should not be the active Job Source`).toHaveAttribute(
      'aria-selected',
      'false',
    );
  }

  /**
   * Switches to a Job Source and returns the jobs the page loaded for it, taken from the request
   * that switch fires — so what is asserted afterwards is the list the page actually received.
   */
  async selectSource(source: JobSource): Promise<ListedJob[]> {
    const listed = this.waitForJobs(source === 'Private' ? PRIVATE_JOBS_API : GOVERNMENT_JOBS_API);
    await this.sourceTab(source).click();
    const jobs = await listed;

    await this.expectActiveSource(source);
    return jobs;
  }

  // ---- Filter rail ---------------------------------------------------------------------------

  /** A collapsible filter section ("Country", "Location", "Job Type", …). */
  filterSection(name: string): Locator {
    return this.main.getByRole('button', { name: new RegExp(`^${name}`) }).locator('visible=true');
  }

  /** Opens a filter section unless it is already open, and leaves it open. */
  async openFilter(name: string): Promise<Locator> {
    const section = this.filterSection(name);
    await expect(section, `the filter rail should offer "${name}"`).toBeVisible({ timeout: 30_000 });

    if ((await section.getAttribute('aria-expanded')) !== 'true') {
      await section.click();
    }
    await expect(section, `the "${name}" filter should be open`).toHaveAttribute('aria-expanded', 'true');
    return section.locator('xpath=parent::*');
  }

  /** The Country select: a button showing the current value, which opens a listbox. */
  get countryTrigger(): Locator {
    return this.filterSection('Country')
      .locator('xpath=parent::*')
      .locator('button[aria-haspopup="listbox"]');
  }

  /** Countries on offer, read from the open listbox. */
  async countryOptions(): Promise<string[]> {
    await this.countryTrigger.click();
    const listbox = this.page.getByRole('listbox');
    await expect(listbox, 'the Country filter should open a list').toBeVisible({ timeout: 30_000 });

    const names = (await listbox.getByRole('option').allInnerTexts()).map((n) => n.replace(/\s+/g, ' ').trim());
    await this.page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
    return names.filter(Boolean);
  }

  /**
   * Picks a country and returns the jobs the portal answered with.
   *
   * The choice goes to the server as `country=<name>`, so the response that carries that
   * parameter is the one awaited — the list is never read while the previous one is still shown.
   */
  async selectCountry(country: string): Promise<ListedJob[]> {
    await this.countryTrigger.click();
    const option = this.page.getByRole('listbox').getByRole('option', { name: country, exact: true });
    await expect(option, `the Country filter should offer "${country}"`).toBeVisible({ timeout: 30_000 });

    const listed = this.waitForJobs(
      new RegExp(`/api/external/jobs\\?[^"]*country=${encodeURIComponent(country).replace(/%20/g, '(%20|\\+)')}`),
    );
    await option.click();
    const jobs = await listed;

    await expect(this.countryTrigger, `the Country filter should now read "${country}"`).toHaveText(country);
    return jobs;
  }

  // ---- The listing ---------------------------------------------------------------------------

  /** Titles of the job cards on screen (the hidden panel of the other source is left out). */
  get jobTitles(): Locator {
    return this.main.locator('h3').locator('visible=true');
  }

  /** The portal's "no jobs" copy, for a filter that matches nothing. */
  get emptyState(): Locator {
    return this.main.getByText(/no jobs|no results|no matching|try adjusting/i).locator('visible=true');
  }

  /** Titles as the cards print them, trimmed (the API pads some with trailing spaces). */
  async listedTitles(): Promise<string[]> {
    return (await this.jobTitles.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  }

  /**
   * The page shows exactly the jobs it was given: every title in the response is on screen, and
   * nothing from the other source's panel is. An empty response has to show the empty state
   * instead, which is what makes a country with no jobs a pass rather than a failure.
   */
  async expectShowing(jobs: ListedJob[], what: string) {
    if (jobs.length === 0) {
      await expect(this.emptyState.first(), `${what}: nothing was returned, so the page should say so`).toBeVisible({
        timeout: 30_000,
      });
      return;
    }

    const expected = jobs.map((job) => job.title.replace(/\s+/g, ' ').trim());
    await expect
      .poll(async () => (await this.listedTitles()).length, {
        message: `${what}: the page should render the ${jobs.length} jobs it was sent`,
        timeout: 30_000,
      })
      .toBe(expected.length);

    const shown = await this.listedTitles();
    expect(shown, `${what}: the cards on screen should be the jobs that were returned`).toEqual(expected);
  }

  /**
   * Waits for a listing request and returns the jobs in it. Armed before the click that causes
   * it, so nothing is read from a list that is still being replaced.
   */
  private async waitForJobs(url: RegExp): Promise<ListedJob[]> {
    const response = await this.page.waitForResponse(
      (r) => url.test(r.url()) && r.request().method() === 'GET',
      { timeout: 90_000 },
    );
    return readJobs(response);
  }
}

/** Both listings answer `{ status, message, data: [...] }`; some endpoints nest a page inside. */
async function readJobs(response: Response): Promise<ListedJob[]> {
  expect(response.ok(), `${response.url()} answered ${response.status()}`).toBeTruthy();

  const body = await response.json();
  const data = Array.isArray(body?.data) ? body.data : body?.data?.data;
  expect(Array.isArray(data), `${response.url()} should answer with a list of jobs`).toBeTruthy();

  return (data as ListedJob[]).map((job) => ({ ...job, title: String(job.title ?? '') }));
}
