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
  organization_type?: string | null;
  job_type?: string | null;
  work_mode?: string | null;
  /** Where a Government job is really applied for: the feed's own site, opened in a new tab. */
  apply_url?: string | null;
  source?: string | null;
  source_id?: string | null;
};

/** The filters the rail offers for the Government feed. */
export type GovFilter = 'Country' | 'Organization' | 'Job Type' | 'Work Mode';

/**
 * What each Government filter is: the control it uses, the query parameter it sends, and the
 * field of a returned job that has to carry the chosen value.
 *
 *   Country       select     ?country=Pakistan             -> job.country
 *   Organization  select     ?organizationType=Government  -> job.organization_type  (a TYPE, not a name)
 *   Job Type      checkbox   ?jobType=Full+Time            -> job.job_type
 *   Work Mode     select     ?workMode=Remote              -> job.work_mode
 */
const GOV_FILTERS: Record<GovFilter, { kind: 'select' | 'checkbox'; param: string; field: keyof ListedJob }> = {
  Country: { kind: 'select', param: 'country', field: 'country' },
  Organization: { kind: 'select', param: 'organizationType', field: 'organization_type' },
  'Job Type': { kind: 'checkbox', param: 'jobType', field: 'job_type' },
  'Work Mode': { kind: 'select', param: 'workMode', field: 'work_mode' },
};

/** Which field of a returned job a filter promises something about. */
export function filterField(name: GovFilter): keyof ListedJob {
  return GOV_FILTERS[name].field;
}

/** The query parameter a filter sends, for checking which filters a listing was asked for. */
export function filterParam(name: GovFilter): string {
  return GOV_FILTERS[name].param;
}

