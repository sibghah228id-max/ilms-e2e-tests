import * as path from 'path';
import { type Page, expect, test } from '@playwright/test';
import { StudentProjectsPage, type ProjectRecord } from '../pages/student-projects.page';
import { StudentProjectDetailsPage, type BidDetails } from '../pages/student-project-details.page';

/** The file attached to the bid: the suite's existing sample document. */
const ATTACHMENT = path.resolve(__dirname, '../fixtures/sample-document.pdf');

const PROPOSAL =
  'I have hands-on experience delivering end-to-end test automation with Playwright and TypeScript. ' +
  'I will review the existing suite, port the remaining specs, add clear reporting, and keep the ' +
  'pipeline fast and stable, with progress shared at every milestone.';

export type ProjectBidSummary =
  | {
      placed: true;
      project: string;
      slug: string;
      bid: Omit<BidDetails, 'attachment'> & { attachment: string };
      posted: string;
      /** The request that filed the bid, as a path. */
      endpoint: string;
    }
  | { placed: false; reason: string };

/**
 * A bid on an open project the student has not bid on yet, from the Projects listing through to the
 * page showing it as placed - and still showing it so after a reload.
 *
 *   listing  ->  "Apply for Project"  ->  the project's page  ->  "Place Bid"  ->  the form filled
 *   (amount, days, proposal, attachment)  ->  "Submit Bid" once  ->  "Bid Already Placed" (disabled)
 *   and "Message"  ->  reloaded  ->  both still there
 *
 * Which project is never written down: it is the first card on screen whose project the portal
 * says is open and not yet bid on by this student - so a project already bid on, by this run or
 * any earlier one, is never bid on twice. None left is reported back for the caller to skip on.
 *
 * NOTE: a bid is not undoable from here. Each run files one, on a different project.
 */
export async function bidOnOpenProject(page: Page): Promise<ProjectBidSummary> {
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });
  const projects = new StudentProjectsPage(page);

  // ---- Projects → All, and the projects it is built from.
  await projects.openAllProjects();
  await projects.expectVisible();

  const records = await projects.allProjects();
  const eligible: ProjectRecord[] = [];
  for (const record of records) {
    if (record.status !== 'open' || record.viewer_has_bid) continue;
    if (await projects.applyLink(record.slug).count()) eligible.push(record);
  }
  annotate('projects-bid-eligible', `${eligible.length} of ${records.length} projects open to a bid from this student`);

  if (eligible.length === 0) {
    const bidOn = records.filter((record) => record.viewer_has_bid).length;
    const reason = `no project is open to a bid: ${records.length} listed, ${bidOn} already bid on by this student`;
    annotate('projects-bid-skipped', reason);
    return { placed: false, reason };
  }

  const project = eligible[0];
  const title = project.title.replace(/\s+/g, ' ').trim();
  annotate('projects-bid-target', `"${title}" (${project.slug})`);

  // ---- "Apply for Project" → the project's own page.
  await projects.applyLink(project.slug).first().click();
  const details = new StudentProjectDetailsPage(page);
  await details.expectVisible(project.slug, title);

  // The header's posted date is the project's creation date, as the browser formats it.
  const posted = await details.postedDate();
  const expectedPosted = await page.evaluate(
    (created) => new Date(created).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
    project.created_at,
  );
  expect(posted, 'the page should say the project was posted on the day it was created').toBe(expectedPosted);

  // ---- "Place Bid" → the form, filled with a bid inside the project's own budget and deadline.
  await details.openBidForm();
  const bid: BidDetails = { ...bidFor(project), proposal: PROPOSAL, attachment: ATTACHMENT };
  annotate('projects-bid-details', `amount ${bid.amount}, ${bid.days} days, ${path.basename(bid.attachment)}`);
  await details.fillBid(bid);

  // ---- "Submit Bid", once.
  const response = await details.submit();
  const endpoint = new URL(response.url()).pathname;
  annotate('projects-bid-endpoint', endpoint);

  // ---- The page now shows the bid as placed, on the same project, posted on the same day.
  await details.expectBidPlaced();
  await expect(details.title, 'the page should still be the project that was bid on').toHaveText(title);
  expect(await details.postedDate(), 'the posted date should not change with the bid').toBe(posted);

  // ---- The portal holds exactly one bid from this student on it.
  const after = (await projects.allProjects()).find((record) => record.id === project.id);
  expect(after?.viewer_has_bid, `the portal should now record a bid on "${title}" from this student`).toBe(true);

  // ---- Reloaded: still placed, still the same project.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await details.expectVisible(project.slug, title);
  await details.expectBidPlaced();

  return {
    placed: true,
    project: title,
    slug: project.slug,
    bid: { amount: bid.amount, days: bid.days, proposal: bid.proposal, attachment: path.basename(bid.attachment) },
    posted,
    endpoint,
  };
}

/**
 * An amount inside the project's budget (its midpoint, rounded) and a number of days that finishes
 * before its deadline (two weeks, or fewer when the deadline is closer).
 */
function bidFor(project: ProjectRecord): { amount: number; days: number } {
  const min = Number(project.budget_min) || 0;
  const max = Number(project.budget_max) || min;
  const amount = Math.max(1, Math.round((min + max) / 2));

  const untilDeadline = project.deadline
    ? Math.floor((new Date(project.deadline).getTime() - Date.now()) / 86_400_000)
    : Number.POSITIVE_INFINITY;
  const days = Math.max(1, Math.min(14, untilDeadline - 1));
  return { amount, days };
}
