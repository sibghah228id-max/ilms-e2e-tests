import { type Page, type Locator, expect } from '@playwright/test';

/** CV template names offered on /cv (read from staging). */
export const CV_TEMPLATES = ['Classic Sidebar', 'Europass Style', 'Centered Classic'];

/**
 * Digital CV: /cv lists CV templates with a live preview, and "Open Full CV →" opens the chosen
 * template's full page (/cv/<template>) in the same tab, with download and colour controls.
 */
export class DigitalCvPage {
  /** Sidebar entry. */
  readonly sidebarLink: Locator;
  readonly templatesHeading: Locator;
  readonly previewHeading: Locator;
  readonly openFullCvLink: Locator;
  /** Controls on the full CV page. */
  readonly backToTemplatesLink: Locator;
  readonly downloadPdfButton: Locator;

  constructor(private readonly page: Page) {
    this.sidebarLink = page.getByRole('link', { name: 'Digital CV', exact: true });
    this.templatesHeading = page.getByRole('heading', { level: 1, name: 'Templates' });
    this.previewHeading = page.getByRole('heading', { level: 2, name: 'Preview' });
    this.openFullCvLink = page.getByRole('link', { name: /Open Full CV/ });
    this.backToTemplatesLink = page.getByText('Back to Templates');
    this.downloadPdfButton = page.getByText('Download as PDF');
  }

  /** Navigates through the side menu. */
  async open() {
    await this.sidebarLink.click();
    await this.expectVisible();
  }

  async expectVisible() {
    await expect(this.page).toHaveURL(/\/cv\/?$/, { timeout: 30_000 });
    await expect(this.templatesHeading).toBeVisible({ timeout: 30_000 });
  }

  /** Template choices, the preview pane and the "Open Full CV" control are all shown. */
  async expectCvOptions() {
    for (const template of CV_TEMPLATES) {
      await expect(this.page.getByText(template, { exact: true })).toBeVisible();
    }
    await expect(this.previewHeading).toBeVisible();
    await expect(this.openFullCvLink).toBeVisible();
  }

  /**
   * Opens the full CV. The control is a plain link that navigates within the same tab, so the
   * same page is returned for further assertions.
   */
  async openFullCv(): Promise<Page> {
    await this.openFullCvLink.click();
    await expect(this.page).toHaveURL(/\/cv\/[^/?#]+\/?$/, { timeout: 30_000 });
    await expect(this.backToTemplatesLink).toBeVisible({ timeout: 30_000 });
    await expect(this.downloadPdfButton).toBeVisible();
    return this.page;
  }
}
