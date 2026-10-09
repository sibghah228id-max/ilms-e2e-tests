import { type Page, type Locator, type Response, expect } from '@playwright/test';
import { ReactAriaPage } from './react-aria.page';
import { PostComposer, PostFeed } from './post-composer.page';

/** Stats the group header counts off above its tabs. */
export const GROUP_STATS = ['Members', 'Discussions', 'Attachments', 'Pending requests'] as const;
export type GroupStat = (typeof GROUP_STATS)[number];

/** The header counts, as the group's own calls report them and as the header then shows them. */
export type GroupCounts = { members: number; discussions: number; attachments: number };

/**
 * "My Groups" list: /groups for a signed-in account.
 *
 * The page is headed by its own tabs — My Groups (n), Join Requests, Explore Groups, Create a
 * group — and lists one card per group the account belongs to, each headed by the group's name
 * and carrying an "Open Group" button. "Recommended Groups" sits beside the list and is NOT part
 * of it, so everything here is anchored on the "Open Group" buttons.
 */
export class MyGroupsPage extends ReactAriaPage {
  get myGroupsTab(): Locator {
    return this.main.getByRole('button', { name: /^My Groups/ });
  }

  get exploreGroupsTab(): Locator {
    return this.main.getByRole('button', { name: 'Explore Groups', exact: true });
  }

  get openGroupButtons(): Locator {
    return this.main.getByRole('button', { name: 'Open Group', exact: true });
  }

  /** One card per listed group: the nearest block that holds both the name and its button. */
  get groupCards(): Locator {
    return this.openGroupButtons.locator('xpath=ancestor::div[.//h3][1]');
  }

  /** Name of the group a card is for. */
  groupName(card: Locator): Locator {
    return card.locator('h3').first();
  }

  async expectVisible(timeout = 60_000) {
    await expect(this.page).toHaveURL(/\/groups\/?(\?.*)?$/, { timeout });
    await expect(this.myGroupsTab).toBeVisible({ timeout });
    await expect(this.exploreGroupsTab).toBeVisible();
  }

  /**
   * The names of the groups listed, in order. The list is what "My Groups" holds, so an account
   * in no group gets an empty array rather than a failure.
   */
  async listedGroupNames(): Promise<string[]> {
    await expect(this.openGroupButtons.first(), 'My Groups should list at least one group').toBeVisible({
      timeout: 60_000,
    });

    const cards = await this.groupCards.all();
    return Promise.all(cards.map(async (card) => (await this.groupName(card).innerText()).trim()));
  }

  /**
   * Opens a listed group through its own "Open Group" button and waits for the group page,
   * including both calls that fill the header counts — the strip renders zeros until they land,
   * so reading it any earlier gives a count that is not the group's.
   *
   * Returns the opened group's name and what those calls reported.
   */
  async openGroup(index = 0): Promise<{ name: string; loaded: GroupCounts }> {
    const card = this.groupCards.nth(index);
    const name = (await this.groupName(card).innerText()).trim();

    const counts = GroupPage.waitForCounts(this.page);
    await this.openGroupButtons.nth(index).click();
    await expect(this.page, 'opening a group should land on its own page').toHaveURL(/\/groups\/\d+/, {
      timeout: 60_000,
    });

    return { name, loaded: await counts };
  }
}

/**
 * One group's page: /groups/<id>.
 *
 * The header carries the group's name and a strip of counts — Members, Discussions, Attachments,
 * Pending requests — above the About / Feed / Members / Attachments tabs. Below that sit the
 * group's own post composer and feed, the same two the Social Wall uses.
 *
 * The strip renders zeros until the calls behind it land, so nothing here reads a count without
 * first waiting for the real numbers to be on screen (see waitForCounts and readCounts). Posting
 * moves Discussions on the spot, but Attachments only catches up on a fresh load of the page.
 */
export class GroupPage extends ReactAriaPage {
  readonly composer: PostComposer;
  readonly feed: PostFeed;

  constructor(page: Page) {
    super(page);
    this.composer = new PostComposer(page, this.main);
    this.feed = new PostFeed(page, this.main);
  }

