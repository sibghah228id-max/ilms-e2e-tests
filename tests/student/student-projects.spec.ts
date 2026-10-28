import { test, expect } from '@playwright/test';
import credentials from '../data/student-login.json';
import { StudentLoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { StudentProjectsPage } from '../pages/student-projects.page';
import { bidOnOpenProject } from '../helpers/bid-on-student-project';
import { messageOwnerOfBidProject } from '../helpers/message-project-owner';

// Email, password and OTP come from tests/data/student-login.json only; change them there.
const { student: user } = credentials;

/**
 * Projects for an ALREADY REGISTERED Student: signing in, then the Projects listing from the
 * sidebar - "Projects", not "Jobs", whose listing looks much the same.
 *
 * Login is the shared one (StudentLoginPage.loginWithOtpIfShown, which enters the stored code only
 * when the portal asks for it), and the user guide is dealt with the way the other Student specs
 * do it. Nothing here is written down in advance: the project searched for and the skill filtered
 * on are both taken off the page, and what each step should leave is worked out from the cards the
 * listing was showing before it. The search-and-filter test changes nothing on the account; the
 * bidding test files one real bid per run (see bid-on-student-project.ts).
 */
test.describe('Student projects (registered account)', () => {
  test('opens Projects → All, searches a listed project and filters by a skill', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });

    // ---- Login → OTP if asked → dashboard → the user guide out of the way.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await dashboard.completeOnboarding();
    await expect(dashboard.preview.dialog, 'the user guide should not be covering the page').toHaveCount(0);

    // ---- Sidebar "Projects" → its dropdown → "All" → the listing.
    const projects = new StudentProjectsPage(page);
    await projects.openAllProjects();
    await projects.expectVisible();

    const total = await projects.shownCount();
    expect(total, 'the listing should be showing projects').toBeGreaterThan(0);
    await projects.expectShownCount(total, 'the full listing');
    await expect(projects.emptyState, 'a listing with projects should not show the empty state').toHaveCount(0);

    const skills = await projects.skillOptions();
    const listed = await projects.listedProjects(skills);
    const titles = listed.map((project) => project.title);
    annotate('projects-listed', `${total} projects; ${skills.length} skills on offer`);

    // ---- Search: a project on screen, by its title. One that no other title contains is preferred,
    // so the search can only leave that one.
    const unique = (title: string) => !titles.some((other) => other !== title && other.toLowerCase().includes(title.toLowerCase()));
    const chosen = titles.find(unique) ?? titles[0];
    annotate('projects-search-term', `"${chosen}"`);

    const results = await projects.search(chosen);
    await expect(projects.emptyState, `searching for "${chosen}" found nothing, though it was listed`).toHaveCount(0);
    expect(results, `searching for "${chosen}" should find it`).toContain(chosen);
    if (unique(chosen)) {
      expect(results, `"${chosen}" is unique in the listing, so the search should leave only it`).toEqual([chosen]);
    }
    annotate('projects-search', `"${chosen}": ${results.length} of ${total} left`);

    // ---- Clear: the whole listing again, as it was.
    await projects.clearSearch(total);
    expect(await projects.listedTitles(), 'clearing the search should bring the same projects back').toEqual(titles);

    // ---- Skills: preferably one that some listed projects ask for but not all, so the filter has to
    // narrow the list to be seen working; failing that, one any project asks for; and if no project
    // carries any skill on offer, the first skill is taken and the empty state expected.
    const askedBy = (name: string) => listed.filter((project) => project.skills.includes(name)).length;
    const skill =
      skills.find((name) => askedBy(name) > 0 && askedBy(name) < listed.length) ??
      skills.find((name) => askedBy(name) > 0) ??
      skills[0];
    expect(skill, 'the "Skills" filter should offer a skill to pick').toBeTruthy();
    const expected = listed.filter((project) => project.skills.includes(skill)).map((project) => project.title);
    annotate('projects-skill', `"${skill}": ${expected.length} of ${total} projects ask for it`);

    await projects.selectSkill(skill);

    if (expected.length === 0) {
      // Nothing asks for it: the listing says so.
      await projects.expectShownCount(0, `filtering on "${skill}"`);
      await expect(projects.emptyState, `filtering on "${skill}" should show "No Project Found."`).toBeVisible();
    } else {
      await projects.expectShownCount(expected.length, `filtering on "${skill}"`);
      const filtered = await projects.listedProjects(skills);
      expect(filtered.map((project) => project.title), `filtering on "${skill}" should leave the projects that ask for it`).toEqual(expected);
      for (const project of filtered) {
        expect(project.skills, `"${project.title}" was left by the "${skill}" filter, so it should ask for it`).toContain(skill);
      }
    }

    // ---- Reset: no skill ticked, and the whole listing back.
    await projects.reset(total);
    expect(await projects.listedTitles(), '"Reset" should bring the same projects back').toEqual(titles);
  });

  /**
   * A bid on a listed project: "Apply for Project", "Place Bid", the form (amount, days, proposal,
   * attachment), "Submit Bid" once, and the page showing "Bid Already Placed" and "Message" - before
   * and after a reload.
   *
   * The project is the first one the portal says is open and not yet bid on by this student, so no
   * project is ever bid on twice; with none left the test is skipped with the reason, not failed.
   * NOTE: unlike the test above, this one changes the account - every run files one real bid.
   */
  test('places a bid on an open project and keeps it shown after a reload', async ({ page }) => {
    test.setTimeout(5 * 60_000);

    // ---- Login → OTP if asked → dashboard → the user guide out of the way.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await dashboard.completeOnboarding();
    await expect(dashboard.preview.dialog, 'the user guide should not be covering the page').toHaveCount(0);

    // ---- Projects → All → a project open to a bid → its page → the bid, and what it leaves.
    const bid = await bidOnOpenProject(page);
    test.info().annotations.push({ type: 'projects-bid', description: JSON.stringify(bid) });

    test.skip(!bid.placed, bid.placed ? '' : bid.reason);
  });

  /**
   * A message to the owner of a project the student has ALREADY bid on - independent of the
   * bidding test above, and placing no bid of its own: "Apply for Project" on that project, "Bid
   * Already Placed", the owner's "Message", and a unique text with an emoji sent once into the
   * conversation with that owner.
   *
   * With no project bid on yet, the test is skipped with the reason, not failed.
   * NOTE: every run sends one real message to the project's owner.
   */
  test('messages the owner of a project already bid on', async ({ page }) => {
    test.setTimeout(5 * 60_000);

    // ---- Login → OTP if asked → dashboard → the user guide out of the way.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await dashboard.completeOnboarding();
    await expect(dashboard.preview.dialog, 'the user guide should not be covering the page').toHaveCount(0);

    // ---- Projects → All → a project already bid on → its owner's conversation → the message.
    const sent = await messageOwnerOfBidProject(page);
    test.info().annotations.push({ type: 'projects-message', description: JSON.stringify(sent) });

    test.skip(!sent.sent, sent.sent ? '' : sent.reason);
  });
});
