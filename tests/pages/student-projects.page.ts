import { type Page, type Locator, expect } from '@playwright/test';
import { escapeRegExp } from './react-aria.page';

/** One project card as the listing shows it: its title and the skills it asks for. */
export type ListedProject = { title: string; skills: string[] };

/** One project as the portal records it - the fields the bidding test needs. */
export type ProjectRecord = {
  id: number;
  title: string;
  slug: string;
  status: string;
  budget_min: number | string | null;
  budget_max: number | string | null;
  deadline: string | null;
  created_at: string;
  /** Whether this student has bid on it already. */
  viewer_has_bid: boolean;
};

/**
 * The Student's project listing: /projects, reached from the sidebar's "Projects" group → "All".
 *
 * Not to be confused with the Jobs listing, which has the same shape (a filter rail beside a list
 * of cards): this one is headed "Find Projects That Match Your Skills", its breadcrumb ends in
 * "Projects", and every card offers "Apply for Project". Nor with MyProjectsPage, which is a
 * company's own projects under the same URL.
 *
 * Read off the staging portal on 2026-10-28:
 *
 *   rail "Filters"   "Reset"; a "Search" section ("Search projects..."); a "Skills" section whose
 *                    header is a collapsible button and whose options are plain checkboxes
 *   listing          "Showing all N projects", then one card per project, headed by an `h3`, with
 *                    the project's skills as buttons among the budget / bids / deadline buttons
 *   empty            "Showing all 0 projects" and an `h3` "No Project Found."
 *
 * Search and the Skills filter both narrow the list in the browser, over the projects the page has
 * already loaded - neither fires a request - so the page's own "Showing all N projects" line is
 * what every change is waited on, never a sleep.
 */
