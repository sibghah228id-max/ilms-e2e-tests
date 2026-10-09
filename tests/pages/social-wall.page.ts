import { type Page, type Locator, expect } from '@playwright/test';
import { ReactAriaPage } from './react-aria.page';
import { PostComposer, PostFeed } from './post-composer.page';

/**
 * Social Wall: /social-wall.
 *
 * The composer ("What's on your mind, …?") sits above the feed, which has two tabs: Public Feed,
 * other people's posts, and My Posts, where an account's own posts land. A post published here
 * does NOT appear on the Public Feed, so My Posts is where it is looked for again.
 *
 * Composing and the post cards are the portal's shared pieces, so they come from PostComposer and
 * PostFeed; a group's feed uses the same two (see GroupPage).
 */
export class SocialWallPage extends ReactAriaPage {
  readonly composer: PostComposer;
  readonly feed: PostFeed;

  constructor(page: Page) {
    super(page);
    this.composer = new PostComposer(page, this.main);
    this.feed = new PostFeed(page, this.main);
  }

  get publicFeedTab(): Locator {
    return this.main.getByRole('button', { name: 'Public Feed', exact: true });
  }

  get myPostsTab(): Locator {
    return this.main.getByRole('button', { name: 'My Posts', exact: true });
  }

  async expectVisible(timeout = 60_000) {
    await expect(this.page).toHaveURL(/\/social-wall\/?(\?.*)?$/, { timeout });
    await this.composer.expectReady(timeout);
    await expect(this.publicFeedTab).toBeVisible();
    await expect(this.myPostsTab).toBeVisible();
  }

  async openMyPosts() {
    await this.myPostsTab.click();
    await expect(this.feed.cards.first(), "My Posts should list this account's posts").toBeVisible({ timeout: 60_000 });
  }

  /**
   * Finds a just-published post under My Posts. Some builds only pick a new post up on a fresh
   * fetch of the feed, so the tab is reloaded once before the post is given up on.
   */
  async findMyPost(text: string) {
    await this.openMyPosts();

    const card = this.feed.cardsWithText(text).first();
    const found = await card.waitFor({ state: 'visible', timeout: 20_000 }).then(
      () => true,
      () => false,
    );
    if (!found) {
      await this.page.reload({ waitUntil: 'networkidle' });
      await this.openMyPosts();
      await expect(card, `"${text}" should be listed under My Posts`).toBeVisible({ timeout: 60_000 });
    }
  }

  /** The post is listed under My Posts, exactly once. */
  async expectPostedOnce(text: string) {
    await this.findMyPost(text);
    await this.feed.expectListedOnce(text, 'My Posts');
  }
}
