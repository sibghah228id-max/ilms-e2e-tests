import path from 'path';
import { type Page, expect, test } from '@playwright/test';
import { registeredCompanyChatData } from '../data/international-company-data';
import { ConnectionsPage } from '../pages/connections.page';
import { MessagesPage } from '../pages/messages.page';

/**
 * Picks a person off the Connections page, opens the chat with them through their own "Message"
 * button, and sends three messages — text with an emoji, an image and a document — each with a
 * single click and each checked to have arrived before the next one goes out.
 *
 * The person's name is read off their card before anything is sent and the chat header is
 * checked against it, so a chat that opened with somebody else fails before the first message.
 *
 * NO VIDEO MESSAGE: the composer's file input offers `video/*`, but the API refuses anything
 * outside jpg, jpeg, png, gif, webp, pdf, doc, docx, xls and xlsx — a video comes back 422 and
 * the portal shows nothing at all, leaving the file sitting in the composer (staging,
 * 2026-10-09). Sending one here would only ever assert that bug.
 *
 * Each call sends real messages to a real person on the account.
 */
export async function sendChatMessages(page: Page, text: string): Promise<void> {
  const data = registeredCompanyChatData;
  const imagePath = path.resolve(__dirname, '../fixtures', data.image);
  const documentPath = path.resolve(__dirname, '../fixtures', data.document);

  // ---- Connections: people are listed, each with their own "Message".
  const connections = new ConnectionsPage(page);
  await connections.expectVisible();

  const listed = await connections.listedProfileNames();
  expect(listed.length, 'Connections should list someone to message').toBeGreaterThan(0);
  test.info().annotations.push({ type: 'connections-listed', description: listed.join(' | ') });

  // ---- The chat opens with the person whose card was used, and nobody else.
  const person = await connections.openMessage();
  test.info().annotations.push({ type: 'chat-with', description: person });

  const messages = new MessagesPage(page);
  await messages.expectVisible();
  await messages.expectConversationWith(person);

  // ---- 1. Text with an emoji.
  await messages.writeMessage(text);
  const textWithEmoji = await messages.addEmoji(data.emoji);
  expect(textWithEmoji, 'the message should carry the typed text').toContain(text);
  expect(textWithEmoji, 'the message should carry the emoji').toContain(data.emoji);

  await messages.sendOnce();
  await messages.expectDelivered(messages.textMessage(textWithEmoji), `the text message "${textWithEmoji}"`);

  // ---- 2. Image. Older runs leave their own copies in the thread, so what is checked is that
  // this send added one more, which also catches a message going out twice.
  const imagesBefore = await messages.imageMessages(data.image).count();
  const imageName = await messages.attach(imagePath);
  await messages.sendOnce();
  await expect(
    messages.imageMessages(imageName),
    `sending "${imageName}" should add one image to the conversation`,
  ).toHaveCount(imagesBefore + 1, { timeout: 60_000 });
  await messages.expectDelivered(messages.imageMessages(imageName).last(), `the image "${imageName}"`);

  // ---- 3. Document.
  const documentsBefore = await messages.documentMessages(data.document).count();
  const documentName = await messages.attach(documentPath);
  await messages.sendOnce();
  await expect(
    messages.documentMessages(documentName),
    `sending "${documentName}" should add one document to the conversation`,
  ).toHaveCount(documentsBefore + 1, { timeout: 60_000 });
  await messages.expectDelivered(messages.documentMessages(documentName).last(), `the document "${documentName}"`);

  // ---- Everything went to the one person the flow started with.
  await messages.expectConversationWith(person);
  test.info().annotations.push({
    type: 'chat-messages-sent',
    description: `${person}: text+emoji, ${imageName}, ${documentName}`,
  });
}
