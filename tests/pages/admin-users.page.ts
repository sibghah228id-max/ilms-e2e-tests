import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Master admin "Userbase → INDUS Users" list: /securecontroller/users?stakeholder_type_id=<n>.
 *
 * Server-rendered table, newest users first, with a search box, filters and a per-row "Actions"
 * menu. Users are located by their email inside the row so no other account is ever touched.
 */
export class AdminUsersPage {
  /** Sidebar group toggle; its submenu holds "INDUS Users". */
  readonly userbaseToggle: Locator;
  readonly indusUsersLink: Locator;
  readonly heading: Locator;
  /** Stakeholder tabs above the table ("IT Students", "IT Professionals", "IT Companies", ...). */
  readonly itStudentsTab: Locator;
  readonly itProfessionalsTab: Locator;
  readonly table: Locator;
  /** Search box above the table; matches name, email, phone, CNIC or "#id". */
  readonly searchBox: Locator;
  /** Modal opened by "Verify PakID" / "Change CNIC" in a row's action menu. */
  readonly cnicModal: Locator;
  readonly cnicInput: Locator;
  readonly cnicSaveButton: Locator;

  constructor(private readonly page: Page) {
    this.userbaseToggle = page.getByRole('button', { name: 'Userbase' });
    this.indusUsersLink = page.getByRole('link', { name: 'INDUS Users' });
    this.heading = page.getByRole('heading', { name: 'INDUS Users' });
    this.itStudentsTab = page.getByRole('link', { name: 'IT Students' });
    this.itProfessionalsTab = page.getByRole('link', { name: 'IT Professionals' });
    this.table = page.getByRole('table');
    this.searchBox = page.getByPlaceholder(/^Name, email, phone, CNIC/);
    this.cnicModal = page.locator('[role="dialog"][aria-labelledby="cnic-modal-title"]');
    this.cnicInput = this.cnicModal.locator('#cnic-modal-input');
    this.cnicSaveButton = this.cnicModal.getByRole('button', { name: 'Save', exact: true });
  }

  /** Expands the "Userbase" group in the sidebar (no-op when its submenu is already open). */
  async openUserbase() {
    if (!(await this.indusUsersLink.isVisible())) {
      await this.userbaseToggle.click();
    }
    await expect(this.indusUsersLink).toBeVisible();
  }

  /** Userbase → INDUS Users, then waits for the users list. */
  async openIndusUsers() {
    await this.openUserbase();
    await this.indusUsersLink.click();
    await expect(this.page).toHaveURL(/\/securecontroller\/users/);
    await expect(this.heading).toBeVisible();
  }

  /** Switches the list to IT Students (stakeholder_type_id=1) and waits for the table. */
  async selectItStudent() {
    await this.itStudentsTab.click();
    await expect(this.page).toHaveURL(/\/securecontroller\/users\?.*stakeholder_type_id=1/);
    await expect(this.table).toBeVisible();
    // The row menus are wired up by a script at the end of the page, so wait for it to load.
    await this.page.waitForLoadState('load');
  }

  /** Switches the list to IT Professionals (stakeholder_type_id=2) and waits for the table. */
  async selectItProfessional() {
    await this.itProfessionalsTab.click();
    await expect(this.page).toHaveURL(/\/securecontroller\/users\?.*stakeholder_type_id=2/);
    await expect(this.table).toBeVisible();
    await this.page.waitForLoadState('load');
  }

  /**
   * Filters the list with its search box (name, email, phone, CNIC or #id). The form is a plain
   * GET, so the page reloads with `search=` in the URL and the table shows the matches only.
   */
  async searchUser(query: string) {
    await this.searchBox.fill(query);
    await this.searchBox.press('Enter');
    await expect(this.page).toHaveURL(new RegExp(`[?&]search=${encodeURIComponent(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    await expect(this.table).toBeVisible();
    await this.page.waitForLoadState('load');
  }

  /** Table row of the user whose email is `email`. Rows show name, email, phone and CNIC. */
  userRow(email: string): Locator {
    return this.page.getByRole('row').filter({ hasText: email });
  }

  /** Opens the three-dot "Actions" menu of the given user's row only. */
  async openActionsForUser(email: string) {
    const row = this.userRow(email);
    await expect(row).toHaveCount(1);
    const toggle = row.getByRole('button', { name: 'Actions' });

    // The page closes every row menu on any scroll event (the menu is position:fixed), and the
    // wide table scrolls horizontally when the Actions column is brought into view. Scroll first
    // so the click itself causes no scroll, then retry the toggle until a menu entry is showing;
    // "View activities" is present for every user, unlike the verification entries.
    await toggle.scrollIntoViewIfNeeded();
    await expect(async () => {
      await toggle.click();
      await expect(row.getByRole('link', { name: 'View activities' })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000, intervals: [500, 1_000] });
  }

  /**
   * Actions → "Verify PakID" for the user, checks the modal shows their CNIC, then saves.
   * The panel reloads the list after the POST, so the returned promise resolves on the fresh page.
   */
  async verifyCnicForUser(email: string, cnic: string) {
    await this.openActionsForUser(email);
    await this.userRow(email).getByRole('button', { name: 'Verify PakID' }).click();

    await expect(this.cnicModal).toBeVisible();
    await expect(this.cnicModal.getByRole('heading', { name: `Verify PakID for ${email}` })).toBeVisible();
    // The modal is pre-filled with the CNIC the student registered with; it is kept as is.
    await expect(this.cnicInput).toHaveValue(cnic);

    await this.cnicSaveButton.click();
    await this.page.waitForLoadState('networkidle');
    await expect(this.cnicModal).toBeHidden();
  }

  /**
   * "PakID" pill in the "Verifications" column of the user's row. Its title reads
   * "PakID not verified" or "PakID (NADRA) verified on <date>". Scoped by column because a
   * verified user also gets a "PakID" pill in the "Sign-in" column.
   */
  async pakIdPill(email: string): Promise<Locator> {
    const headers = await this.page.getByRole('columnheader').allInnerTexts();
    const column = headers.findIndex((h) => /verifications/i.test(h));
    expect(column, `"Verifications" column in ${headers.join(' | ')}`).toBeGreaterThanOrEqual(0);

    return this.userRow(email).getByRole('cell').nth(column).getByText('PakID', { exact: true });
  }

  /** Flash message shown at the top of the list after "Verify PakID" is saved for `email`. */
  verificationFlash(email: string): Locator {
    return this.page.getByText(`PakID verified for ${email}`);
  }

  /** The "Verifications" cell of the user's row shows PakID as verified. */
  async expectPakIdVerified(email: string) {
    await expect(this.userRow(email)).toHaveCount(1);
    const pakId = await this.pakIdPill(email);
    await expect(pakId).toBeVisible();
    await expect(pakId).toHaveAttribute('title', /PakID \(NADRA\) verified/i);
  }
}
