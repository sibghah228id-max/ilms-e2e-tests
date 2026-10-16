import fs from 'fs';
import { type Page, type Locator, expect } from '@playwright/test';

/**
 * CV template names checked on /cv. Staging lists twelve (Classic Sidebar, Europass Style,
 * Centered Classic, Two Column, Onyx, Ditto, Rhyhorn, Glalie, Azurill, Lapras, Leafish, Scizor as
 * of 2026-10-16); only the ones the specs depend on are listed here, so templates coming and
 * going does not fail an unrelated test.
 */
export const CV_TEMPLATES = ['Classic Sidebar', 'Europass Style', 'Centered Classic'];

/** The template the student Digital CV flow downloads. */
export const TWO_COLUMN_TEMPLATE = 'Two Column';

/**
 * Digital CV: /cv lists CV templates with a live preview, and "Open Full CV →" opens the chosen
 * template's full page (/cv/<slug>) in the same tab, with download and colour controls.
 *
 * Each template is a button holding its own preview and its name; picking one does not navigate,
 * it re-renders the preview and re-points "Open Full CV" at that template's slug. The slugs are
 * unrelated to the names (Two Column is /cv/chikorita), so a path is always read off the link
 * rather than built from a template name.
 */
export class DigitalCvPage {
  /** Sidebar entry. */
  readonly sidebarLink: Locator;
  readonly templatesHeading: Locator;
  readonly previewHeading: Locator;
  readonly openFullCvLink: Locator;
  /** Controls on the full CV page (both are buttons, despite the older name below). */
  readonly backToTemplatesLink: Locator;
  readonly downloadPdfButton: Locator;

  constructor(private readonly page: Page) {
    this.sidebarLink = page.getByRole('link', { name: 'Digital CV', exact: true });
    this.templatesHeading = page.getByRole('heading', { level: 1, name: 'Templates' });
    this.previewHeading = page.getByRole('heading', { level: 2, name: 'Preview' });
    this.openFullCvLink = page.getByRole('link', { name: /Open Full CV/ });
    this.backToTemplatesLink = page.getByRole('button', { name: 'Back to Templates' });
    this.downloadPdfButton = page.getByRole('button', { name: 'Download as PDF' });
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

  /** One card per template: a button carrying the preview and the template's name. */
  templateCard(name: string): Locator {
    return this.page
      .locator('main')
      .getByRole('button')
      .filter({ has: this.page.getByText(name, { exact: true }) });
  }

  /**
   * The templates are listed: the ones every CV test relies on, plus `also` (the one a caller is
   * about to pick). Used both before choosing a template and after coming back.
   */
  async expectTemplatesListed(...also: string[]) {
    for (const template of [...CV_TEMPLATES, ...also]) {
      await expect(this.templateCard(template), `the "${template}" template should be listed`).toBeVisible({
        timeout: 30_000,
      });
    }
    await expect(this.previewHeading).toBeVisible();
    await expect(this.openFullCvLink).toBeVisible();
  }

  /**
   * Chooses a template and returns the path "Open Full CV" now points at.
   *
   * The portal gives the choice no ARIA state of its own — the selected card is simply the
   * highlighted one (`shadow-xl`, while the others keep their hover-only border) — so the pick is
   * confirmed by that highlight and by the link, which is what actually decides which CV opens.
   */
  async selectTemplate(name: string): Promise<string> {
    const card = this.templateCard(name);
    await expect(card, `the templates page should offer the "${name}" template`).toBeVisible({ timeout: 30_000 });
    await card.click();

    await expect(card, `the "${name}" template should be the selected one`).toHaveClass(/shadow-xl/);

    const href = await this.openFullCvLink.getAttribute('href');
    expect(href, `"Open Full CV" should point at the "${name}" CV`).toMatch(/^\/cv\/[^/?#]+$/);
    return href!;
  }

  /**
   * Opens the full CV. The control is a plain link that navigates within the same tab, so the
   * same page is returned for further assertions. With `expectedPath` the CV that opens has to be
   * the one that was selected, rather than whichever template happened to be active.
   */
  async openFullCv(expectedPath?: string): Promise<Page> {
    await this.openFullCvLink.click();

    const url = expectedPath
      ? new RegExp(`${expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`)
      : /\/cv\/[^/?#]+\/?$/;
    await expect(this.page, 'the full CV of the selected template should open').toHaveURL(url, { timeout: 30_000 });

    await expect(this.backToTemplatesLink).toBeVisible({ timeout: 30_000 });
    await expect(this.downloadPdfButton).toBeVisible();
    return this.page;
  }

  /**
   * "Download as PDF" and the file it produces.
   *
   * The page builds the PDF in the browser and hands it over as a blob, so the download is taken
   * from Playwright's own download event — armed before the click — instead of by watching a
   * folder. The portal names the file itself (`CV_<timestamp>.pdf`), so no name is assumed here;
   * what is checked is that a .pdf arrived, that it was saved, and that it holds a real document
   * rather than an empty or truncated file.
   *
   * The portal shows no success message for a download, so the file is the only confirmation
   * there is (staging, 2026-10-16).
   */
  async downloadPdf(saveTo: string): Promise<{ fileName: string; path: string; size: number }> {
    const downloaded = this.page.waitForEvent('download', { timeout: 120_000 });
    await expect(this.downloadPdfButton).toBeEnabled();
    await this.downloadPdfButton.click();

    const download = await downloaded;
    const failure = await download.failure();
    expect(failure, `the PDF download did not finish: ${failure}`).toBeNull();

    const fileName = download.suggestedFilename();
    expect(fileName, 'the generated CV should be a .pdf').toMatch(/\.pdf$/i);

    await download.saveAs(saveTo);
    const { size } = await fs.promises.stat(saveTo);
    expect(size, `the generated PDF "${fileName}" should not be empty`).toBeGreaterThan(0);

    const signature = (await fs.promises.readFile(saveTo)).subarray(0, 5).toString('latin1');
    expect(signature, `"${fileName}" should be a real PDF`).toBe('%PDF-');

    return { fileName, path: saveTo, size };
  }

  /** "Back to Templates" leads back to /cv with the templates listed again. */
  async backToTemplates(...expected: string[]) {
    await this.backToTemplatesLink.click();
    await this.expectVisible();
    await this.expectTemplatesListed(...expected);
  }
}
