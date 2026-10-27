import { test, expect } from '@playwright/test';
import path from 'path';
import credentials from '../data/it-company-login.json';
import { itCompanyProfileData } from '../data/it-company-data';
import { StudentLoginPage } from '../pages/login.page';
import { OtpPage } from '../pages/otp.page';
import { DashboardPage } from '../pages/dashboard.page';
import { ItCompanyProfilePage, IT_COMPANY_PROFILE_STEP_HEADINGS } from '../pages/it-company-profile.page';
import { MyJobsPage } from '../pages/jobs.page';
import { openYopmailInbox, readNewOtp, otpFromEnv } from '../helpers/yopmail-otp';

/** Company logo uploaded only when the profile header still shows the placeholder. */
const profileImagePath = path.resolve(__dirname, '../fixtures/profile-image.png');

// Email and password come from tests/data/it-company-login.json only; change them there. The OTP is
// never stored anywhere: it is read from the account's yopmail inbox during the run.
const { itCompany: user } = credentials;

/**
 * Login pass over an ALREADY REGISTERED IT Company account, with the OTP fetched from the
 * account's own yopmail inbox in a second tab: the stored email and password, the OTP screen the
 * portal always shows next, the code read out of the newest INDUS mail, the dashboard behind it,
 * and the onboarding user guide.
 *
 * The login form and the OTP step are shared by every role, so StudentLoginPage and OtpPage drive
 * them and take the base URL from the active environment - nothing is hard-coded here. This is the
 * same pairing tests/student/student-login.spec.ts uses, so there is no second copy of the login.
 *
 * Tab handling: the yopmail inbox is opened in a tab of its own BEFORE the login is submitted, and
 * the INDUS page keeps its own tab throughout. Opening it first is deliberate - it records which
 * mail the inbox already holds, which is the only way to be sure the code that gets typed belongs
 * to THIS login and not to an OTP an earlier run left in the same inbox; a "newest mail" check on
 * its own cannot tell those apart. The run then switches to the yopmail tab only to read the code,
 * and brings the INDUS tab back to the front to type it.
 *
 * HEADS-UP: yopmail gates its inbox behind a Cloudflare "confirm you're human" challenge that does
 * not clear for an automated browser (verified 2026-10-27). The first run therefore has to be an
 * attended `npm run test:headed` one where the box is ticked by hand; the clearance is saved and
 * reused after that. Set INDUS_OTP=<code> to skip the inbox entirely. See helpers/yopmail-otp.ts.
 *
 * The user guide is a first-login overlay and finishing it is remembered server-side, so
 * completeOnboarding() clicks "Next" through every slide, uses the finishing button (or
 * "Skip preview" as the fallback) and dismisses the feature tour behind it. A later login has
 * neither overlay, which is recorded rather than failed.
 *
 * Nothing is published or changed on the account, so the test can be run repeatedly.
 */
