import { type Page, type Locator, expect } from '@playwright/test';

/**
 * "My Jobs" list: /jobs for a company account.
 *
 * The page has no level-1 heading; "All Jobs" heads the list and "Post New Job" is the action that
 * opens the job wizard (/jobs/new).
 */
export class MyJobsPage {
  readonly main: Locator;
  readonly allJobsHeading: Locator;
  readonly postNewJobLink: Locator;

  constructor(private readonly page: Page) {
    this.main = page.locator('main');
    this.allJobsHeading = this.main.getByRole('heading', { name: 'All Jobs' });
    this.postNewJobLink = this.main.getByRole('link', { name: 'Post New Job' });
  }

  async expectVisible(timeout = 60_000) {
    await expect(this.page).toHaveURL(/\/jobs\/?(\?.*)?$/, { timeout });
    await expect(this.allJobsHeading).toBeVisible({ timeout });
    await expect(this.postNewJobLink).toBeVisible();
  }

  /**
   * Opens the job wizard through the "Post New Job" action. Navigates to the link's own href, so
   * the route is taken from the page rather than assumed here.
   */
  async openPostNewJob() {
    const href = (await this.postNewJobLink.getAttribute('href')) ?? '';
    expect(href, '"Post New Job" should link somewhere').not.toBe('');
    await this.postNewJobLink.click();
    await expect(this.page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`), { timeout: 60_000 });
  }

  /** Free-text filter above the list. */
  get searchInput(): Locator {
    return this.main.getByPlaceholder('Search');
  }

  /** Each job is a card headed by its title. */
  jobCardTitle(title: string): Locator {
    return this.main.getByRole('heading', { level: 3, name: title, exact: true });
  }

  /**
   * Status badge of a job's card. The card's header row holds the title block and, next to it,
   * the status, so the badge is the element following the block the title sits in.
   */
  jobCardStatus(title: string): Locator {
    return this.jobCardTitle(title).locator('xpath=../following-sibling::*[1]');
  }

  /**
   * Finds a job by title through the list's search box. The list filters as the text is typed;
   * should a build want the search submitted instead, Enter is sent before giving up, so the job
   * is found either way and never missed because it sits further down a long list.
   */
  async findJob(title: string) {
    await expect(this.searchInput).toBeVisible({ timeout: 60_000 });
    await this.searchInput.fill(title);

    const card = this.jobCardTitle(title);
    const found = await card.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
    if (!found) {
      await this.searchInput.press('Enter');
      await expect(card, `"${title}" should be listed on the jobs page`).toBeVisible({ timeout: 60_000 });
    }
  }

  /** The job is listed and carries `status` (e.g. "Active"). */
  async expectJobListed(title: string, status: string) {
    await this.findJob(title);
    await expect(this.jobCardTitle(title)).toBeVisible();
    await expect(this.jobCardStatus(title), `"${title}" should be listed as ${status}`).toHaveText(status);
  }
}