  /**
   * Arms waits for BOTH calls behind the header strip and reports what they carry.
   *
   * The numbers come from different places: Members and Attachments from the group's details,
   * Discussions from the group's posts page (its `total`, so paging never cuts it short). The
   * details call lands first, so waiting on it alone leaves the strip still showing the zeros it
   * renders with — which is how a count of 0 gets read for a group that already has posts.
   *
   * Call this BEFORE the click or reload that loads the group, then await what it returns.
   */
  static waitForCounts(page: Page): Promise<GroupCounts> {
    const isGet = (response: Response, pattern: RegExp) =>
      pattern.test(response.url()) && response.request().method() === 'GET' && response.ok();

    const details = page.waitForResponse(
      (response) => isGet(response, /\/api\/ilms-social-network\/groups\/\d+(\?|$)/),
      { timeout: 60_000 },
    );
    const posts = page.waitForResponse(
      (response) => isGet(response, /\/api\/ilms-social-network\/groups\/\d+\/posts(\?|$)/),
      { timeout: 60_000 },
    );

    return Promise.all([details, posts]).then(async ([detailsResponse, postsResponse]) => {
      const group = (await detailsResponse.json())?.data;
      const feed = (await postsResponse.json())?.data;

      const counts = {
        members: group?.members_count,
        discussions: feed?.total,
        attachments: group?.attachments?.length,
      };
      expect(
        Object.values(counts).every((value) => Number.isInteger(value)),
        `the group should report whole numbers for its counts, but gave ${JSON.stringify(counts)}`,
      ).toBeTruthy();

      return counts as GroupCounts;
    });
  }

  heading(name: string): Locator {
    return this.main.getByRole('heading', { level: 1, name });
  }

  get feedTab(): Locator {
    return this.main.getByRole('button', { name: 'Feed', exact: true });
  }

  get attachmentsTab(): Locator {
    return this.main.getByRole('button', { name: 'Attachments', exact: true });
  }

  /**
   * The number shown for a stat. Each stat is a value and its label as two `<p>`s, the value
   * first; matching the label as a paragraph keeps the "Attachments" tab button out of it.
   */
  statValue(stat: GroupStat): Locator {
    return this.main
      .locator('p')
      .filter({ hasText: new RegExp(`^\\s*${stat}\\s*$`) })
      .locator('xpath=preceding-sibling::p[1]');
  }

  /** The group page is loaded: its name, the stats strip, the tabs and a ready composer. */
  async expectVisible(name: string, timeout = 60_000) {
    await expect(this.page).toHaveURL(/\/groups\/\d+/, { timeout });
    await expect(this.heading(name)).toBeVisible({ timeout });
    for (const stat of GROUP_STATS) {
      await expect(this.statValue(stat), `the header should count "${stat}"`).toBeVisible({ timeout });
    }
    await expect(this.feedTab).toBeVisible();
    await this.composer.expectReady(timeout);
  }

  /**
   * Reads one count off the header.
   *
   * Whatever the strip shows is what comes back: there is no fallback and no default, so a count
   * that cannot be read fails here — naming the stat and the text that was found — instead of
   * passing a 0 on to a comparison.
   */
  async statCount(stat: GroupStat): Promise<number> {
    const value = this.statValue(stat);
    await expect(value, `the group header should show a "${stat}" count`).toBeVisible();

    const shown = (await value.innerText()).trim();
    expect(
      shown,
      `the "${stat}" count should be a whole number, but the header shows "${shown}"; ` +
        'the count was not read, so nothing is assumed about it',
    ).toMatch(/^\d+$/);

    return Number(shown);
  }

  /**
   * The counts as the header shows them, read only once it has caught up with `loaded` — what the
   * group's own calls reported. That is what keeps the strip's starting zeros out of the reading:
   * the wait is for the real numbers to reach the screen, and what comes back is then read off
   * the header itself, so the comparison afterwards is against what a user would see.
   */
  async readCounts(loaded: GroupCounts): Promise<GroupCounts> {
    const settling: [GroupStat, number][] = [
      ['Members', loaded.members],
      ['Discussions', loaded.discussions],
      ['Attachments', loaded.attachments],
    ];
    for (const [stat, expected] of settling) {
      await expect(
        this.statValue(stat),
        `the header should settle on the ${expected} ${stat.toLowerCase()} the group reports`,
      ).toHaveText(new RegExp(`^\\s*${expected}\\s*$`), { timeout: 60_000 });
    }

    return {
      members: await this.statCount('Members'),
      discussions: await this.statCount('Discussions'),
      attachments: await this.statCount('Attachments'),
    };
  }

  /**
   * Reloads the group and reports what its calls carry. Attachments is only recounted on a fresh
   * load of the page, so the flow goes through here before reading the counts a second time.
   */
  async reload(): Promise<GroupCounts> {
    const counts = GroupPage.waitForCounts(this.page);
    await this.page.reload({ waitUntil: 'networkidle' });
    return counts;
  }
}
