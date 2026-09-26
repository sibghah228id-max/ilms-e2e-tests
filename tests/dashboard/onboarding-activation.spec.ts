import { test, expect, type Page, type Response } from '@playwright/test';
import { registerStudent } from '../helpers/register-student';
import { ActivationChecklist, FeatureTourDialog, WelcomePreviewDialog, WALKTHROUGH_API } from '../pages/dashboard.page';
import {
  ACTIVATION_CHECKLIST,
  PROFILE_COMPLETION_TARGET,
  STUDENT_ACTIVATION_STEPS,
  WELCOME_PREVIEW,
} from '../data/dashboard-onboarding';

const [pakIdStep, profileStep] = STUDENT_ACTIVATION_STEPS;

/** Resolves with the next PATCH the portal sends to the walkthrough API (preview/tour progress). */
function nextWalkthroughUpdate(page: Page): Promise<Response> {
  return page.waitForResponse((r) => r.url().includes(WALKTHROUGH_API) && r.request().method() === 'PATCH');
}

/** Persisted walkthrough state of the signed-in user, straight from the API. */
async function walkthroughState(page: Page): Promise<Record<string, string | null>> {
  const res = await page.request.get(WALKTHROUGH_API);
  expect(res.ok(), `${WALKTHROUGH_API} responded ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return body?.data?.onboarding_experience ?? body?.onboarding_experience ?? {};
}

/**
 * Loads /dashboard again and checks the welcome preview stays closed. The preview is rendered only
 * after the walkthrough state has been fetched, so wait for that request before asserting.
 */
async function expectPreviewStaysClosed(page: Page, preview: WelcomePreviewDialog) {
  const stateLoaded = page.waitForResponse((r) => r.url().includes(WALKTHROUGH_API) && r.request().method() === 'GET');
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await stateLoaded;

  await new ActivationChecklist(page).expectVisible();
  await expect(preview.dialog).toHaveCount(0);
}

/** Asserts every checklist row against the expected copy, with the live completion percentage. */
async function expectChecklistSteps(checklist: ActivationChecklist, pct: number) {
  await expect(checklist.items).toHaveCount(STUDENT_ACTIVATION_STEPS.length);

  for (const step of STUDENT_ACTIVATION_STEPS) {
    await test.step(step.title, async () => {
      const row = checklist.item(step.title);
      await expect(row).toBeVisible();
      await expect(checklist.itemDescription(step.title)).toHaveText(step.description.replace('{pct}', String(pct)));
      await expect(checklist.action(step.title, step.action)).toBeVisible();

      // Optional steps are told apart from activation requirements by the "(Optional)" suffix.
      expect(step.title.endsWith('(Optional)')).toBe(!step.required);
    });
  }
}

/**
 * First visit to the dashboard after registering: the "Welcome to INDUS Tech Connect" preview is
 * shown on top of the page, and once it is finished or skipped the profile activation checklist
 * is what the student works from. Both ways of closing the preview are persisted on the server,
 * so it is never shown to that user again.
 *
 * Every test registers its own IT Student (real OTP email), because the preview only appears for
 * an account that has not seen it yet.
 */
test.describe('Dashboard onboarding → profile activation (IT Student)', () => {
  test.setTimeout(4 * 60_000);

  test('welcome preview walks through all slides, then the activation checklist is shown and persisted', async ({ page }) => {
    await registerStudent(page);

    const preview = new WelcomePreviewDialog(page);
    const checklist = new ActivationChecklist(page);

    await test.step('preview opens first, showing the profile slide', async () => {
      await preview.expectVisible();
      await expect(preview.dialog).toHaveAttribute('aria-modal', 'true');
      await expect(preview.label).toBeVisible();
      await expect(preview.skipButton).toBeVisible();
      await expect(preview.nextButton).toBeVisible();
      await expect(preview.backButton).toBeHidden();

      const [first] = WELCOME_PREVIEW.slides;
      await expect(preview.title).toHaveText(first.title);
      await expect(preview.description).toHaveText(first.description);
      await expect(preview.points).toHaveText(first.points);
      expect(await preview.slidePosition()).toEqual({ current: 1, total: WELCOME_PREVIEW.slides.length });
    });

    await test.step('Next moves through the remaining slides', async () => {
      for (let i = 1; i < WELCOME_PREVIEW.slides.length; i++) {
        const slide = WELCOME_PREVIEW.slides[i];
        await preview.nextButton.click();

        await expect(preview.title).toHaveText(slide.title);
        await expect(preview.description).toHaveText(slide.description);
        await expect(preview.points).toHaveText(slide.points);
        await expect(preview.backButton).toBeVisible();
        expect(await preview.slidePosition()).toEqual({ current: i + 1, total: WELCOME_PREVIEW.slides.length });
      }
      // The last slide replaces "Next" with the finishing button.
      await expect(preview.nextButton).toBeHidden();
      await expect(preview.finishButton).toBeVisible();
    });

    await test.step('finishing the preview closes it and records it as completed', async () => {
      const update = nextWalkthroughUpdate(page);
      await preview.finishButton.click();

      const response = await update;
      expect(response.ok(), `walkthrough update responded ${response.status()}`).toBeTruthy();
      expect(response.request().postDataJSON()).toMatchObject({ phase: 'preview', status: 'completed' });
      await expect(preview.dialog).toBeHidden();
    });

    // The feature tour that follows the preview is outside this spec; get it out of the way.
    await new FeatureTourDialog(page).skipIfShown();

    let pct = 0;
    await test.step('activation checklist with live progress', async () => {
      await checklist.expectVisible();
      await expect(checklist.heading).toHaveText(ACTIVATION_CHECKLIST.heading);
      await expect(checklist.description).toHaveText(ACTIVATION_CHECKLIST.description);

      // The counter must agree with the rows actually marked "Completed"; a brand-new account has none.
      const progress = await checklist.progressCounts();
      expect(progress.total).toBe(STUDENT_ACTIVATION_STEPS.length);
      expect(progress.done).toBe(await checklist.completedCount());
      expect(progress.done).toBe(0);

      pct = await checklist.profileCompletionPct(profileStep.title);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
      // The same live figure drives the profile completion widget on the dashboard, so the two must agree.
      await expect(page.getByText(new RegExp(`Your profile is ${pct}% complete`))).toBeVisible();
    });

    await expectChecklistSteps(checklist, pct);

    await test.step('step states for a new account', async () => {
      expect(await checklist.state(pakIdStep.title)).toBe('pending');
      await expect(checklist.action(pakIdStep.title, pakIdStep.action)).toBeEnabled();

      // "Complete your profile" counts as done only from 80% completion; a fresh account is below that.
      expect(pct).toBeLessThan(PROFILE_COMPLETION_TARGET);
      expect(await checklist.state(profileStep.title)).not.toBe('completed');
      // Deployed behaviour: the profile step is locked until PakID verification is done (the
      // button is disabled with a tooltip) rather than linking straight to the profile page.
      expect(await checklist.state(profileStep.title)).toBe('locked');
      await expect(checklist.action(profileStep.title, profileStep.action)).toHaveAttribute(
        'title',
        'Complete the previous step first',
      );

      for (const step of STUDENT_ACTIVATION_STEPS.filter((s) => !s.required)) {
        expect(await checklist.state(step.title)).toBe('pending');
        await expect(checklist.action(step.title, step.action)).toBeEnabled();
      }
    });

    await test.step('preview is not shown again after reloading', async () => {
      const state = await walkthroughState(page);
      expect(state.preview_completed_at).toBeTruthy();
      expect(state.preview_skipped_at).toBeNull();

      await expectPreviewStaysClosed(page, preview);
    });
  });

  test('Skip preview closes the welcome preview for good and shows the activation checklist', async ({ page }) => {
    await registerStudent(page);

    const preview = new WelcomePreviewDialog(page);
    await preview.expectVisible();
    await expect(preview.title).toHaveText(WELCOME_PREVIEW.slides[0].title);

    await test.step('Skip preview closes the dialog and records it as skipped', async () => {
      const update = nextWalkthroughUpdate(page);
      await preview.skipButton.click();

      const response = await update;
      expect(response.ok(), `walkthrough update responded ${response.status()}`).toBeTruthy();
      expect(response.request().postDataJSON()).toMatchObject({ phase: 'preview', status: 'skipped' });
      await expect(preview.dialog).toBeHidden();
    });

    await new FeatureTourDialog(page).skipIfShown();

    const checklist = new ActivationChecklist(page);
    await checklist.expectVisible();
    await expect(checklist.heading).toHaveText(ACTIVATION_CHECKLIST.heading);
    expect((await checklist.progressCounts()).total).toBe(STUDENT_ACTIVATION_STEPS.length);

    await test.step('preview is not shown again after reloading', async () => {
      const state = await walkthroughState(page);
      expect(state.preview_skipped_at).toBeTruthy();
      expect(state.preview_completed_at).toBeNull();

      await expectPreviewStaysClosed(page, preview);
    });
  });
});
