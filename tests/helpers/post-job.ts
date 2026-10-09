import { type Page, expect, test } from '@playwright/test';
import { registeredCompanyJobData } from '../data/international-company-data';
import { MyJobsPage } from '../pages/jobs.page';
import { PostJobPage } from '../pages/post-job.page';

export type PublishJobOptions = {
  /** Country the company is registered in, as the profile's locked Country field shows it. */
  companyCountry: string;
  /** Job Title for this job; letters and spaces only, and unique per run (see uniqueJobTitle). */
  title: string;
  /**
   * Ticks the optional "Qualification Required" opt-in on step 2 and picks this minimum
   * qualification (the portal offers Bachelors, Masters and PhD). Left out, the opt-in stays off
   * and the review summary shows "-" for it.
   */
  qualification?: string;
};

/**
 * Posts one job through the whole "Post New Job" wizard, starting and ending on the My Jobs page.
 *
 * Steps 1–3 are filled from registeredCompanyJobData, so every job this creates differs only in
 * its title and in whether a minimum qualification is set. The review summary is checked against
 * the values the wizard was given, the job is published, and it is then found again in the jobs
 * list by its title.
 *
 * Each call publishes a real job on the account.
 */
export async function publishJob(page: Page, options: PublishJobOptions): Promise<void> {
  const { companyCountry, title, qualification } = options;
  const job = registeredCompanyJobData;

  // "Post New Job" on the jobs list opens the wizard on step 1 with the later steps locked.
  const myJobs = new MyJobsPage(page);
  await myJobs.expectVisible();
  await myJobs.openPostNewJob();

  const postJob = new PostJobPage(page);
  await postJob.expectVisible();
  await expect(postJob.main.getByText('Create a job post to reach the right candidates faster.')).toBeVisible();

  // ---- Step 1: Basic Info
  await postJob.fillJobTitle(title);
  await postJob.selectJobType(job.jobType);
  // The portal offers only cities of the company's own country, which is verified against the
  // country read off the profile before a city is taken.
  const city = await postJob.selectCityInCompanyCountry(companyCountry, job);
  // "+" and "-" are both exercised and the count never reaches 0 or goes negative.
  await postJob.setVacancies(job.vacancies);
  await postJob.selectJobShift(job.jobShift);
  // Dragged on the slider, then asserted against its visible "N years" read-out.
  await postJob.dragMinimumExperience(job.minimumExperienceYears);

  // Everything step 1 asked for still holds its value right before the step is submitted.
  await expect(postJob.jobTitle).toHaveValue(title);
  await expect(postJob.cityCombo).not.toHaveValue('');
  expect(await postJob.vacancies(), 'vacancies must be above 0 when the step is submitted').toBeGreaterThan(0);
  await expect(postJob.shiftRadio(job.jobShift)).toBeChecked();
  await expect(postJob.experienceSlider).toHaveValue(String(job.minimumExperienceYears));

  await postJob.next();
  await postJob.expectJobDetailsStep();

  // ---- Step 2: Job Details (plus the optional minimum qualification)
  await postJob.completeJobDetails({ ...job, qualification });
  await postJob.nextToJobSettings();
  await postJob.expectJobSettingsStep();

  // ---- Step 3: Compensation & Settings
  await postJob.setApplicationDeadline(job.applicationDeadline);
  // Salary is a two-handle range slider; both handles are dragged and the minimum is asserted to
  // stay below the maximum.
  await postJob.setSalaryRange(job.salary.min, job.salary.max);
  // "Visible To" offers two checkboxes; at least one is required.
  await postJob.setVisibleTo(job.visibleTo);
  await postJob.selectStatus(job.status);

  // One screening question of each type, added through the modal.
  await postJob.addTextAnswerQuestion(job.textQuestion);
  await postJob.addMultipleChoiceQuestion(job.multipleChoiceQuestion.question, job.multipleChoiceQuestion.options);
  await postJob.expectScreeningQuestions(job.textQuestion, job.multipleChoiceQuestion.question);

  // ---- Review and publish
  await postJob.openReview();
  await postJob.expectReviewSummary({
    'Job Title': title,
    'Job Type': job.jobType,
    // The review summary names the city without the country code the picker appends.
    City: city.replace(/\s+[A-Z]{2}$/, ''),
    'No. of Vacancies': String(job.vacancies),
    'Minimum Experience': `${job.minimumExperienceYears} Years`,
    'Job Shift': job.jobShift,
    'Required Skills': job.requiredSkill,
    // Shown as "-" for a job that set no minimum qualification.
    Qualification: qualification ?? '-',
    'Application Deadline': longDate(job.applicationDeadline),
    // Step 3 shows an en dash, the summary a hyphen; either is accepted.
    'Salary Range (PKR / month)': new RegExp(`^\\s*${job.salary.min}k\\s*[–-]\\s*${job.salary.max}k\\s*$`),
    'Visible To': job.visibleTo.join(', '),
    Status: job.status,
  });
  // Both screening questions are part of the summary too.
  await postJob.expectScreeningQuestions(job.textQuestion, job.multipleChoiceQuestion.question);

  // Publishing posts the job and returns to the jobs list.
  await postJob.publish();

  // The new job is listed, found by the title this run used, and carries the chosen status.
  await myJobs.expectVisible();
  await myJobs.expectJobListed(title, job.status);
  test.info().annotations.push({
    type: 'job-published',
    description: `${title}${qualification ? ` (minimum qualification ${qualification})` : ''}`,
  });
}

/** "2026-12-31" -> "December 31, 2026", the format the review summary prints a date in. */
function longDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
