import { test, expect } from '@playwright/test';
import path from 'path';
import credentials from '../data/international-company.json';
import { registeredCompanyProfileData } from '../data/international-company-data';
import { StudentLoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { CompanyProfilePage, COMPANY_PROFILE_STEP_HEADINGS } from '../pages/company-profile.page';

// Email, password and OTP come from tests/data/international-company.json only; change them there.
const { internationalCompany: user } = credentials;

/** Company logo uploaded only when the profile header still shows the placeholder. */
const profileImagePath = path.resolve(__dirname, '../fixtures/profile-image.png');

/**
 * End-to-end pass over an ALREADY REGISTERED International Company account: login with the stored
 * email, password and OTP, the onboarding user guide when it shows, then the three profile steps
 * completing only what the portal left empty, and finally the Jobs page from the sidebar.
 *
 * Nothing that already holds a value is overwritten, and the logo is uploaded only when missing,
 * so the test can be run repeatedly against the same account.
 */
test.describe('International Company login (registered account)', () => {
  // Login, the OTP round-trip, the guide and the full profile wizard on a slow portal.
  test.setTimeout(12 * 60_000);

  test('logs in, completes the missing profile data and opens the Jobs page', async ({ page }) => {
    // Login form is shared by every role, so the existing page object handles it, OTP included.
    const login = new StudentLoginPage(page);
    await login.goto();
    await login.loginWithOtpIfShown(user.email, user.password, user.otp);

    // Logged in: dashboard URL, the greeting heading and the sidebar entries of a signed-in account.
    const dashboard = new DashboardPage(page);
    await dashboard.expectVisible(60_000);
    await expect(page.getByRole('heading', { name: /^Good (Morning|Afternoon|Evening),/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: 'My Profile', exact: true })).toBeVisible();
    await expect(dashboard.logoutLink).toBeVisible();

    // The header badge names the signed-in role; it is recorded with the run (no credentials are logged).
    // Its accessible name starts with the display name once the profile holds one, so no anchor.
    const roleBadge = page.getByRole('button', { name: /Logged in as / });
    await expect(roleBadge).toBeVisible();
    test.info().annotations.push({ type: 'logged-in-as', description: (await roleBadge.innerText()).trim() });

    // User guide: shown on the first login only. completeOnboarding() clicks "Next" through every
    // slide, uses the finishing button (or "Skip preview" as the fallback) and then dismisses the
    // feature tour that follows it. It returns without failing when no guide appears.
    await dashboard.completeOnboarding();
    await expect(dashboard.preview.dialog).toHaveCount(0);

    // My Profile from the sidebar opens the profile view.
    await page.getByRole('link', { name: 'My Profile', exact: true }).click();
    await expect(page).toHaveURL(/\/profile\/?$/, { timeout: 60_000 });

    // The feature tour can follow the user onto the profile page; get it out of the way.
    await dashboard.tour.skipIfShown();

    // Profile view is rendered: the breadcrumb names the page and step 1 of the wizard is showing.
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Profile', { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const profile = new CompanyProfilePage(page);
    await expect(profile.heading(COMPANY_PROFILE_STEP_HEADINGS.information)).toBeVisible({ timeout: 60_000 });

    // Step 1, Company Information: every field is inspected and only the empty ones are written.
    // Country and Verticals take a value from their own option lists, so nothing is invented. The
    // locked Email gets the account email when the portal shows it empty (see the page object).
    await profile.completeMissingCompanyInfoFields(registeredCompanyProfileData.information, user.email);
    // Logo: uploaded only when the header still shows the placeholder, never replaced.
    await profile.ensureCompanyLogo(profileImagePath);
    // "Save & Next" must toast the success and open Contact Information; a validation message fails the step.
    await profile.saveAndNext(COMPANY_PROFILE_STEP_HEADINGS.contact);

    // Step 2, Contact Information: Full Name, Designation, Contact Email and Phone Number are
    // completed only where the portal left a gap.
    await profile.completeMissingContactFields(registeredCompanyProfileData.contact);
    await profile.saveAndNext(COMPANY_PROFILE_STEP_HEADINGS.expertise);

    // The sticky "Profile Completion" strip can cover the form once completion climbs.
    await profile.dismissProfileCompletionOverlays();

    // Step 3, Expertise & Languages: a category with no selection gets an option from its own list,
    // categories that already hold data are untouched, and anything unrated is rated 1–100.
    const expertise = await profile.completeMissingExpertiseAndRatings();
    test.info().annotations.push({ type: 'expertise-added', description: JSON.stringify(expertise.added) });
    test.info().annotations.push({ type: 'expertise-ratings', description: JSON.stringify(expertise.ratings) });

    // Final Save: success toast, and the completion dialog (when shown) reports the new percentage.
    const savedPct = await profile.saveProfile();
    test.info().annotations.push({ type: 'profile-completion', description: String(savedPct) });

    // My Jobs from the sidebar opens the jobs page: /jobs with its "All Jobs" list heading (the page
    // has no level-1 heading) and the "Post New Job" action.
    await dashboard.openMyJobs();
    await expect(page).toHaveURL(/\/jobs\/?(\?.*)?$/, { timeout: 60_000 });
    await expect(page.locator('main').getByRole('heading', { name: 'All Jobs' })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('main').getByRole('link', { name: 'Post New Job' })).toBeVisible();
  });
});
