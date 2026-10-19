import { type Page, type Locator, type Response, expect } from '@playwright/test';
import { escapeRegExp } from './react-aria.page';

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
  /** Private jobs carry their city as a plain name, and their skills as records. */
  location?: string | null;
  skills?: { name?: string | null }[] | null;
  /** Whether the student has this job bookmarked, and the slug the bookmark is saved under. */
  is_saved?: boolean | null;
  slug?: string | null;
};

/** The entries of the select above the listing, which narrows it to a kind of job. */
export type JobScope = 'All Jobs' | 'Applied' | 'Bookmarked' | 'Urgent' | 'Hiring';

const SCOPES: JobScope[] = ['All Jobs', 'Applied', 'Bookmarked', 'Urgent', 'Hiring'];

/** The filters the rail offers for the Private source. */
export type PrivateFilter = 'Location' | 'Job Type' | 'Skills';

/**
 * What each Private filter is: the control it uses and the field of a job it speaks about.
 *
 *   Location   a city select, 700-odd cities long, most of which no job is in. It is the only
 *              one that goes to the server: GET /api/jobs?...&location=<city>. Opening it is
 *              worth doing once and no more: a listbox of that size makes trace snapshots so
 *              large that closing the browser afterwards takes minutes.
 *   Job Type   checkboxes (Onsite, Hybrid, Remote, Contract, Freelance), done in the browser
 *   Skills     an autocomplete that collects skills as removable tags, done in the browser
 *
 * Being done in the browser means they only ever filter the jobs the page has already loaded,
 * which is why what they produce is checked against the jobs on screen rather than against a
 * response - see helpers/filter-private-jobs.ts.
 */
const PRIVATE_FILTERS: Record<PrivateFilter, { kind: 'select' | 'checkbox' | 'tags'; field: keyof ListedJob }> = {
  Location: { kind: 'select', field: 'location' },
  'Job Type': { kind: 'checkbox', field: 'job_type' },
  Skills: { kind: 'tags', field: 'skills' },
};

