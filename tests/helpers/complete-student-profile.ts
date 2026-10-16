import path from 'path';
import { type Page, expect, test } from '@playwright/test';
import {
  ProfilePage,
  PROFILE_STEP_HEADINGS,
  type ProfileRecordSection,
  type RecordOutcome,
} from '../pages/profile.page';
import { studentProfileData } from '../data/student-profile-data';

/** Profile picture used on Personal Details; a PNG, matching the upload control's accepted types. */
const profileImagePath = path.resolve(__dirname, '../fixtures/profile-image.png');

export type StudentProfileSummary = {
  fullName: string;
  profileImage: RecordOutcome;
  education: RecordOutcome;
  skills: string;
  experience: RecordOutcome;
  certificate: RecordOutcome;
  achievement: RecordOutcome;
  publication: RecordOutcome;
  /** Completion percentage the portal reports in its "Profile saved successfully" dialog. */
  completion: number;
};

/**
 * A section ends up with exactly one record when this run created it, and keeps whatever the
 * account already had otherwise. Either way nothing may be added on top of existing data.
 */
async function expectNoDuplicates(profile: ProfilePage, section: ProfileRecordSection, outcome: RecordOutcome) {
  const count = await profile.recordCount(section);
  if (outcome === 'added') {
    expect(count, `${section}: the record added here should be the only one`).toBe(1);
  } else {
    expect(count, `${section}: the records already on the account should still be there`).toBeGreaterThan(0);
  }
}

/**
 * Walks the five steps of the student profile wizard for an account that is already registered
 * and may have been through this before.
 *
 * Nothing here overwrites stored data: every field is read before it is written and filled only
 * when it comes back empty, and every repeatable section (education, experience, certificates,
 * achievements, publications) is counted first so a record is created only where the account has
 * none. Re-running the whole flow over the same account therefore changes nothing and adds no
 * duplicates — which is what the assertions at the end of each step check.
 *
 * The values filled in come from tests/data/student-profile-data.ts; the page object keeps the
 * knowledge of the widgets themselves (lazy option lists, the post-save re-render, sliders).
 */
export async function completeStudentProfile(page: Page): Promise<StudentProfileSummary> {
  const data = studentProfileData;
  const profile = new ProfilePage(page);
  const annotate = (type: string, description: string) => test.info().annotations.push({ type, description });

  // ---- Step 1: Personal Details. The wizard always opens here; the step is selected explicitly
  // so the flow does not depend on where a previous visit left off.
  await profile.expectVisible();
  await profile.openPersonalDetails();
  const personal = await profile.ensurePersonalDetails(data.personal);
  annotate(
    'full-name',
    personal.nameRepaired
      ? `stored name held characters the portal refuses; saved as "${personal.fullName}"`
      : `kept as stored ("${personal.fullName}")`,
  );

  // The picture is uploaded on its own (not with "Save & Next"), and only when none is stored.
  const hadImage = await profile.hasProfileImage();
  await profile.ensureProfileImage(profileImagePath);
  annotate('profile-image', hadImage ? 'already uploaded, kept' : 'was missing, uploaded now');

  await profile.saveAndNext(PROFILE_STEP_HEADINGS.education);

  // ---- Step 2: Education. One record is enough; an existing one is completed, never duplicated.
  const education = await profile.ensureEducation(data.education);
  await expectNoDuplicates(profile, 'educations', education);
  annotate('education', education === 'added' ? 'none on the account, one added' : 'already present, kept');

  await profile.saveAndNext(PROFILE_STEP_HEADINGS.skills);

  // ---- Step 3: Skills & Languages. A category that already holds entries keeps them and their
  // ratings; an empty one gets a single entry, rated out of 100.
  const skills = await profile.ensureSkillsAndLanguages(data.skills);
  const skillSummary = skills
    .map((c) => `${c.category}: ${c.selected.join(', ')}${c.added.length ? ' (added)' : ' (kept)'}`)
    .join(' | ');
  annotate('skills-and-languages', skillSummary);
  for (const category of skills) {
    expect(category.selected.length, `${category.category} should hold at least one entry`).toBeGreaterThan(0);
  }

  await profile.saveAndNext(PROFILE_STEP_HEADINGS.experience);

  // ---- Step 4: Experience.
  const experience = await profile.ensureExperience(data.experience);
  await expectNoDuplicates(profile, 'experiences', experience);
  annotate('experience', experience === 'added' ? 'none on the account, one added' : 'already present, kept');

  await profile.saveAndNext(PROFILE_STEP_HEADINGS.achievements);

  // ---- Step 5: Certificates, Achievements and Publications, each checked on its own.
  const certificate = await profile.ensureCertificate(data.certificate);
  const achievement = await profile.ensureAchievement(data.achievement);
  const publication = await profile.ensurePublication(data.publication);
  for (const [section, outcome] of [
    ['certifications', certificate],
    ['achievements', achievement],
    ['publications', publication],
  ] as const) {
    await expectNoDuplicates(profile, section, outcome);
    annotate(section, outcome === 'added' ? 'none on the account, one added' : 'already present, kept');
  }

  // ---- Save: the toast and the "Profile saved successfully" dialog are the portal's own
  // confirmation, and the dialog carries the completion the save produced.
  const completion = await profile.saveProfile();
  expect(completion, 'the saved profile should report a completion percentage').toBeGreaterThan(0);
  annotate('profile-completion', `${completion}%`);

  return {
    fullName: personal.fullName,
    profileImage: hadImage ? 'kept' : 'added',
    education,
    skills: skillSummary,
    experience,
    certificate,
    achievement,
    publication,
    completion,
  };
}
