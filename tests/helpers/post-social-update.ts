import path from 'path';
import { type Page, expect, test } from '@playwright/test';
import { registeredCompanySocialPostData } from '../data/international-company-data';
import { SocialWallPage } from '../pages/social-wall.page';
import type { PostAttachment } from '../pages/post-composer.page';

/**
 * Publishes one Social Wall post — text, an emoji and one attachment — starting and ending on
 * /social-wall, and checks the published post is listed exactly once under My Posts.
 *
 * ONE attachment per call on purpose: the portal's composer holds a single attachment, and
 * choosing a document silently drops a photo already attached (and the other way round), so a
 * post cannot carry both. The flow therefore publishes one post per upload path, which covers
 * Photo and Document without asserting behaviour the portal does not have.
 *
 * "Post" is clicked exactly once: publishOnce() waits for the POST itself and for the composer to
 * empty, so nothing here clicks again while the request is in flight. The count check afterwards
 * is what catches a post being stored twice.
 *
 * Each call publishes a real post on the account.
 */
export async function publishSocialPost(
  page: Page,
  { text, attachment }: { text: string; attachment: PostAttachment },
): Promise<void> {
  const data = registeredCompanySocialPostData;
  const filePath = path.resolve(__dirname, '../fixtures', attachment === 'photo' ? data.photo : data.document);

  const socialWall = new SocialWallPage(page);
  await socialWall.expectVisible();

  // ---- Compose: the text, then the emoji the picker appends to it.
  await socialWall.composer.writeText(text);
  const postText = await socialWall.composer.addEmoji(data.emoji);
  expect(postText, 'the composed text should carry the typed text').toContain(text);
  expect(postText, 'the composed text should carry the emoji').toContain(data.emoji.char);

  // ---- Attachment: through the hidden input behind Photo or Document, never a real file dialog.
  const fileName = await socialWall.composer.attach(attachment, filePath);

  // Everything the post is meant to carry is still in the composer right before it is published.
  await expect(socialWall.composer.textBox).toHaveValue(postText);
  await expect(socialWall.composer.attachmentPreview(attachment, fileName)).toBeVisible();

  // ---- Publish, once.
  await socialWall.composer.publishOnce();

  // ---- The post exists under My Posts, carries its attachment, and exists exactly once.
  await socialWall.expectPostedOnce(postText);
  await expect(
    socialWall.feed.attachment(attachment, postText, fileName),
    `the published post should carry the ${attachment} "${fileName}"`,
  ).toBeVisible();

  test.info().annotations.push({
    type: 'social-post-published',
    description: `${postText} — with ${attachment} ${fileName} (1 match)`,
  });
}