test.describe('IT Company login (registered account)', () => {
  // Two portals on the slow side: INDUS handing over the OTP step and the dashboard, and yopmail
  // delivering the mail (plus, on a first attended run, a person ticking the Cloudflare box).
  test.setTimeout(10 * 60_000);

  test('logs in with the emailed OTP and completes the user guide when it is shown', async ({ page, context }) => {
    // ---- A code passed in directly skips the inbox; otherwise yopmail is opened in its own tab
    // first, so the mail already sitting there is known before the portal sends a new one.
    const suppliedOtp = otpFromEnv();
    const inbox = suppliedOtp ? undefined : await openYopmailInbox(context, user.email);
    test.info().annotations.push({
      type: 'otp-source',
      description: suppliedOtp ? 'INDUS_OTP environment variable' : `yopmail inbox (${user.email})`,
    });

    // ---- INDUS login page in the original tab: the shared page object, which takes the base URL
    // from the active environment.
    await page.bringToFront();
    const login = new StudentLoginPage(page);
    await login.goto();

    // ---- Email and password from the data file, then Login.
    await login.login(user.email, user.password);

    // ---- OTP screen: the portal always asks for a code after a correct password, which is also
    // what proves the stored credentials were accepted.
    const otpPage = new OtpPage(page);
    await otpPage.expectVisible(60_000);

    // ---- The code: read from the first mail that was not in the inbox before the login above, so
    // it is this attempt's OTP and never an older one.
    const code = suppliedOtp ?? (await readNewOtp(inbox!));
    expect(code, 'the OTP read from the mail should be six digits').toMatch(/^\d{6}$/);

    // ---- Back to the INDUS tab to type it. Never switch before this point: the OTP widget loses
    // focus to the other tab otherwise.
    await page.bringToFront();
    await otpPage.verify(code);

    // ---- Logged in: the dashboard URL, its greeting and the entries only a signed-in account has.
    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await expect(page.getByRole('heading', { name: /^Good (Morning|Afternoon|Evening),/ })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('link', { name: 'My Profile', exact: true })).toBeVisible();
    await expect(dashboard.logoutLink).toBeVisible();

    // The header badge names the signed-in role, which is what identifies the account that got in.
    // Its text is recorded with the run (no credentials are logged). The accessible name starts
    // with the display name once the profile holds one, so the pattern is not anchored to the role.
    const roleBadge = page.getByRole('button', { name: /Logged in as / });
    await expect(roleBadge).toBeVisible();
    test.info().annotations.push({ type: 'logged-in-as', description: (await roleBadge.innerText()).trim() });

    // ---- User guide: walked with "Next" to its finishing button when it shows (with "Skip
    // preview" as the fallback), then the feature tour behind it is dismissed. It is a first-login
    // overlay, so a later run has neither, which is recorded rather than failed.
    const onboarding = await dashboard.completeOnboarding();
    test.info().annotations.push({
      type: 'user-guide',
      description: onboarding.preview ? 'shown and completed' : 'not shown (already completed on an earlier login)',
    });
    test.info().annotations.push({
      type: 'feature-tour',
      description: onboarding.tour ? 'shown and skipped' : 'not shown',
    });
    await expect(dashboard.preview.dialog, 'the user guide should be gone either way').toHaveCount(0);
    await expect(dashboard.tour.dialog, 'the feature tour should be gone either way').toHaveCount(0);

    // ---- The dashboard underneath is usable once the overlays are out of the way, which is what
    // proves the login held through the guide.
    await dashboard.expectVisible(15_000);
    await expect(dashboard.logoutLink).toBeVisible();

    // ---- The yopmail tab is not needed past this point.
    await inbox?.page.close();
    await page.bringToFront();

    // ---- My Profile from the sidebar opens the wizard.
    await dashboard.openMyProfile();
    await expect(page).toHaveURL(/\/profile\/?$/, { timeout: 60_000 });

    // The feature tour can follow the user onto the profile page; get it out of the way.
    await dashboard.tour.skipIfShown(5_000);

    const profile = new ItCompanyProfilePage(page);
    await expect(profile.heading(IT_COMPANY_PROFILE_STEP_HEADINGS.companyInfo)).toBeVisible({ timeout: 60_000 });

    // What the six stepper entries report before anything is touched, so the report shows which
    // steps the account arrived with rather than only the one the wizard opens on.
    test.info().annotations.push({
      type: 'profile-steps-before',
      description: JSON.stringify(await profile.stepStatuses()),
    });

    // ---- Step 1, Company Information. Only fields the portal left empty are written; everything
    // the account already holds is left exactly as it is, and the logo is uploaded only when the
    // header still shows the placeholder.
    await profile.completeMissingItCompanyInfo(itCompanyProfileData.companyInfo, user.email);
    await profile.ensureCompanyLogo(profileImagePath);
    await profile.saveAndNext(IT_COMPANY_PROFILE_STEP_HEADINGS.contact);

    // ---- Step 2, Contact Information: primary and secondary contacts, gaps only.
    await profile.completeMissingContacts(itCompanyProfileData.contact, { email: user.email });
    await profile.saveAndNext(IT_COMPANY_PROFILE_STEP_HEADINGS.stakeholders);

    // The sticky "Profile Completion" strip can cover the form once completion climbs.
    await profile.dismissProfileCompletionOverlays();

    // ---- Step 3, Stakeholder Details: a stakeholder is added only when the step holds none, so
    // repeated runs never stack up duplicate records.
    const stakeholder = await profile.ensureStakeholder(itCompanyProfileData.stakeholders[0]);
    test.info().annotations.push({ type: 'stakeholder', description: stakeholder });
    await profile.saveAndNext(IT_COMPANY_PROFILE_STEP_HEADINGS.benefits);

    // ---- Step 4, Benefits & Perks: ticked only when the account carries no selection yet.
    const benefitsSelected = await profile.ensureBenefits();
    test.info().annotations.push({
      type: 'benefits',
      description: benefitsSelected ? `${benefitsSelected} selected` : 'kept (already selected)',
    });
    await profile.saveAndNext(IT_COMPANY_PROFILE_STEP_HEADINGS.expertise);

    // ---- Step 5, Expertise & Languages: a category with no selection gets an option from its own
    // list, categories that already hold data are untouched, and anything unrated is rated 1-100.
    const expertise = await profile.completeMissingExpertiseAndRatings();
    test.info().annotations.push({ type: 'expertise-added', description: JSON.stringify(expertise.added) });
    test.info().annotations.push({ type: 'expertise-ratings', description: JSON.stringify(expertise.ratings) });
    await profile.saveAndNext(IT_COMPANY_PROFILE_STEP_HEADINGS.projects);

    // ---- Step 6, Projects: a project is added only when the step holds none, then the wizard's
    // final "Save".
    const project = await profile.ensureProject(itCompanyProfileData.project);
    test.info().annotations.push({ type: 'project', description: project });

    // Final Save: the success toast is asserted inside saveProfile, and the completion dialog
    // (when the portal shows it) reports the new percentage; -1 means it showed none.
    const savedPct = await profile.saveProfile();
    test.info().annotations.push({ type: 'profile-completion', description: String(savedPct) });
    test.info().annotations.push({
      type: 'profile-steps-after',
      description: JSON.stringify(await profile.stepStatuses()),
    });

    // The profile is saved and, when the portal reports a figure, it stands at more than nothing.
    // Tighten this to PROFILE_COMPLETION_TARGET (80, see data/dashboard-onboarding.ts) once a real
    // run has shown what this account actually reaches.
    if (savedPct >= 0) {
      expect(savedPct, 'the saved profile should report a completion percentage above 0').toBeGreaterThan(0);
    }

    // ---- Jobs from the sidebar: /jobs with its "All Jobs" list heading (the page has no level-1
    // heading) and the "Post New Job" action.
    await dashboard.openMyJobs();
    const myJobs = new MyJobsPage(page);
    await myJobs.expectVisible();

    // The feature tour can follow the user onto the jobs page too.
    await dashboard.tour.skipIfShown(5_000);
    await myJobs.expectVisible();
  });
});
