import { type Page, type Locator, type Response, expect } from '@playwright/test';
import { escapeRegExp } from './react-aria.page';

/** What a bid is filed with. */
export type BidDetails = {
  amount: number;
  days: number;
  proposal: string;
  /** Absolute path of the file attached to the bid. */
  attachment: string;
};

/**
 * One project's own page: /projects/<slug>, reached from a listing card's "Apply for Project".
 *
 * Read off the staging portal on 2026-10-28:
 *
 *   header      the title (`h1`), its status ("Open"), the owner, and "Posted: Oct 27, 2026"
 *   body        "About the Project", "Skills Required", "Attachments"
 *   rail        "Project Summary" (budget, deadline) and "Actions", which holds "Place Bid"
 *
 * "Place Bid" opens a "Place Bid" dialog: "Bid Amount" and "Estimated Days" (number inputs named
 * bid_amount / estimated_days), "Proposal" (a rich-text editor), "Attachments" (a plain file input
 * taking .pdf/.doc/.docx/.png/.jpg/.jpeg, which lists each chosen file with a "Remove <name>"
 * button and empties itself again), then "Cancel" and "Submit Bid". Once a bid is filed the
 * action reads "Bid Already Placed" and is disabled, and a "Message <owner>" button joins the header.
 */
export class StudentProjectDetailsPage {
  readonly main: Locator;
  readonly title: Locator;
  readonly breadcrumb: Locator;
  readonly posted: Locator;
  readonly actions: Locator;
  readonly placeBid: Locator;
  readonly bidPlaced: Locator;
  readonly message: Locator;
  readonly bidDialog: Locator;
  readonly bidAmount: Locator;
  readonly estimatedDays: Locator;
  readonly proposal: Locator;
  readonly attachments: Locator;
  readonly submitBid: Locator;

  constructor(private readonly page: Page) {
    this.main = page.locator('main').first();
    this.title = this.main.getByRole('heading', { level: 1 });
    this.breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
    this.posted = this.main.getByText(/^Posted:\s*/);
    this.actions = this.main.getByRole('complementary').filter({ has: page.getByRole('heading', { name: 'Actions' }) });
    this.placeBid = this.actions.getByRole('button', { name: /^place bid$/i });
    this.bidPlaced = this.actions.getByRole('button', { name: /bid already placed/i });
    this.message = this.main.getByRole('button', { name: /^Message\b/ });
    this.bidDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Place Bid' }) });
    this.bidAmount = this.bidDialog.locator('input[name="bid_amount"]');
    this.estimatedDays = this.bidDialog.locator('input[name="estimated_days"]');
    this.proposal = this.bidDialog.locator('[contenteditable="true"]');
    this.attachments = this.bidDialog.locator('input[type="file"]');
    this.submitBid = this.bidDialog.getByRole('button', { name: /^submit bid$/i });
  }

  /** The page for `slug` is open, headed by `title`, and it is a project page (breadcrumb "Projects"). */
  async expectVisible(slug: string, title: string, timeout = 60_000) {
    await expect(this.page, 'the card should have opened its own project').toHaveURL(new RegExp(`/projects/${escapeRegExp(slug)}/?$`), {
      timeout,
    });
    await expect(this.title, 'the project page should head with the project title').toHaveText(title, { timeout });
    await expect(this.breadcrumb.getByRole('link', { name: 'Projects' }), 'the breadcrumb should lead back to Projects').toBeVisible();
    await expect(this.actions, 'the project page should carry its "Actions"').toBeVisible({ timeout });
  }

  /** The project's owner, named on the line under the title. */
  get owner(): Locator {
    return this.title.locator('xpath=following::p[1]');
  }

  /** The owner's name as the header gives it. */
  async ownerName(): Promise<string> {
    await expect(this.owner, 'the project page should name its owner').toBeVisible({ timeout: 30_000 });
    return (await this.owner.innerText()).replace(/\s+/g, ' ').trim();
  }

  /**
   * "Message <owner>", through to the conversation it opens. The portal opens (or reuses) a direct
   * conversation with the owner first, and the id it answers with is returned, so the caller can
   * hold the Messages page to that conversation rather than to whichever happens to be showing.
   */
  async openMessage(owner: string): Promise<number> {
    const button = this.messageTo(owner);
    await expect(button, `the page should offer "Message ${owner}"`).toBeVisible({ timeout: 30_000 });

    const opened = this.page.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/messages\/conversations\/direct(\?|$)/.test(response.url()),
      { timeout: 60_000 },
    );
    await button.click();
    const response = await opened;
    expect(response.ok(), `opening the conversation answered ${response.status()}`).toBeTruthy();

