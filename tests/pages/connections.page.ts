import { type Locator, expect } from '@playwright/test';
import { ReactAriaPage } from './react-aria.page';

/**
 * Connections: /connections.
 *
 * The page is headed by its own tabs — My Followers (n), Requests (n), Following (n) — with a
 * grid / list switch beside them, and shows one card per person: their avatar and name both link
 * to the profile, and the card carries "Message" and "View Profile".
 *
 * "Recommended"-style panels sit elsewhere on the page and have no "Message" button, so
 * everything here is anchored on those buttons.
 */
export class ConnectionsPage extends ReactAriaPage {
  get followersTab(): Locator {
    return this.main.getByRole('button', { name: /^My Followers/ });
  }

  get followingTab(): Locator {
    return this.main.getByRole('button', { name: /^Following/ });
  }

  get messageButtons(): Locator {
    return this.main.getByRole('button', { name: 'Message', exact: true });
  }

  /** One card per listed person: the nearest block holding both a profile link and "Message". */
  get profileCards(): Locator {
    return this.messageButtons.locator('xpath=ancestor::div[.//a[starts-with(@href,"/profile/")]][1]');
  }

  /** The person's name as the card prints it (the avatar link carries no text of its own). */
  profileName(card: Locator): Locator {
    return card.getByRole('link').filter({ hasText: /\S/ }).first();
  }

  async expectVisible(timeout = 60_000) {
    await expect(this.page).toHaveURL(/\/connections\/?(\?.*)?$/, { timeout });
    await expect(this.followersTab).toBeVisible({ timeout });
    await expect(this.followingTab).toBeVisible();
  }

  /** The names of the people listed, in order; a page with nobody on it gets an empty array. */
  async listedProfileNames(): Promise<string[]> {
    await expect(this.messageButtons.first(), 'Connections should show at least one profile').toBeVisible({
      timeout: 60_000,
    });

    const cards = await this.profileCards.all();
    return Promise.all(cards.map(async (card) => (await this.profileName(card).innerText()).trim()));
  }

  /**
   * Opens the chat with a listed person through their own "Message" button, and returns the name
   * the card showed — which is what the chat header is then checked against.
   */
  async openMessage(index = 0): Promise<string> {
    const name = (await this.profileName(this.profileCards.nth(index)).innerText()).trim();
    expect(name, 'the chosen profile should have a name on its card').not.toBe('');

    await this.messageButtons.nth(index).click();
    await expect(this.page, '"Message" should open the messages page').toHaveURL(/\/messages/, { timeout: 60_000 });

    return name;
  }
}
