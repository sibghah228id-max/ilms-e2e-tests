import path from 'path';
import { type Locator, expect } from '@playwright/test';
import { ReactAriaPage } from './react-aria.page';
import { escapeForRegExp } from './post-composer.page';

/**
 * Messages: /messages.
 *
 * The page is a conversation list beside the open conversation. The conversation panel holds the
 * other person's name and profile link at the top, the messages, and the composer: a "Write a
 * message" box with Attach files, Insert emoji and Send message.
 *
 * Everything is looked up inside that panel, because the list beside it repeats each
 * conversation's last message — a message's own text would otherwise match twice.
 *
 * The emoji button opens a small palette of the portal's own, not the emoji-mart picker the post
 * composer uses: each emoji is a button named "Insert <emoji>".
 *
 * The composer's file input advertises `video/*`, but the API refuses anything outside jpg, jpeg,
 * png, gif, webp, pdf, doc, docx, xls and xlsx — a video comes back 422 with nothing shown on
 * screen, so only the types it really takes are sent from here (verified on staging 2026-10-09).
 */
export class MessagesPage extends ReactAriaPage {
  get messageBox(): Locator {
    return this.main.getByPlaceholder('Write a message');
  }

  /** The open conversation: the panel holding the composer, never the list beside it. */
  get thread(): Locator {
    return this.main.locator('section').filter({ has: this.page.getByPlaceholder('Write a message') });
  }

  /** The conversations listed down the side. */
  get conversationList(): Locator {
    return this.main.locator('aside');
  }

  get attachButton(): Locator {
    return this.thread.getByRole('button', { name: 'Attach files' });
  }

  get emojiButton(): Locator {
    return this.thread.getByRole('button', { name: 'Insert emoji' });
  }

  get sendButton(): Locator {
    return this.thread.getByRole('button', { name: 'Send message' });
  }

  get fileInput(): Locator {
    return this.thread.locator('input[type="file"]');
  }

  /** The composer row; attachment chips wait here, above the box, until the message is sent. */
  get composerArea(): Locator {
    return this.fileInput.locator('xpath=parent::div');
  }

  /** The other person's profile link at the top of the conversation. */
  profileLink(name: string): Locator {
    return this.thread.getByRole('link', { name: `View ${name}'s profile` });
  }

  /** The composer is rendered and empty, with Send held disabled until something is written. */
  async expectVisible(timeout = 60_000) {
    await expect(this.page).toHaveURL(/\/messages/, { timeout });
    await expect(this.messageBox).toBeVisible({ timeout });
    await expect(this.attachButton).toBeVisible();
    await expect(this.emojiButton).toBeVisible();
    await expect(this.sendButton, 'an empty composer should not be sendable').toBeDisabled();
  }

  /**
   * The conversation is the one that was opened: the header names that person and links to their
   * profile. A chat opened with somebody else fails here, before anything is sent.
   */
  async expectConversationWith(name: string) {
    await expect(
      this.profileLink(name),
      `the conversation should be open with "${name}", and the header should link to their profile`,
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      this.profileLink(name).getByText(name, { exact: true }),
      `the chat header should name "${name}"`,
    ).toBeVisible();
  }

  async writeMessage(text: string) {
    await this.messageBox.fill(text);
    await expect(this.messageBox).toHaveValue(text);
    await expect(this.sendButton, 'a written message should make Send live').toBeEnabled();
  }

  /**
   * Adds one emoji from the chat's own palette and returns the composer's new value — that full
   * string, emoji included, is the message that gets sent.
   */
  async addEmoji(char: string): Promise<string> {
    const before = await this.messageBox.inputValue();
    const option = this.thread.getByRole('button', { name: `Insert ${char}`, exact: true });

    await this.emojiButton.click();
    await expect(option, `the chat palette should offer ${char}`).toBeVisible({ timeout: 20_000 });
    await option.click();
    await expect(this.messageBox, `the composer should keep "${before}" and gain ${char}`).toHaveValue(
      new RegExp(`^${escapeForRegExp(before)}\\s*${escapeForRegExp(char)}$`),
    );

    // The palette stays open over the composer; closing it keeps Send clickable.
    if (await option.isVisible()) {
      await this.emojiButton.click();
    }
    await expect(option).toBeHidden({ timeout: 20_000 });

    return this.messageBox.inputValue();
  }

  /** Chip of a file waiting in the composer. */
  attachmentChip(fileName: string): Locator {
    return this.composerArea.getByText(fileName, { exact: true });
  }

  /**
   * Attaches a file through the hidden input — never a real file dialog — and waits for its chip.
   * Returns the file's own name, which is what the chip and the sent message show.
   */
  async attach(filePath: string): Promise<string> {
    const fileName = path.basename(filePath);
    await this.fileInput.setInputFiles(filePath);
    await expect(this.attachmentChip(fileName), `"${fileName}" should be waiting in the composer`).toBeVisible({
      timeout: 60_000,
    });
    await expect(this.sendButton, 'an attached file should make Send live').toBeEnabled();
    return fileName;
  }

  /**
   * Sends with a single click.
   *
   * The button is clicked exactly once and the POST is awaited, so callers continue from a
   * settled state and never need a second click. The portal clears the composer and disables
   * Send once the message is stored, which is the success state waited on here.
   */
  async sendOnce(): Promise<void> {
    const sent = this.page.waitForResponse(
      (response) =>
        /\/messages\/conversations\/\d+\/messages(\?|$)/.test(response.url()) &&
        response.request().method() === 'POST',
      { timeout: 90_000 },
    );

    await expect(this.sendButton).toBeEnabled();
    await this.sendButton.click();

    const response = await sent;
    expect(
      response.ok(),
      `sending the message responded ${response.status()}: ${(await response.text()).slice(0, 300)}`,
    ).toBeTruthy();

    await expect(this.messageBox, 'the composer should empty itself once the message is sent').toHaveValue('', {
      timeout: 60_000,
    });
    await expect(this.sendButton, 'Send should go back to disabled once the composer is empty').toBeDisabled();
  }

  /** A text message in the conversation. */
  textMessage(text: string): Locator {
    return this.thread.getByText(text, { exact: true });
  }

  /** An image message; the portal shows the picture under a "View <file>" button. */
  imageMessages(fileName: string): Locator {
    return this.thread.getByRole('button', { name: `View ${fileName}` });
  }

  /** A document message; the portal links it by its file name. */
  documentMessages(fileName: string): Locator {
    return this.thread.getByRole('link', { name: fileName, exact: true });
  }

  /**
   * The bubble a message sits in, found by the delivery mark every sent message carries. It is
   * what tells a message that reached the portal from one that is only on screen.
   */
  bubbleOf(content: Locator): Locator {
    return content.locator('xpath=ancestor::div[.//span[@aria-label="Sent"]][1]');
  }

  /** The message is in the conversation and the portal marks it as sent. */
  async expectDelivered(content: Locator, what: string) {
    await expect(content, `${what} should appear in the conversation`).toBeVisible({ timeout: 60_000 });
    await expect(
      this.bubbleOf(content).getByText('Sent', { exact: true }).first(),
      `${what} should be marked as sent`,
    ).toBeVisible({ timeout: 60_000 });
  }
}
