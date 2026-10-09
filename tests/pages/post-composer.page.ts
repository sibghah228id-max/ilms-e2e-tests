import path from 'path';
import { type Page, type Locator, expect } from '@playwright/test';

/** Which upload path a post uses; the composer holds one attachment at a time. */
export type PostAttachment = 'photo' | 'document';

/**
 * The post composer the portal reuses wherever something can be posted: the Social Wall and a
 * group's feed. Both render the same card — a prompt, a text box, Photo / Document / Emoji, and
 * Post — and both submit to the same endpoint; only the text box's placeholder names the group.
 *
 * The composer keeps ONE attachment: choosing a document drops a photo already attached and the
 * other way round, with nothing said on screen (verified on staging, 2026-10-09).
 *
 * Emoji opens emoji-mart's `<em-emoji-picker>`, whose contents live in a shadow root. Playwright
 * reaches into it, and each emoji is a button whose accessible name is the emoji itself.
 */
export class PostComposer {
  constructor(
    private readonly page: Page,
    private readonly root: Locator,
  ) {}

  /** The text box; its placeholder is "write something to post…", group name included or not. */
  get textBox(): Locator {
    return this.root.getByPlaceholder(/^write something to post/);
  }

  /**
   * The composer card: the prompt, the text box, any attachment preview and the action row.
   *
   * Everything to do with composing is looked up inside it rather than in the whole page, because
   * the feed below repeats the same text: an older post attaching the same file would otherwise
   * match the composer's own attachment chip.
   */
  get card(): Locator {
    return this.textBox.locator('xpath=ancestor::div[contains(@class,"p-4")][1]');
  }

  /** Prompt above the text box; it carries the signed-in account's first name. */
  get prompt(): Locator {
    return this.card.getByText(/^What's on your mind,/);
  }

  get photoButton(): Locator {
    return this.card.getByRole('button', { name: 'Photo', exact: true });
  }

  get documentButton(): Locator {
    return this.card.getByRole('button', { name: 'Document', exact: true });
  }

  get emojiButton(): Locator {
    return this.card.getByRole('button', { name: 'Emoji', exact: true });
  }

  get postButton(): Locator {
    return this.card.getByRole('button', { name: 'Post', exact: true });
  }

  /** Hidden input behind "Photo". */
  get photoInput(): Locator {
    return this.root.locator('input[type="file"][accept="image/*"]');
  }

  /** Hidden input behind "Document" (.pdf, .doc(x), .ppt(x), .xls(x), .txt, .csv). */
  get documentInput(): Locator {
    return this.root.locator('input[type="file"][accept*="pdf"]');
  }

  /** emoji-mart's picker, a web component the portal mounts outside the composer. */
  get emojiPicker(): Locator {
    return this.page.locator('em-emoji-picker');
  }

  /** The composer is rendered and empty, with Post held disabled until something is written. */
  async expectReady(timeout = 60_000) {
    await expect(this.textBox).toBeVisible({ timeout });
    await expect(this.prompt).toBeVisible({ timeout });
    await expect(this.photoButton).toBeVisible();
    await expect(this.documentButton).toBeVisible();
    await expect(this.emojiButton).toBeVisible();
    await expect(this.postButton, 'an empty composer should not be postable').toBeDisabled();
  }

  async writeText(text: string) {
    await this.textBox.fill(text);
    await expect(this.textBox).toHaveValue(text);
    await expect(this.postButton, 'written text should make the post button live').toBeEnabled();
  }

  /**
   * Adds one emoji through the picker: Emoji → search → the emoji's own button. The picker closes
   * itself and appends the character to whatever has been typed, so the text box's new value is
   * returned — that full string, emoji included, is the text the post is published with.
   */
  async addEmoji({ search, char }: { search: string; char: string }): Promise<string> {
    const before = await this.textBox.inputValue();

    await this.emojiButton.click();
    await expect(this.emojiPicker).toBeVisible({ timeout: 30_000 });

    // Searching by name is steadier than hunting the grid, which starts on "Frequently used".
    await this.emojiPicker.getByRole('searchbox').fill(search);
    const option = this.emojiPicker.getByRole('button', { name: char, exact: true }).first();
    await expect(option, `the picker should offer ${char} for "${search}"`).toBeVisible({ timeout: 20_000 });
    await option.click();

    await expect(this.emojiPicker, 'the picker should close once an emoji is picked').toBeHidden({ timeout: 20_000 });
    await expect(this.textBox, `the composer should keep "${before}" and gain ${char}`).toHaveValue(
      new RegExp(`^${escapeForRegExp(before)}\\s*${escapeForRegExp(char)}$`),
    );

    return this.textBox.inputValue();
  }

  /** Preview of the photo attached to the composer; it is shown under the file's own name. */
  photoPreview(fileName: string): Locator {
    return this.card.locator(`img[alt="${fileName}"]`);
  }

  /** Chip of the document attached to the composer; it names the file and its type. */
  documentChip(fileName: string): Locator {
    return this.card.getByText(fileName, { exact: true });
  }

  /** Preview of whichever attachment kind was used. */
  attachmentPreview(kind: PostAttachment, fileName: string): Locator {
    return kind === 'photo' ? this.photoPreview(fileName) : this.documentChip(fileName);
  }

  /**
   * Attaches a file through the hidden input behind Photo or Document — never a real file dialog —
   * and waits for its preview. Returns the file's own name, which is what the preview shows.
   */
  async attach(kind: PostAttachment, filePath: string): Promise<string> {
    const fileName = path.basename(filePath);
    const input = kind === 'photo' ? this.photoInput : this.documentInput;

    await input.setInputFiles(filePath);
    await expect(
      this.attachmentPreview(kind, fileName),
      `"${fileName}" should be attached to the composer`,
    ).toBeVisible({ timeout: 60_000 });

    return fileName;
  }

  /**
   * Publishes with a single click on "Post".
   *
   * The button is clicked exactly once and the POST is awaited, so callers continue from a settled
   * state and never need a second click. The portal disables the button while the request is in
   * flight and empties the composer once the post is stored; both are asserted here, which is the
   * success state the flow waits on instead of a navigation (there is none).
   */
  async publishOnce(): Promise<void> {
    const created = this.page.waitForResponse(
      (response) => /\/social-wall\/posts\b/.test(response.url()) && response.request().method() === 'POST',
      { timeout: 90_000 },
    );

    await expect(this.postButton).toBeEnabled();
    await this.postButton.click();

    const response = await created;
    expect(response.ok(), `publishing the post responded ${response.status()}`).toBeTruthy();

    await expect(this.textBox, 'the composer should empty itself once the post is stored').toHaveValue('', {
      timeout: 60_000,
    });
    await expect(this.postButton, 'Post should go back to disabled once the composer is empty').toBeDisabled();
  }
}

/**
 * A list of published posts: the Social Wall's two tabs and a group's feed all render the same
 * `#social-post-<id>` cards, so the same locators find and count them.
 */
export class PostFeed {
  constructor(
    private readonly page: Page,
    private readonly root: Locator,
  ) {}