export class StudentProjectsPage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly breadcrumb: Locator;
  readonly filterRail: Locator;
  readonly resetButton: Locator;
  readonly searchInput: Locator;
  readonly skillsSection: Locator;
  readonly summary: Locator;
  readonly emptyState: Locator;

  constructor(private readonly page: Page) {
    this.main = page.locator('main').first();
    this.heading = this.main.getByRole('heading', { level: 1, name: 'Find Projects That Match Your Skills' });
    this.breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
    this.filterRail = this.main.getByRole('complementary').filter({ has: page.getByRole('heading', { name: 'Filters' }) });
    this.resetButton = this.filterRail.getByRole('button', { name: 'Reset', exact: true });
    this.searchInput = this.filterRail.getByRole('textbox', { name: /search projects/i });
    this.skillsSection = this.filterRail.getByRole('button', { name: 'Skills', exact: true });
    this.summary = this.main.getByText(/^Showing all \d+ projects?$/i);
    this.emptyState = this.main.getByRole('heading', { level: 3, name: /no project found/i });
  }

  // ---- Getting here --------------------------------------------------------------------------

  /** The sidebar - the complementary region that holds "Log Out", not the page's filter rail. */
  get sidebar(): Locator {
    return this.page.getByRole('complementary').filter({ has: this.page.getByRole('link', { name: 'Log Out', exact: true }) });
  }

  /** The sidebar's "Projects" group, which opens into "All" and "Applied". */
  get sidebarGroup(): Locator {
    return this.sidebar.getByRole('group').filter({ has: this.page.getByText('Projects', { exact: true }) });
  }

  /** "All" inside that group; it carries the project count, e.g. "All 15". */
  get sidebarAll(): Locator {
    return this.sidebarGroup.getByRole('link', { name: /^All\b/ });
  }

  /**
   * Sidebar "Projects" → its dropdown → "All", followed to the link's own href so no URL is assumed.
   * The group is only clicked open when "All" is not already showing, since a second click would
   * fold it shut again.
   */
  async openAllProjects() {
    await expect(this.sidebarGroup, 'the sidebar should offer "Projects"').toBeVisible({ timeout: 30_000 });
    if (!(await this.sidebarAll.isVisible())) {
      await this.sidebarGroup.getByText('Projects', { exact: true }).click();
    }
    await expect(this.sidebarAll, '"Projects" should open onto "All"').toBeVisible({ timeout: 30_000 });
    await expect(this.sidebarGroup.getByRole('link', { name: /^Applied\b/ }), '"Projects" should also offer "Applied"').toBeVisible();

    const href = (await this.sidebarAll.getAttribute('href')) ?? '';
    expect(href, '"All" should link somewhere').not.toBe('');
    await this.sidebarAll.click();
    await expect(this.page, '"All" should open the projects listing').toHaveURL(new RegExp(`${escapeRegExp(href)}/?$`), {
      timeout: 60_000,
    });
  }

  /** The Projects listing is up - and it is the projects one, not the jobs one. */
  async expectVisible(timeout = 60_000) {
    await expect(this.heading, 'the page should head with "Find Projects That Match Your Skills"').toBeVisible({ timeout });
    await expect(this.breadcrumb, 'the breadcrumb should end in "Projects"').toContainText(/Projects\s*$/);
    // The heading is up before the projects are: the rail and the listing wait behind a "Loading...",
    // which can take a while on staging, so they get the same allowance as the heading.
    await expect(this.filterRail, 'the page should carry its filter rail').toBeVisible({ timeout });
    await expect(this.searchInput, 'the rail should offer a project search').toBeVisible();
    await expect(this.skillsSection, 'the rail should offer a "Skills" filter').toBeVisible();
    await expect(this.summary, 'the listing should say how many projects it is showing').toBeVisible({ timeout });
  }

  // ---- The listing ---------------------------------------------------------------------------

  /**
   * The project cards: from each "Apply for Project", the nearest block that also holds a title.
   * The empty state's "No Project Found." is an `h3` like a title, which is why cards are found by
   * their "Apply for Project" rather than by headings alone.
   */
  get cards(): Locator {
    return this.main.getByRole('link', { name: 'Apply for Project' }).locator('xpath=ancestor::div[.//h3][1]');
  }

  /** How many projects the listing says it is showing. */
  async shownCount(): Promise<number> {
    const text = (await this.summary.innerText()).trim();
    return Number(text.match(/\d+/)![0]);
  }

  /** Waits for the listing to say it is showing `count` projects, and for that many cards. */
  async expectShownCount(count: number, what: string) {
    await expect(this.summary, `${what}: the listing should say it is showing ${count}`).toHaveText(
      new RegExp(`^Showing all ${count} projects?$`, 'i'),
      { timeout: 30_000 },
    );
    await expect(this.cards, `${what}: ${count} project cards should be on screen`).toHaveCount(count, { timeout: 30_000 });
  }

  /** The skills the rail offers, read off its checkboxes (the section is opened if needed). */
  async skillOptions(): Promise<string[]> {
    await this.openSkills();
    const labels = this.skillsPanel.locator('label').filter({ has: this.page.locator('input[type="checkbox"]') });
    return (await labels.allInnerTexts()).map(clean).filter(Boolean);
  }

  /**
   * Every card on screen with the skills it shows. A card's skills are the buttons whose text is
   * one of the rail's skills - the card's other buttons are its budget, bid count and deadline.
   */
  async listedProjects(knownSkills: readonly string[]): Promise<ListedProject[]> {
    const known = new Set(knownSkills);
    const projects: ListedProject[] = [];
    for (const card of await this.cards.all()) {
      const title = clean(await card.getByRole('heading', { level: 3 }).first().innerText());
      const buttons = (await card.getByRole('button').allInnerTexts()).map(clean);
      projects.push({ title, skills: buttons.filter((text) => known.has(text)) });
    }
    return projects;
  }

  /**
   * The projects the listing is built from, asked for from the page itself - the same call the
   * page makes - so whether the student has bid on each comes from the portal, not from the card.
   */
  async allProjects(): Promise<ProjectRecord[]> {
    const path = '/api/projects?scope=all';
    const answer = await this.page.evaluate(async (listing) => {
      const response = await fetch(listing, { headers: { accept: 'application/json' } });
      return { ok: response.ok, status: response.status, body: await response.text() };
    }, path);
    expect(answer.ok, `${path} answered ${answer.status}`).toBeTruthy();
    const body = JSON.parse(answer.body);
    return (body.data?.data ?? body.data ?? []) as ProjectRecord[];
  }

  /** A card's "Apply for Project", picked out by the project page it links to. */
  applyLink(slug: string): Locator {
    return this.main.getByRole('link', { name: 'Apply for Project' }).and(this.page.locator(`[href$="/${slug}"]`));
  }

  /** The titles of the cards on screen. */
  async listedTitles(): Promise<string[]> {
    const titles: string[] = [];
    for (const card of await this.cards.all()) {
      titles.push(clean(await card.getByRole('heading', { level: 3 }).first().innerText()));
    }
    return titles;
  }

  // ---- Search --------------------------------------------------------------------------------

  /**
   * Types `term` into "Search projects..." and returns the titles left once the listing has
   * settled: every card on screen answering to the term, and the summary agreeing with the cards.
   * The list narrows as the text goes in, so that settled state is polled for rather than slept on.
   */
  async search(term: string): Promise<string[]> {
    await this.searchInput.fill(term);
    await expect(this.searchInput).toHaveValue(term);

    const wanted = term.toLowerCase();
    await expect
      .poll(
        async () => {
          const titles = await this.listedTitles();
          const settled = titles.length > 0 && titles.every((title) => title.toLowerCase().includes(wanted));
          return settled && (await this.shownCount()) === titles.length;
        },
        { message: `searching for "${term}" should leave only projects that answer to it`, timeout: 30_000 },
      )
      .toBe(true);
    return this.listedTitles();
  }

  /** Empties the search box; the listing goes back to all `count` projects. */
  async clearSearch(count: number) {
    await this.searchInput.fill('');
    await expect(this.searchInput, 'the search box should be empty').toHaveValue('');
    await this.expectShownCount(count, 'with the search cleared');
  }

  // ---- Skills --------------------------------------------------------------------------------

  /** The block the "Skills" header opens: the header's parent, which also holds its checkboxes. */
  get skillsPanel(): Locator {
    return this.skillsSection.locator('xpath=parent::*');
  }

  /** One skill's checkbox, by its label. */
  skillCheckbox(skill: string): Locator {
    return this.skillsPanel.getByRole('checkbox', { name: skill, exact: true });
  }

  /** Opens the "Skills" section unless it is open already - clicking an open one would fold it. */
  async openSkills() {
    await expect(this.skillsSection, 'the rail should offer "Skills"').toBeVisible({ timeout: 30_000 });
    if ((await this.skillsSection.getAttribute('aria-expanded')) !== 'true') {
      await this.skillsSection.click();
    }
    await expect(this.skillsSection, 'the "Skills" filter should open').toHaveAttribute('aria-expanded', 'true');
    await expect(this.skillsPanel.getByRole('checkbox').first(), 'the "Skills" filter should list skills to pick').toBeVisible({
      timeout: 30_000,
    });
  }

  /** Ticks `skill`. Its label is clicked, since the box itself is the label's bare input. */
  async selectSkill(skill: string) {
    await this.openSkills();
    await this.skillsPanel.locator('label').filter({ hasText: new RegExp(`^${escapeRegExp(skill)}$`) }).first().click();
    await expect(this.skillCheckbox(skill), `"${skill}" should be ticked`).toBeChecked();
  }

  /** "Reset": nothing ticked under Skills, an empty search, and every project back. */
  async reset(count: number) {
    await this.resetButton.click();
    await this.openSkills();
    await expect(this.skillsPanel.getByRole('checkbox', { checked: true }), 'no skill should be ticked after "Reset"').toHaveCount(0);
    await expect(this.searchInput, 'the search should be empty after "Reset"').toHaveValue('');
    await this.expectShownCount(count, 'after "Reset"');
  }
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
