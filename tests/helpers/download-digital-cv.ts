import { type Page, test } from '@playwright/test';
import { DigitalCvPage, TWO_COLUMN_TEMPLATE } from '../pages/digital-cv.page';

export type DigitalCvDownload = {
  template: string;
  /** Path of the template's full CV, as "Open Full CV" points at it (e.g. /cv/chikorita). */
  path: string;
  /** Name the portal gave the download (CV_<timestamp>.pdf — never a fixed name). */
  fileName: string;
  /** Where the run saved it, inside the test's own output folder. */
  savedTo: string;
  size: number;
};

/**
 * Digital CV, end to end: the templates page from the sidebar, one template chosen, its full CV
 * opened, the PDF downloaded and checked, and back to the templates.
 *
 * The download is a real browser download of a blob the page builds, so it is taken from
 * Playwright's download event; the file is saved into the test's output folder and attached to
 * the report, which also leaves it on disk for a human to open after a run.
 *
 * The portal shows no success message once a PDF is generated, so the saved file — a .pdf that
 * starts with the PDF signature and has content — is what "generated successfully" means here.
 */
export async function downloadDigitalCv(page: Page, template = TWO_COLUMN_TEMPLATE): Promise<DigitalCvDownload> {
  const cv = new DigitalCvPage(page);

  // ---- Templates page, opened from the sidebar.
  await cv.open();
  await cv.expectTemplatesListed(template);

  // ---- The chosen template. The preview stays on /cv; what changes is where "Open Full CV" goes.
  const path = await cv.selectTemplate(template);
  test.info().annotations.push({ type: 'cv-template', description: `${template} -> ${path}` });

  // ---- Its full CV, which must be the template that was picked.
  await cv.openFullCv(path);

  // ---- The PDF.
  const pdf = await cv.downloadPdf(test.info().outputPath('digital-cv.pdf'));
  await test.info().attach(`${template} CV`, { path: pdf.path, contentType: 'application/pdf' });
  test.info().annotations.push({ type: 'cv-pdf', description: `${pdf.fileName} (${pdf.size} bytes)` });

  // ---- Back to the templates, which are listed again.
  //
  // The page comes back with its default template selected rather than the one just downloaded
  // (verified on staging, 2026-10-16), so a caller that wants this template again has to pick it
  // again — which is what selectTemplate() above does.
  await cv.backToTemplates(template);

  return { template, path, fileName: pdf.fileName, savedTo: pdf.path, size: pdf.size };
}
