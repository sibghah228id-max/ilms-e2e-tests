import { test, expect } from '@playwright/test';
import { RoleSelectionPage, ROLES, expectLoginPageRendered } from '../pages/create-account.page';
import { ROLE_CONTENT, ACADEMIA_CONTACT_TEXT } from '../data/role-content';
import { env, portalLoginUrl, websiteUrl, websiteHost } from '../data/environments';

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Contact Us on the INDUS website of the environment under test, with or without "www.".
const contactUsPath = new RegExp(`(www\\.)?${escapeRegExp(websiteHost)}/contact-us/?$`);
const contactUsAbsolute = new RegExp(`^https://(www\\.)?${escapeRegExp(websiteHost)}/contact-us/?$`);

test.describe('Login → Sign Up', () => {
  test('clicking Sign Up on the login page opens /create-account', async ({ page }) => {
    await page.goto(env.portal.loginPath, { waitUntil: 'networkidle' });

    await page.getByRole('link', { name: 'Sign Up', exact: true }).click();

    await expect(page).toHaveURL(/\/create-account\/?$/);
  });
});

test.describe('Create account — header', () => {
  let rolePage: RoleSelectionPage;

  test.beforeEach(async ({ page }) => {
    rolePage = new RoleSelectionPage(page);
    await rolePage.goto();
  });

  test('INDUS Tech Connect logo is shown and links to the INDUS website', async () => {
    await expect(rolePage.logoLink).toBeVisible();

    // Resolved href — a missing "https://" would make it a relative path on the portal.
    const href = await rolePage.logoLink.evaluate((a: HTMLAnchorElement) => a.href);
    expect(href).toBe(`${websiteUrl}/`);
  });

  test('clicking the INDUS Tech Connect logo opens the INDUS website in a new tab', async ({ page }) => {
    // The logo is a plain external link (target="_blank", rel="noopener noreferrer") since
    // 2026-10; it used to be a Next.js <Link> that routed to the portal root and on to /login.
    await expect(rolePage.logoLink).toHaveAttribute('target', '_blank');
    const popupPromise = page.waitForEvent('popup');
    await rolePage.logoLink.click();

    const popup = await popupPromise;
    await expect(popup).toHaveURL(new RegExp(`^${escapeRegExp(websiteUrl)}/?`), { timeout: 30_000 });
    await popup.close();
    // The create-account page itself stays put.
    await expect(page).toHaveURL(/\/create-account\/?$/);
  });

  test('home icon is shown and links to the portal login page', async ({ page }) => {
    await expect(rolePage.homeLink).toBeVisible();

    await rolePage.homeLink.click();

    // Home icon lands on the login page of the environment under test (see tests/data/environments.json).
    await expectLoginPageRendered(page, portalLoginUrl);
  });
});

test.describe('Create account — role content', () => {
  let rolePage: RoleSelectionPage;

  test.beforeEach(async ({ page }) => {
    rolePage = new RoleSelectionPage(page);
    await rolePage.goto();
  });

  test('all 5 role boxes are shown', async () => {
    for (const role of ROLES) {
      await expect(rolePage.roleCard(role)).toBeVisible();
    }
  });

  for (const role of ROLES) {
    const { notice, benefits } = ROLE_CONTENT[role];

    test(`${role}: shows the correct notice and checklist`, async () => {
      await rolePage.roleCard(role).click();

      if (notice === null) {
        await expect(rolePage.noticeBox).toHaveCount(0);
      } else {
        await expect(rolePage.noticeBox).toBeVisible();
        expect(normalize(await rolePage.noticeBox.innerText())).toBe(normalize(notice));
      }

      // Exact list, in order — also catches missing, extra or duplicated items.
      await expect.poll(() => rolePage.benefits()).toEqual(benefits);
    });
  }

  test('each role shows different content (no two roles duplicated)', async () => {
    const seen = new Map<string, string>();

    for (const role of ROLES) {
      await rolePage.roleCard(role).click();
      await expect.poll(() => rolePage.benefits()).toEqual(ROLE_CONTENT[role].benefits);

      const notice = (await rolePage.noticeBox.count()) ? normalize(await rolePage.noticeBox.innerText()) : '';
      const signature = notice + '|' + (await rolePage.benefits()).join('|');

      expect(seen.get(signature), `${role} shows the same content as ${seen.get(signature)}`).toBeUndefined();
      seen.set(signature, role);
    }
  });

  test('Academia shows the contact-support box with a Contact Us button', async () => {
    await rolePage.roleCard('Academia').click();

    await expect(rolePage.contactBox).toBeVisible();
    expect(normalize(await rolePage.contactBox.innerText())).toBe(normalize(`${ACADEMIA_CONTACT_TEXT} Contact Us`));
    await expect(rolePage.contactUsLink).toBeVisible();
    await expect(rolePage.createAccountButton).toHaveCount(0);
  });

  test('Academia Contact Us points at the INDUS contact page', async () => {
    await rolePage.roleCard('Academia').click();

    // Raw attribute — checks the intended destination regardless of the scheme bug below.
    await expect(rolePage.contactUsLink).toHaveAttribute('href', contactUsPath);
  });

  test('Academia Contact Us resolves to an absolute INDUS URL', async () => {
    // If the href lacks "https://" (e.g. "industechconnect.pk/contact-us/"), the browser resolves
    // it as a path on the portal and the link 404s, so the resolved URL must be absolute.
    await rolePage.roleCard('Academia').click();

    const href = await rolePage.contactUsLink.evaluate((a: HTMLAnchorElement) => a.href);
    expect(href).toMatch(contactUsAbsolute);
  });
});
