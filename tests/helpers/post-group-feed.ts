import path from 'path';
import { type Page, expect, test } from '@playwright/test';
import { registeredCompanyGroupFeedData } from '../data/international-company-data';
import { MyGroupsPage, GroupPage } from '../pages/groups.page';
import type { PostAttachment } from '../pages/post-composer.page';

/**
 * Opens a group from the My Groups list and posts one feed in it — text, an emoji and, when asked
 * for, one attachment — then checks the feed is listed exactly once and that the header counts
 * moved by exactly one.
 *
 * Counts are the fiddly part: the header renders zeros until the group-details call lands, so
 * both reads go through the page object's waits (openGroup and reloadForCounts). Attachments is
 * only recounted on a fresh load of the group, which is why the "after" read reloads first.
 *
 * "Post" is clicked exactly once: publishOnce() waits for the POST itself and for the composer to
 * empty, so nothing here clicks again while the request is in flight. The count check afterwards
 * is what catches a feed being stored twice.
 *
 * Each call publishes a real post in a real group.
 */
export async function publishGroupFeed(
  page: Page,
  { text, attachment }: { text: string; attachment?: PostAttachment },
): Promise<void> {
  const data = registeredCompanyGroupFeedData;

  // ---- My Groups: the account's groups are listed, each with its own "Open Group".
  const myGroups = new MyGroupsPage(page);
  await myGroups.expectVisible();

  const listed = await myGroups.listedGroupNames();
  expect(listed.length, 'My Groups should list at least one group to post in').toBeGreaterThan(0);
  expect(new Set(listed).size, 'the groups listed should be distinct').toBe(listed.length);
  test.info().annotations.push({ type: 'groups-listed', description: listed.join(' | ') });

  // ---- Open the first one, then read the counts the group actually starts from.
  const { name: groupName, loaded } = await myGroups.openGroup();
  const group = new GroupPage(page);
  await group.expectVisible(groupName);

  // Whatever the header shows is the starting point; nothing here assumes it is 0, and a count
  // that cannot be read as a whole number fails in readCounts rather than defaulting.
  const before = await group.readCounts(loaded);
  test.info().annotations.push({
    type: 'group-counts-before',
    description: `${groupName}: discussions=${before.discussions} attachments=${before.attachments}`,
  });

  // ---- Compose: the text, then the emoji the picker appends to it.
  await group.composer.writeText(text);
  const feedText = await group.composer.addEmoji(data.emoji);
  expect(feedText, 'the composed text should carry the typed text').toContain(text);
  expect(feedText, 'the composed text should carry the emoji').toContain(data.emoji.char);

  // ---- Attachment, when this post is meant to have one.
  let fileName: string | undefined;
  if (attachment) {
    const filePath = path.resolve(__dirname, '../fixtures', attachment === 'photo' ? data.photo : data.document);
    fileName = await group.composer.attach(attachment, filePath);
    await expect(group.composer.attachmentPreview(attachment, fileName)).toBeVisible();
  }
  await expect(group.composer.textBox).toHaveValue(feedText);

  // ---- Publish, once.
  await group.composer.publishOnce();

  // ---- The feed is in the group, carries its attachment, and is there exactly once.
  await group.feed.expectListedOnce(feedText, `the ${groupName} feed`);
  if (attachment && fileName) {
    await expect(
      group.feed.attachment(attachment, feedText, fileName),
      `the published feed should carry the ${attachment} "${fileName}"`,
    ).toBeVisible();
  }

  // ---- Counts: Discussions always +1, Attachments +1 only when something was attached.
  // Attachments is recounted only on a fresh load of the group, so the second reading reloads
  // first; both numbers are then compared against the ones read before the post.
  const after = await group.readCounts(await group.reload());
  const expectedAttachments = attachment ? before.attachments + 1 : before.attachments;

  expect(
    after.discussions,
    `posting one feed should take Discussions from ${before.discussions} to ${before.discussions + 1}, ` +
      `but the header shows ${after.discussions}`,
  ).toBe(before.discussions + 1);
  expect(
    after.attachments,
    attachment
      ? `a feed with one ${attachment} should take Attachments from ${before.attachments} to ` +
        `${expectedAttachments}, but the header shows ${after.attachments}`
      : `a feed with no attachment should leave Attachments at ${before.attachments}, ` +
        `but the header shows ${after.attachments}`,
  ).toBe(expectedAttachments);

  test.info().annotations.push({
    type: 'group-counts-after',
    description: `${groupName}: discussions=${after.discussions} attachments=${after.attachments}`,
  });
  test.info().annotations.push({
    type: 'group-feed-published',
    description: `${feedText} in ${groupName} (1 match)`,
  });
}