  /** Every post card currently shown; each published post is one card. */
  get cards(): Locator {
    return this.root.locator('[id^="social-post-"]');
  }

  /**
   * Cards whose body is exactly `text`. A post is published once, so this is also the locator the
   * duplicate check counts: more than one match means publishing created duplicates.
   */
  cardsWithText(text: string): Locator {
    return this.cards.filter({ has: this.page.getByText(text, { exact: true }) });
  }

  /** Document attached to a post, linked from the card by its file name. */
  documentLink(text: string, fileName: string): Locator {
    return this.cardsWithText(text).getByRole('link', { name: new RegExp(escapeForRegExp(fileName)) });
  }

  /** Photo attached to a post, shown inside the card. */
  photo(text: string): Locator {
    return this.cardsWithText(text).locator('img[src*="/social/posts/"]');
  }

  /** The attachment a post of either kind carries. */
  attachment(kind: PostAttachment, text: string, fileName: string): Locator {
    return kind === 'photo' ? this.photo(text) : this.documentLink(text, fileName);
  }

  /**
   * The post is listed exactly once in `where`.
   *
   * The count is the point of this check: "Post" is clicked a single time, so a second card under
   * the same text means the portal stored the post twice, which is reported as duplicates rather
   * than as a locator problem.
   */
  async expectListedOnce(text: string, where: string) {
    await expect(this.cardsWithText(text).first(), `"${text}" should be listed in ${where}`).toBeVisible({
      timeout: 60_000,
    });

    const count = await this.cardsWithText(text).count();
    expect(
      count,
      `exactly one post should exist with the text "${text}", but ${where} shows ${count}; ` +
        'more than one means the publish created duplicates',
    ).toBe(1);
  }
}

/** Escapes a value so it can be dropped into a RegExp (emoji and punctuation included). */
export function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
