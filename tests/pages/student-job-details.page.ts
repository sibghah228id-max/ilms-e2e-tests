import { type Page, type Locator, expect } from '@playwright/test';
import { escapeRegExp } from './react-aria.page';
import { env } from '../data/environments';
import type { ListedJob } from './student-jobs.page';

/** The portal's own host, so a tab that opened somewhere else can be told apart from it. */
const PORTAL_HOST = new URL(env.portal.baseUrl).host;

/**
 * One job of the Government feed: /jobs/gov-<source id>?source=<feed>, reached from a card's
 * "View Details".
 *
 * The page nests a second <main> inside the layout's one, so `page.locator('main')` matches twice
 * here and everything below hangs off the outer one, which holds the breadcrumb as well.
 *
 * These jobs are not applied for on the portal: the action is "Apply on <FEED>", which opens the
 * job's own `apply_url` in a new tab and leaves this page as it was.
 */
export class StudentJobDetailsPage {
  /** The layout's <main>; the page's own <main> is nested inside it. */
  readonly root: Locator;
  readonly title: Locator;
  readonly breadcrumb: Locator;
  readonly summary: Locator;
  readonly applyButton: Locator;
  readonly externalNote: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('main').first();
    this.title = this.root.getByRole('heading', { level: 1 });
    this.breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
    this.summary = this.root.locator('aside');
    this.applyButton = this.root.getByRole('button', { name: /^Apply\b/i });
    this.externalNote = this.root.getByText(/official provider website/i);
  }

  /** The details page for `route` is open — the route the card linked to, query string and all. */
  async expectVisible(route: string, timeout = 60_000) {
    await expect(this.page, 'the card should have opened its own job').toHaveURL(
      new RegExp(`${escapeRegExp(route)}$`),
      { timeout },
    );
    await expect(this.title, 'the job details page should head with the job title').toBeVisible({ timeout });
  }

  /** One row of the "Job summary" panel, e.g. summaryValue('Job Type') → "Full Time". */
  summaryValue(label: string): Locator {
    return this.summary
      .locator('p')
      .filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) })
      .locator('xpath=following-sibling::p[1]');
  }

  /**
   * The page is showing the job that was picked from the listing, not merely some job: the title
   * it heads with, the organization under it and the job type in the summary are the ones the
   * listing returned for it.
   */
  async expectShowingJob(job: ListedJob) {
    await expect(this.title, 'the job details page should be the job that was opened').toHaveText(
      job.title.replace(/\s+/g, ' ').trim(),
      { timeout: 60_000 },
    );

    if (job.organization_name) {
      await expect(
        this.root.getByText(job.organization_name, { exact: false }).first(),
        'the job details page should name the organization the listing gave',
      ).toBeVisible();
    }
    if (job.job_type) {
      await expect(this.summaryValue('Job Type'), 'the summary should show the job type').toHaveText(job.job_type);
    }
  }

  /**
   * Applies through the external feed: the action opens a new tab, which is handed back still
   * open and untouched — the caller checks where it went and closes it.
   *
   * The tab starts blank and is given its address a moment later, so the URL is polled rather
   * than read straight off the event; nothing waits for the external site to finish loading,
   * which would mean sitting through its bot check.
   */
  async applyExternally(): Promise<Page> {
    await expect(this.applyButton, 'the job details page should offer to apply').toBeVisible({ timeout: 60_000 });
    await expect(this.externalNote, 'applying should be announced as continuing off the portal').toBeVisible();

    const opened = this.page.waitForEvent('popup', { timeout: 60_000 });
    await this.applyButton.click();
    const tab = await opened;

    await expect
      .poll(() => tab.url(), { message: 'the new tab should be given an address', timeout: 30_000 })
      .not.toMatch(/^about:blank$/);
    return tab;
  }

  /** The tab that opened is somewhere else entirely, and at the job's own apply address. */
  async expectExternalTab(tab: Page, applyUrl?: string | null) {
    const url = new URL(tab.url());
    expect(url.protocol, `the new tab should have opened a web address, not ${url.protocol}`).toMatch(/^https?:$/);
    expect(url.host, 'the new tab should have left the portal').not.toBe(PORTAL_HOST);

    // Not an assumed address: the feed gives each job its own apply_url, and that is the host the
    // tab has to be on. The path can carry more than the feed said (providers add their own
    // parameters, and a bot check rewrites the query), so only the host is held to.
    if (applyUrl) {
      expect(url.host, `the new tab should be the job's own apply address (${applyUrl})`).toBe(new URL(applyUrl).host);
    }
  }

  /** "Jobs" in the breadcrumb, which goes back to the listing. */
  async openJobsFromBreadcrumb() {
    await expect(this.breadcrumb, 'the job details page should carry a breadcrumb').toBeVisible({ timeout: 30_000 });
    const jobs = this.breadcrumb.getByRole('link', { name: 'Jobs', exact: true });
    await expect(jobs, 'the breadcrumb should offer "Jobs"').toBeVisible();
    await jobs.click();
  }
}
