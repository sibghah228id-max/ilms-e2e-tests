import { type Page, type Locator, expect } from '@playwright/test';

/**
 * "My Projects" list: /projects for a company account.
 *
 * "All Projects" heads the list, which is filtered by the All / Open / Draft / Closed tabs and by
 * a free-text search box. Each project is a card headed by its title with its status beside it.
 * "Post New Project" opens the project wizard (/projects/new).
 */
export class MyProjectsPage {
  readonly main: Locator;
  readonly allProjectsHeading: Locator;
  readonly postNewProjectLink: Locator;

  constructor(private readonly page: Page) {
    this.main = page.locator('main');
    this.allProjectsHeading = this.main.getByRole('heading', { name: 'All Projects' });
    this.postNewProjectLink = this.main.getByRole('link', { name: 'Post New Project' });
  }

  async expectVisible(timeout = 60_000) {
    await expect(this.page).toHaveURL(/\/projects\/?(\?.*)?$/, { timeout });
    await expect(this.allProjectsHeading).toBeVisible({ timeout });
    await expect(this.postNewProjectLink).toBeVisible();
  }

  /** Opens the project wizard through "Post New Project", following the link's own href. */
  async openPostNewProject() {
    const href = (await this.postNewProjectLink.getAttribute('href')) ?? '';
    expect(href, '"Post New Project" should link somewhere').not.toBe('');
    await this.postNewProjectLink.click();
    await expect(this.page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`), { timeout: 60_000 });
  }

  /** Free-text filter above the list. */
  get searchInput(): Locator {
    return this.main.getByPlaceholder('Search');
  }

  /** Status tab, e.g. "All" or "Open (1)". */
  statusTab(name: string | RegExp): Locator {
    return this.main.getByRole('button', { name, exact: typeof name === 'string' });
  }

  /**
   * Every card headed by exactly `title`. A project is listed once, so this is also the locator
   * the duplicate check counts: more than one match means publishing created duplicates.
   */
  projectCardTitle(title: string): Locator {
    return this.main.getByRole('heading', { level: 3, name: title, exact: true });
  }

  /** Status badge of a project's card; it sits right after the title. */
  projectCardStatus(title: string): Locator {
    return this.projectCardTitle(title).locator('xpath=following-sibling::*[1]');
  }

  /**
   * Finds a project by title through the list's search box. The list filters as the text is typed;
   * should a build want the search submitted instead, Enter is sent before giving up, so the
   * project is found either way and never missed because it sits further down a long list.
   */
  async findProject(title: string) {
    await expect(this.searchInput).toBeVisible({ timeout: 60_000 });
    await this.searchInput.fill(title);

    const card = this.projectCardTitle(title);
    const found = await card.first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
    if (!found) {
      await this.searchInput.press('Enter');
      await expect(card.first(), `"${title}" should be listed on the projects page`).toBeVisible({ timeout: 60_000 });
    }
  }

  /** How many cards the list currently shows for exactly `title`. */
  async countProjects(title: string): Promise<number> {
    return this.projectCardTitle(title).count();
  }

  /**
   * The project is listed exactly once and carries `status`.
   *
   * The count is the point of this check: the portal neither disables its publish button nor
   * navigates away once the project has been created, so a second click would post the project
   * again. Finding two or more cards under one title is therefore reported as duplicates having
   * been created, not as a locator problem.
   */
  async expectProjectListedOnce(title: string, status: string) {
    await this.findProject(title);

    const count = await this.countProjects(title);
    expect(
      count,
      `exactly one project should exist with the title "${title}", but the list shows ${count}; ` +
        'more than one means the publish created duplicates',
    ).toBe(1);

    await expect(this.projectCardTitle(title)).toBeVisible();
    await expect(this.projectCardStatus(title), `"${title}" should be listed as ${status}`).toHaveText(
      new RegExp(`^\\s*${status}\\s*$`, 'i'),
    );
  }
}