/** What a Private filter's values say about a job: its city, its type, or any of its skills. */
export function privateJobValues(name: PrivateFilter, job: ListedJob): string[] {
  if (name === 'Skills') return (job.skills ?? []).map((skill) => String(skill?.name ?? '').trim()).filter(Boolean);
  const value = job[PRIVATE_FILTERS[name].field];
  return value ? [String(value).trim()] : [];
}

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

  // ---- Filter rail, Private source ------------------------------------------------------------

  /** The rail beside the listing. Each source has its own; only the active one is on screen. */
  get filterRail(): Locator {
    return this.main.locator('aside').locator('visible=true').first();
  }

  /**
   * The header of a Private filter section.
   *
   * Unlike the Government rail's, these headers carry no `aria-expanded`, so whether a section
   * is open is told from whether its control is in the page - see openPrivateFilter().
   */
  privateSection(name: PrivateFilter): Locator {
    return this.filterRail.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}$`) }).first();
  }

  /** The control a Private filter is operated with: a select, a list of boxes, or an autocomplete. */
  privateControl(name: PrivateFilter): Locator {
    const panel = this.privateSection(name).locator('xpath=parent::*');
    switch (PRIVATE_FILTERS[name].kind) {
      case 'select':
        return panel.locator('button[aria-haspopup="listbox"]');
      case 'checkbox':
        return panel.locator('label');
      default:
        return panel.locator('input[role="combobox"]');
    }
  }

  /**
   * Opens a Private filter section unless its control is already showing.
   *
   * Choosing a value in a select closes the section again, so this is called before reading a
   * control as well as before using one.
   */
  async openPrivateFilter(name: PrivateFilter): Promise<Locator> {
    const section = this.privateSection(name);
    await expect(section, `the filter rail should offer "${name}"`).toBeVisible({ timeout: 30_000 });

    if ((await this.privateControl(name).count()) === 0) {
      await section.click();
    }
    await expect(this.privateControl(name).first(), `the "${name}" filter should be open`).toBeVisible({
      timeout: 30_000,
    });
    return section.locator('xpath=parent::*');
  }

  /** One entry of the Job Type boxes, found by its label. */
  private privateCheckbox(value: string): Locator {
    return this.privateControl('Job Type').filter({ hasText: new RegExp(`^${escapeRegExp(value)}$`) });
  }

  /** A skill that has been added, as the tag it becomes. */
  skillTag(value: string): Locator {
    return this.privateSection('Skills')
      .locator('xpath=parent::*')
      .locator('span')
      .filter({ has: this.page.locator('[slot="remove"]') })
      .filter({ hasText: new RegExp(`^${escapeRegExp(value)}$`) });
  }

  /**
   * Sets a Private filter to `value`.
   *
   * Nothing is awaited on the network here: only Location asks the server, and the page serves a
   * combination it has already loaded from cache, so the caller waits on the listing instead -
   * which is what has to change anyway.
   */
  async applyPrivateFilter(name: PrivateFilter, value: string) {
    await this.openPrivateFilter(name);

    if (PRIVATE_FILTERS[name].kind === 'checkbox') {
      const box = this.privateCheckbox(value);
      await expect(box, `the "${name}" filter should offer "${value}"`).toBeVisible({ timeout: 30_000 });
      await box.first().click();
    } else if (PRIVATE_FILTERS[name].kind === 'tags') {
      // The list only offers what is typed, so the skill is named first and then picked. The
      // autocomplete stays open afterwards, ready for another skill, so it is dismissed here -
      // left open it sits over the rest of the rail.
      const combo = this.privateControl(name).first();
      await combo.fill(value);
      await this.pickOption(value, name, { closes: false });
      await this.page.keyboard.press('Escape');
    } else {
      await this.privateControl(name).first().click();
      await this.pickOption(value, name);
    }

    await this.expectPrivateFilterSelected(name, value);
  }

  /** Picks `value` out of whichever listbox is open. A select closes on the choice; a tag list does not. */
  private async pickOption(value: string, name: string, { closes = true } = {}) {
    const listbox = this.page.getByRole('listbox');
    const option = listbox.getByRole('option', { name: value, exact: true }).first();
    await expect(option, `the "${name}" filter should offer "${value}"`).toBeVisible({ timeout: 30_000 });
    await option.click();

    if (closes) {
      await expect(listbox, `the "${name}" list should close once "${value}" is picked`).toHaveCount(0);
    }
  }

  /** The Job Type boxes on offer, read off their labels. */
  async privateCheckboxOptions(name: PrivateFilter): Promise<string[]> {
    await this.openPrivateFilter(name);
    const labels = this.privateControl(name);
    await expect(labels.first(), `the "${name}" filter should offer something to tick`).toBeVisible({
      timeout: 30_000,
    });
    return (await labels.allInnerTexts()).map(clean).filter(Boolean);
  }

  /** The Private filter is holding `value`. */
  async expectPrivateFilterSelected(name: PrivateFilter, value: string) {
    await this.openPrivateFilter(name);

    switch (PRIVATE_FILTERS[name].kind) {
      case 'select':
        await expect(
          this.privateControl(name).first(),
          `the "${name}" filter should now read "${value}"`,
        ).toHaveText(value);
        return;
      case 'checkbox':
        await expect(
          this.privateCheckbox(value).locator('input[type="checkbox"]').first(),
          `"${value}" should be ticked under "${name}"`,
        ).toBeChecked();
        return;
      default:
        await expect(this.skillTag(value).first(), `"${value}" should have been added to "${name}"`).toBeVisible();
    }
  }

  /** Nothing is chosen for this Private filter: no city, no box ticked, no skill added. */
  async expectPrivateFilterCleared(name: PrivateFilter) {
    await this.openPrivateFilter(name);
    const panel = this.privateSection(name).locator('xpath=parent::*');

    switch (PRIVATE_FILTERS[name].kind) {
      case 'select':
        // Empty, the select shows its placeholder again ("Select a city").
        await expect(
          this.privateControl(name).first(),
          `the "${name}" filter should be back to its placeholder`,
        ).toHaveText(/^Select a/i);
        return;
      case 'checkbox':
        await expect(
          panel.locator('input[type="checkbox"]:checked'),
          `nothing should be ticked under "${name}" any more`,
        ).toHaveCount(0);
        return;
      default:
        await expect(panel.locator('[slot="remove"]'), `no skill should be left under "${name}"`).toHaveCount(0);
    }
  }

  /**
   * The whole Private listing, asked for from the page itself: the jobs the rail filters over,
   * with the city, type and skills each one carries.
   */
  async allPrivateJobs(): Promise<ListedJob[]> {
    const path = '/api/jobs?scope=all&per_page=100';
    const answer = await this.page.evaluate(async (listing) => {
      const response = await fetch(listing, { headers: { accept: 'application/json' } });
      return { ok: response.ok, status: response.status, body: await response.text() };
    }, path);
    expect(answer.ok, `${path} answered ${answer.status}`).toBeTruthy();

    return jobsIn(JSON.parse(answer.body), path);
  }

  // ---- Search --------------------------------------------------------------------------------

  /** The free-text search above the listing: "Search by job title...". */
  get searchInput(): Locator {
    return this.main.locator('input[aria-label="Search"]').locator('visible=true');
  }

  /** "Showing N job(s) for", which the listing heads with once anything is being searched for. */
  get searchSummary(): Locator {
    return this.main.getByText(/Showing \d+ job/i).locator('visible=true');
  }

  /** "Title: <term>", the term the listing says it is showing results for. */
  searchTerm(term: string): Locator {
    return this.main.getByText(new RegExp(`Title:\\s*${escapeRegExp(term)}`, 'i')).locator('visible=true');
  }

  /**
   * Searches the listing by job title and returns the titles left on screen.
   *
   * The search is done in the browser over the jobs the page has already loaded - typing fires
   * no request - so there is nothing to await but the page's own account of what it is showing,
   * which is what is waited for before the cards are read. Nothing is typed character by
   * character either, so no debounce has to be guessed at.
   */
  async searchJobs(term: string): Promise<string[]> {
    await expect(this.searchInput, 'the listing should offer a search').toBeVisible({ timeout: 30_000 });
    await this.searchInput.fill(term);

    await expect(this.searchSummary, 'the listing should say how many jobs the search left').toBeVisible({
      timeout: 30_000,
    });
    await expect(this.searchTerm(term), `the listing should say it is showing results for "${term}"`).toBeVisible({
      timeout: 30_000,
    });
    return this.listedTitles();
  }

  /**
   * Empties the search box. The listing goes back to being unsearched, which the page stops
   * accounting for with a "Showing ... for" line, so that line going away is what is waited for.
   */
  async clearSearch() {
    await this.searchInput.fill('');
    await expect(this.searchInput, 'the search field should be empty').toHaveValue('');
    await expect(this.searchSummary, 'the listing should no longer be showing search results').toHaveCount(0, {
      timeout: 30_000,
    });
  }

  // ---- Scope, counts and bookmarks --------------------------------------------------------------

  /**
   * The select above the listing that narrows it to a kind of job: All Jobs, Applied,
   * Bookmarked, Urgent or Hiring. It is found by the value it is showing, because that is what
   * distinguishes it from the rail's own selects - its label is its current choice, so it stops
   * reading "All Jobs" the moment something else is picked.
   *
   * Narrowing is done in the browser, over the jobs the page has loaded: no request is made.
   */
  get scopeTrigger(): Locator {
    return this.main
      .getByRole('button', { name: new RegExp(`^(${SCOPES.join('|')})$`) })
      .locator('visible=true')
      .first();
  }

  async selectScope(scope: JobScope) {
    await expect(this.scopeTrigger, 'the listing should offer the job scope select').toBeVisible({ timeout: 30_000 });
    await this.scopeTrigger.click();

    const listbox = this.page.getByRole('listbox');
    const option = listbox.getByRole('option', { name: scope, exact: true });
    await expect(option, `the scope select should offer "${scope}"`).toBeVisible({ timeout: 30_000 });
    await option.click();
    await expect(listbox).toHaveCount(0);
    await this.expectScope(scope);
  }

  /** `scope` is what the select is showing. */
  async expectScope(scope: JobScope) {
    await expect(this.scopeTrigger, `the listing should be narrowed to "${scope}"`).toHaveText(scope, {
      timeout: 30_000,
    });
  }

  /**
   * The number on one of the tiles above the listing: "Total", "Applied" or "Bookmarked".
   *
   * The number is the tile label's next paragraph, which also keeps this off the scope select -
   * that shows the word "Bookmarked" too when it is the choice, but has no number beside it.
   */
  statValue(label: string): Locator {
    return this.main
      .locator('p')
      .filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) })
      .locator('xpath=following-sibling::p[1]');
  }

  /** What a tile currently reads, or NaN while it has nothing to read. */
  async statCount(label: string): Promise<number> {
    const shown = (await this.statValue(label).allInnerTexts()).join('').replace(/[^\d-]/g, '');
    return shown === '' ? Number.NaN : Number(shown);
  }

  /**
   * Waits for the "Bookmarked" tile to read `expected`.
   *
   * Polled rather than read: bookmarking makes the tile flash a half-counted value for a moment
   * before it settles, so a single read straight after the click sees the wrong number.
   */
  async expectBookmarkCount(expected: number, what: string) {
    await expect
      .poll(() => this.statCount('Bookmarked'), { message: what, timeout: 60_000 })
      .toBe(expected);
  }

  /** The card of a job: the nearest wrapper holding both its title and its bookmark toggle. */
  jobCard(title: string): Locator {
    return this.main
      .getByRole('heading', { level: 3, name: title, exact: true })
      .locator('xpath=ancestor::div[.//button[@aria-label="Bookmark" or @aria-label="Bookmarked"]][1]');
  }

  /** The bookmark toggle on a job's card. Its aria-label is its state: "Bookmark" or "Bookmarked". */
  bookmarkToggle(title: string): Locator {
    return this.jobCard(title)
      .locator('button[aria-label="Bookmark"], button[aria-label="Bookmarked"]')
      .first();
  }

  /** Every toggle on screen that is not bookmarked, and every one that is. */
  get unbookmarkedToggles(): Locator {
    return this.main.locator('button[aria-label="Bookmark"]').locator('visible=true');
  }

  get bookmarkedToggles(): Locator {
    return this.main.locator('button[aria-label="Bookmarked"]').locator('visible=true');
  }

  /** The title of the first card on screen that is not bookmarked yet. */
  async firstUnbookmarkedTitle(): Promise<string> {
    await expect(
      this.unbookmarkedToggles.first(),
      'the listing should show a job that is not bookmarked yet',
    ).toBeVisible({ timeout: 30_000 });

    const card = this.unbookmarkedToggles.first().locator('xpath=ancestor::div[.//h3][1]');
    return clean(await card.locator('h3').first().innerText());
  }

  /**
   * Bookmarks a job, or takes the bookmark off again - the control is one toggle.
   *
   * The call it makes carries the job's own slug (POST to save, DELETE to remove, both on
   * /api/jobs/<slug>/save), so the response awaited is the one for the job whose title was
   * asked for: a toggle that saved some other card could not pass. The icon is then checked to
   * have flipped, which is the state the student is left looking at.
   */
  async toggleBookmark(title: string): Promise<'Bookmark' | 'Bookmarked'> {
    const route = (await this.jobTitleLink(title).first().getAttribute('href')) ?? '';
    expect(route, `the card for "${title}" should link to the job`).not.toBe('');

    const toggle = this.bookmarkToggle(title);
    await expect(toggle, `"${title}" should offer a bookmark toggle`).toBeVisible({ timeout: 30_000 });

    const was = await toggle.getAttribute('aria-label');
    const becomes = was === 'Bookmarked' ? 'Bookmark' : 'Bookmarked';
    const saving = `/api/jobs/${route.replace(/^\/jobs\//, '')}/save`;

    const answered = this.page.waitForResponse((r) => r.url().includes(saving), { timeout: 60_000 });
    await toggle.click();
    const response = await answered;
    expect(
      response.ok(),
      `${response.request().method()} ${saving} answered ${response.status()} for "${title}"`,
    ).toBeTruthy();

    await expect(toggle, `the icon on "${title}" should now read "${becomes}"`).toHaveAttribute(
      'aria-label',
      becomes,
      { timeout: 30_000 },
    );
    return becomes;
  }

  // ---- The listing ---------------------------------------------------------------------------

  /** Titles of the job cards on screen (the hidden panel of the other source is left out). */
  get jobTitles(): Locator {
    return this.main.locator('h3').locator('visible=true');
  }

  /**
   * The portal's "no jobs" copy, for a filter or a search that matches nothing: "No results
   * found", with "We couldn't find any jobs matching your current filters" under it.
   *
   * Its heading is an `h3` like a job card's, so an empty listing reads as one "job" titled "No
   * results found" - which is why what the listing holds is always checked against the jobs the
   * portal returned rather than by counting cards alone.
   */
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

  /** The link a job's title is, found by the title it shows. */
  jobTitleLink(title: string): Locator {
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
    const link = this.jobTitleLink(title);
    await expect(link, `the listing should show a card for "${title}"`).toBeVisible({ timeout: 30_000 });

    const route = await link.getAttribute('href');
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
