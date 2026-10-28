import { type Page, expect, test } from '@playwright/test';
import { registeredCompanyChatData } from '../data/international-company-data';
import { StudentProjectsPage } from '../pages/student-projects.page';
import { StudentProjectDetailsPage } from '../pages/student-project-details.page';
import { MessagesPage } from '../pages/messages.page';

export type ProjectMessageSummary =
  | {
      sent: true;
      project: string;
      owner: string;
      posted: string;
      conversationId: number;
      /** The message as sent - text and emoji. */
      message: string;
    }
  | { sent: false; reason: string };

/**
 * A message to the owner of a project the student has already bid on, from the Projects listing
 * through that project's own "Message" button - no bid is placed here.
 *
 *   listing  ->  "Apply for Project" on a project already bid on  ->  "Bid Already Placed"
 *   (disabled), "Message <owner>" and the posted date  ->  the conversation with that owner
 *   ->  a unique text with an emoji, sent once  ->  in the conversation exactly once, marked sent
 *
 * The project is the first card on screen whose project the portal says this student has bid on;
 * the owner's name is read off its page and the chat header is held to it. None bid on is reported
 * back for the caller to skip on. The message carries the project's title and a timestamp, so it
 * can only ever be this run's - which is what lets "exactly once" be checked against a thread that
 * earlier runs have written to.
 *
 * NOTE: each call sends one real message to the project's owner.
 */
export async function messageOwnerOfBidProject(page: Page): Promise<ProjectMessageSummary> {
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });
  const projects = new StudentProjectsPage(page);

  // ---- Projects → All, and a project this student has already bid on.
  await projects.openAllProjects();
  await projects.expectVisible();

  const records = await projects.allProjects();
  const bidOn = [];
  for (const record of records) {
    if (record.viewer_has_bid && (await projects.applyLink(record.slug).count())) bidOn.push(record);
  }
  annotate('projects-message-candidates', `${bidOn.length} of ${records.length} listed projects already bid on`);

  if (bidOn.length === 0) {
    const reason = `none of the ${records.length} listed projects has a bid from this student, so there is no project owner to message`;
    annotate('projects-message-skipped', reason);
    return { sent: false, reason };
  }

  const project = bidOn[0];
  const title = project.title.replace(/\s+/g, ' ').trim();
  annotate('projects-message-target', `"${title}" (${project.slug})`);

  // ---- Its page: the bid already placed, the owner reachable, and the posted date shown.
  await projects.applyLink(project.slug).first().click();
  const details = new StudentProjectDetailsPage(page);
  await details.expectVisible(project.slug, title);
  await details.expectBidPlaced();

  const posted = await details.postedDate();
  expect(posted, 'the posted date should read as a date').toMatch(/^[A-Z][a-z]{2} \d{2}, \d{4}$/);
  const owner = await details.ownerName();
  expect(owner, 'the project page should name its owner').not.toBe('');
  annotate('projects-message-owner', owner);

  // ---- "Message <owner>" → that owner's conversation, and nobody else's.
  const conversationId = await details.openMessage(owner);
  const messages = new MessagesPage(page);
  await messages.expectVisible();
  await messages.expectConversationWith(owner);

  // ---- A message only this run could have written: the project, the moment, and an emoji.
  const text = `Following up on my bid for "${title}" - ${new Date().toISOString()}`;
  await messages.writeMessage(text);
  const message = await messages.addEmoji(registeredCompanyChatData.emoji);
  expect(message, 'the message should carry the typed text').toContain(text);
  expect(message, 'the message should carry the emoji').toContain(registeredCompanyChatData.emoji);

  // ---- Sent once, then in the conversation once - and it is still the owner's conversation. The
  // page drops ?conversation_id= from its URL once it has loaded, so which conversation the message
  // went into is read off the send itself, the same request sendOnce() waits on.
  const sentTo = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/messages\/conversations\/\d+\/messages(\?|$)/.test(response.url()),
    { timeout: 90_000 },
  );
  await messages.sendOnce();
  const sentConversation = Number((await sentTo).url().match(/\/conversations\/(\d+)\/messages/)![1]);
  expect(sentConversation, 'the message should have gone into the conversation the project opened').toBe(conversationId);

  await messages.expectDelivered(messages.textMessage(message), `the message "${message}"`);
  await expect(messages.textMessage(message), 'the message should appear in the conversation exactly once').toHaveCount(1);
  await messages.expectConversationWith(owner);

  return { sent: true, project: title, owner, posted, conversationId, message };
}