    const body = await response.json();
    const id = Number(body?.data?.id ?? body?.data?.conversation?.id ?? body?.id);
    expect(id, `the conversation the portal opened should have an id (got ${JSON.stringify(body).slice(0, 200)})`).toBeGreaterThan(0);
    await expect(this.page, 'the Message button should open that conversation').toHaveURL(
      new RegExp(`/messages\\?(.*&)?conversation_id=${id}(&|$)`),
      { timeout: 60_000 },
    );
    return id;
  }

  /** The "Message" button for `owner`, named after them. */
  messageTo(owner: string): Locator {
    return this.main.getByRole('button', { name: `Message ${owner}`, exact: true });
  }

  /** The date the header gives after "Posted:", e.g. "Oct 27, 2026". */
  async postedDate(): Promise<string> {
    await expect(this.posted, 'the project page should say when it was posted').toBeVisible({ timeout: 30_000 });
    return (await this.posted.innerText()).replace(/^Posted:\s*/, '').trim();
  }

  /** "Place Bid", through to its form. */
  async openBidForm() {
    await expect(this.placeBid, 'a project open to bids should offer "Place Bid"').toBeEnabled({ timeout: 30_000 });
    await this.placeBid.click();
    await expect(this.bidDialog, '"Place Bid" should open the bid form').toBeVisible({ timeout: 30_000 });
    for (const [field, name] of [
      [this.bidAmount, 'Bid Amount'],
      [this.estimatedDays, 'Estimated Days'],
      [this.proposal, 'Proposal'],
      [this.attachments, 'Attachments'],
    ] as const) {
      await expect(field, `the bid form should ask for "${name}"`).toBeVisible();
    }
    await expect(this.submitBid, 'the bid form should offer "Submit Bid"').toBeVisible();
  }

  /** Fills every field of the open form, and checks each one holds what was put in. */
  async fillBid(bid: BidDetails) {
    await this.bidAmount.fill(String(bid.amount));
    await this.estimatedDays.fill(String(bid.days));
    await this.proposal.click();
    await this.proposal.fill(bid.proposal);
    await this.attachments.setInputFiles(bid.attachment);

    await expect(this.bidAmount, 'the bid amount should be filled').toHaveValue(String(bid.amount));
    await expect(this.estimatedDays, 'the estimated days should be filled').toHaveValue(String(bid.days));
    await expect(this.proposal, 'the proposal should hold the description').toHaveText(bid.proposal);
    // The form takes the file into its own list - each with a "Remove <name>" - and empties the
    // input again, so the list is what says the file was attached.
    const fileName = bid.attachment.split(/[\\/]/).pop()!;
    await expect(this.attachedFile(fileName), `"${fileName}" should be listed as attached`).toBeVisible({ timeout: 30_000 });
    await expect(this.bidDialog.getByRole('button', { name: /^Remove / }), 'only the one file should be attached').toHaveCount(1);
  }

  /** An attached file in the open form, by the "Remove <name>" it is listed with. */
  attachedFile(fileName: string): Locator {
    return this.bidDialog.getByRole('button', { name: `Remove ${fileName}`, exact: true });
  }

  /**
   * "Submit Bid", pressed exactly once, and the request it makes. The response is listened for
   * before the press, so it cannot be missed, and the form is waited out of the page afterwards.
   */
  async submit(): Promise<Response> {
    await expect(this.submitBid, '"Submit Bid" should be ready once the form is filled').toBeEnabled();
    const filed = this.page.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/api\/projects\/.*bid/i.test(response.url()),
      { timeout: 60_000 },
    );
    await this.submitBid.click();
    const response = await filed;
    expect(response.ok(), `the bid should be accepted - ${response.url()} answered ${response.status()}`).toBeTruthy();
    await expect(this.bidDialog, 'the bid form should close once the bid is filed').toHaveCount(0, { timeout: 30_000 });
    return response;
  }

  /** The page as a project the student has bid on: the action spent, and the owner reachable. */
  async expectBidPlaced() {
    await expect(this.bidPlaced, 'the action should now read "Bid Already Placed"').toBeVisible({ timeout: 30_000 });
    await expect(this.bidPlaced, '"Bid Already Placed" should be disabled').toBeDisabled();
    await expect(this.placeBid, '"Place Bid" should no longer be offered').toHaveCount(0);
    await expect(this.message.first(), 'a "Message" option should now be offered').toBeVisible({ timeout: 30_000 });
  }
}