/** The "no filter" entry of a select filter: "All countries", "All organizations", ... */
const ALL_OPTION = /^All /i;

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
  /** The listing request the page made last, which carries every filter that is active. */
  lastListingUrl = '';
  /**
   * True when that listing was not a request of the page's own but one made here, because the
   * page had the combination cached - see applyFilter().
   */
  lastListingWasFetched = false;
  /** The filters the rail has active, as the Government listing endpoint takes them. */
  private readonly active = new Map<string, string>();

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
    this.active.clear();
    const listed = this.waitForJobs(source === 'Private' ? PRIVATE_JOBS_API : GOVERNMENT_JOBS_API);
    await this.sourceTab(source).click();
    const jobs = await listed;

    await this.expectActiveSource(source);
    return jobs;
  }

  // ---- Filter rail ---------------------------------------------------------------------------

  /**
   * The header of a collapsible filter section ("Country", "Organization", "Job Type", ...).
   *
   * Matched on the accordion header only (it is the button with `aria-expanded`), because the
   * select inside a section is a button carrying the same words - Work Mode's trigger, for
   * instance, is named "All work modes Work mode".
   */
  filterSection(name: string): Locator {
    return this.main
      .locator('button[aria-expanded]')
      .filter({ hasText: new RegExp(`^${name}$`) })
      .locator('visible=true');
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

  /** The body of a filter section: everything under its header. */
  private filterPanel(name: GovFilter): Locator {
    return this.filterSection(name).locator('xpath=parent::*');
  }

  /** The select of a filter section: a button showing the current value, which opens a listbox. */
  filterTrigger(name: GovFilter): Locator {
    return this.filterPanel(name).locator('button[aria-haspopup="listbox"]');
  }

  /** One entry of a checkbox filter (Job Type), found by its label. */
  checkboxOption(name: GovFilter, value: string): Locator {
    return this.filterPanel(name)
      .locator('label')
      .filter({ hasText: new RegExp(`^${value}$`) });
  }

  /** The Country select: a button showing the current value, which opens a listbox. */
  get countryTrigger(): Locator {
    return this.filterTrigger('Country');
  }

  /** Countries on offer, read from the open listbox. */
  async countryOptions(): Promise<string[]> {
    return this.filterOptions('Country');
  }

  /**
   * What a filter offers, the section being opened first. A select is read from its listbox,
   * which is closed again afterwards; a checkbox list straight off its labels.
   */
  async filterOptions(name: GovFilter): Promise<string[]> {
    await this.openFilter(name);

    if (GOV_FILTERS[name].kind === 'checkbox') {
      const labels = this.filterPanel(name).locator('label');
      await expect(labels.first(), `the "${name}" filter should offer something to choose`).toBeVisible({
        timeout: 30_000,
      });
      return (await labels.allInnerTexts()).map(clean).filter(Boolean);
    }

    await this.filterTrigger(name).click();
    const listbox = this.page.getByRole('listbox');
    await expect(listbox, `the "${name}" filter should open a list`).toBeVisible({ timeout: 30_000 });

    const names = (await listbox.getByRole('option').allInnerTexts()).map(clean);
    await this.page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
    return names.filter(Boolean);
  }

  /**
   * Picks a country and returns the jobs the portal answered with.
   *
   * The choice goes to the server as `country=<name>`, so the response that carries that
   * parameter is the one awaited - the list is never read while the previous one is still shown.
   */
  async selectCountry(country: string): Promise<ListedJob[]> {
    return this.applyFilter('Country', country);
  }

  /**
   * Applies one Government filter and returns the jobs the portal answered with.
   *
   * Whatever the control, the value reaches the server as a query parameter, so the response
   * carrying that parameter is the one awaited: nothing is read off a list that is still being
   * replaced, and a control that changes nothing but itself cannot pass.
   */
  async applyFilter(name: GovFilter, value: string): Promise<ListedJob[]> {
    const { kind, param } = GOV_FILTERS[name];
    await this.openFilter(name);

    const listed = this.waitForJobs(paramPattern(param, value), { cached: true });

    if (kind === 'checkbox') {
      const option = this.checkboxOption(name, value);
      await expect(option, `the "${name}" filter should offer "${value}"`).toBeVisible({ timeout: 30_000 });
      await option.click();
    } else {
      await this.filterTrigger(name).click();
      const option = this.page.getByRole('listbox').getByRole('option', { name: value, exact: true });
      await expect(option, `the "${name}" filter should offer "${value}"`).toBeVisible({ timeout: 30_000 });
      await option.click();
    }

    this.active.set(param, value);
    const jobs = await listed;
    await this.expectFilterSelected(name, value);
    return jobs;
  }

  /**
   * The filter shows `value` as its current choice.
   *
   * The rail is an accordion - opening a section closes the one before it and takes its control
   * out of the page - so the section is opened again here rather than assumed to be still open.
   */
  async expectFilterSelected(name: GovFilter, value: string) {
    await this.openFilter(name);

    if (GOV_FILTERS[name].kind === 'checkbox') {
      await expect(
        this.checkboxOption(name, value).locator('input[type="checkbox"]'),
        `"${value}" should be ticked under "${name}"`,
      ).toBeChecked();
      return;
    }
    await expect(this.filterTrigger(name), `the "${name}" filter should now read "${value}"`).toHaveText(value);
  }

  /**
   * Clears a select filter by choosing its "All ..." entry, and returns that entry's label.
   *
   * Going back to the unfiltered list fires no request - the portal still has the first page
   * cached - so only the control is asserted here; that the listing really went back is checked
   * by the caller against the jobs the page started with.
   */
  async clearFilter(name: GovFilter): Promise<string> {
    await this.openFilter(name);
    await this.filterTrigger(name).click();

    const listbox = this.page.getByRole('listbox');
    const all = listbox.getByRole('option').filter({ hasText: ALL_OPTION }).first();
    await expect(all, `the "${name}" filter should offer an "All ..." entry to clear it`).toBeVisible({
      timeout: 30_000,
    });

    const label = clean(await all.innerText());
    await all.click();
    await expect(listbox).toHaveCount(0);
    await this.expectFilterCleared(name);

    this.active.delete(GOV_FILTERS[name].param);
    return label;
  }

  /** No choice is active for this filter: a select is back on "All ...", no box is ticked. */
  async expectFilterCleared(name: GovFilter) {
    await this.openFilter(name);

    if (GOV_FILTERS[name].kind === 'checkbox') {
      await expect(
        this.filterPanel(name).locator('input[type="checkbox"]:checked'),
        `nothing should be ticked under "${name}" any more`,
      ).toHaveCount(0, { timeout: 30_000 });
      return;
    }
    await expect(this.filterTrigger(name), `the "${name}" filter should be back to "All ..."`).toHaveText(ALL_OPTION, {
      timeout: 30_000,
    });
  }

  /** "Reset", at the top of the filter rail. */
  get resetButton(): Locator {
    return this.main.getByRole('button', { name: /^Reset$/ }).locator('visible=true');
  }

  /**
   * Clears every filter at once. Like clearing a single select this serves the first, unfiltered
   * page from cache instead of refetching, so the caller checks the listing itself.
   */
  async reset() {
    await expect(this.resetButton, 'the filter rail should offer "Reset"').toBeVisible({ timeout: 30_000 });
    await this.resetButton.first().click();
    this.active.clear();
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
    return (await this.jobTitles.allInnerTexts()).map(clean);
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

    const expected = jobs.map((job) => clean(job.title));
    await expect
      .poll(async () => (await this.listedTitles()).length, {
        message: `${what}: the page should render the ${jobs.length} jobs it was sent`,
        timeout: 30_000,
      })
      .toBe(expected.length);

    const shown = await this.listedTitles();
    expect(shown, `${what}: the cards on screen should be the jobs that were returned`).toEqual(expected);
  }

  /** The card of a job, found by the title it shows (its `h3` carries the title as an attribute). */
  jobCard(title: string): Locator {
    return this.main
      .locator('a:visible')
      .filter({ has: this.page.getByRole('heading', { level: 3, name: title, exact: true }) })
      .first();
  }

  /**
   * Opens a job through the "View Details" of its card and returns the route that took.
   *
   * The route is read off the card rather than built here, so the test does not assume how the
   * portal addresses a job; "View Details" is then taken by that same route, which is what ties
   * the button to the job whose title was picked.
   */
  async openJobDetails(title: string): Promise<string> {
    const card = this.jobCard(title);
    await expect(card, `the listing should show a card for "${title}"`).toBeVisible({ timeout: 30_000 });

    const route = await card.getAttribute('href');
    expect(route, `the card for "${title}" should link to the job`).toBeTruthy();

    const viewDetails = this.main
      .locator(`a[href="${route}"]`)
      .filter({ hasText: /View Details/i })
      .locator('visible=true');
    await expect(viewDetails.first(), `the card for "${title}" should offer "View Details"`).toBeVisible();
    await viewDetails.first().click();

    return route!;
  }

  /**
   * Waits for a listing request and returns the jobs in it. Armed before the click that causes
   * it, so nothing is read from a list that is still being replaced.
   *
   * `cached` is for a filter that may not cause a request at all: the portal keeps the listings
   * it has already loaded, so re-applying a combination it has seen before - which a test will
   * do as soon as it visits the same filter twice - renders straight from that cache. The wait
   * is then short and the listing is asked for here instead, with the filters the rail has
   * active, which is the same question the page would have asked.
   */
  private async waitForJobs(url: RegExp, { cached = false } = {}): Promise<ListedJob[]> {
    const response = await this.page
      .waitForResponse((r) => url.test(r.url()) && r.request().method() === 'GET', {
        timeout: cached ? 20_000 : 90_000,
      })
      .catch((error: Error) => {
        if (!cached) throw error;
        return null;
      });

    if (response) {
      this.lastListingUrl = response.url();
      this.lastListingWasFetched = false;
      return readJobs(response);
    }
    return this.fetchListing();
  }

  /** The Government listing for the filters that are active, asked for from the page itself. */
  private async fetchListing(): Promise<ListedJob[]> {
    const query = new URLSearchParams({ page: '1', per_page: '15', ...Object.fromEntries(this.active) });
    const path = `/api/external/jobs?${query}`;

    const answer = await this.page.evaluate(async (listing) => {
      const response = await fetch(listing, { headers: { accept: 'application/json' } });
      return { ok: response.ok, status: response.status, body: await response.text() };
    }, path);
    expect(answer.ok, `${path} answered ${answer.status}`).toBeTruthy();

    this.lastListingUrl = new URL(path, this.page.url()).toString();
    this.lastListingWasFetched = true;
    return jobsIn(JSON.parse(answer.body), path);
  }
}

/** Card titles and option labels are compared trimmed; the feed pads some with trailing spaces. */
function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The listing request a filter should cause, e.g. `?...&jobType=Full+Time`. The value is escaped
 * for the regexp, and a space is allowed to arrive either way round (`%20` or `+`).
 */
function paramPattern(param: string, value: string): RegExp {
  const encoded = encodeURIComponent(value)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%20/g, '(%20|\\+)');
  return new RegExp(`/api/external/jobs\\?[^"]*${param}=${encoded}`);
}

/** Both listings answer `{ status, message, data: [...] }`; some endpoints nest a page inside. */
async function readJobs(response: Response): Promise<ListedJob[]> {
  expect(response.ok(), `${response.url()} answered ${response.status()}`).toBeTruthy();
  return jobsIn(await response.json(), response.url());
}

/** The jobs out of a listing answer, whichever of the two shapes it came in. */
function jobsIn(body: any, where: string): ListedJob[] {
  const data = Array.isArray(body?.data) ? body.data : body?.data?.data;
  expect(Array.isArray(data), `${where} should answer with a list of jobs`).toBeTruthy();

  return (data as ListedJob[]).map((job) => ({ ...job, title: String(job.title ?? '') }));
}
