import { type Page, expect, test } from '@playwright/test';
import { registeredCompanyProjectData } from '../data/international-company-data';
import { MyProjectsPage } from '../pages/projects.page';
import { PostProjectPage } from '../pages/post-project.page';

/**
 * Posts one project through the whole "Create Project" wizard, starting and ending on the My
 * Projects page, and checks the published project is listed exactly once.
 *
 * Everything but the title comes from registeredCompanyProjectData. "Review & Publish" is clicked
 * exactly once: the portal leaves the button enabled and stays on the wizard while the POST is in
 * flight, so a second click would create the project a second time. The count check afterwards is
 * what catches that happening.
 *
 * Each call publishes a real project on the account.
 */
export async function publishProject(page: Page, title: string): Promise<void> {
  const project = registeredCompanyProjectData;

  // "Post New Project" on the projects list opens the wizard on step 1 with later steps locked.
  const myProjects = new MyProjectsPage(page);
  await myProjects.expectVisible();
  await myProjects.openPostNewProject();

  const postProject = new PostProjectPage(page);
  await postProject.expectVisible();
  await expect(postProject.main.getByText('Fill in the details to create a new project.')).toBeVisible();

  // ---- Step 1: Project Details
  await postProject.completeProjectDetails({ title, description: project.description, skill: project.skill });
  await postProject.nextToBudgetAndSettings();
  await postProject.expectBudgetAndSettingsStep();

  // ---- Step 2: Budget & Settings
  await postProject.setDeadline(project.deadline);
  await postProject.selectCurrency(project.currency);
  // Budget is a two-handle range slider; both handles are dragged and the lower end is asserted
  // to stay below the upper.
  await postProject.setBudgetRange(project.budget.lower, project.budget.upper);
  await postProject.selectStatus(project.status);
  await postProject.selectVisibility(project.visibility);

  // Everything step 2 asked for still holds its value right before the step is submitted.
  await expect(postProject.deadline).toHaveValue(project.deadline);
  await expect(postProject.currencyCombo).toHaveValue(project.currency);
  await expect(postProject.statusCombo).toHaveValue(project.status);
  await expect(postProject.visibilityCombo).toHaveValue(project.visibility);

  await postProject.nextToReview();

  // ---- Step 3: Review
  await postProject.expectReviewSummary({
    'Project Title': title,
    Deadline: shortDate(project.deadline),
    Description: project.description,
    'Budget Range': `${project.budget.lower} - ${project.budget.upper}`,
    Currency: project.currency,
    // The summary prints the status and visibility in lower case.
    Status: new RegExp(`^\\s*${project.status}\\s*$`, 'i'),
    Visibility: new RegExp(`^\\s*${project.visibility}\\s*$`, 'i'),
  });

  // ---- Publish, once
  await postProject.publish();

  // The portal stays on the wizard after creating the project, so the list is opened explicitly
  // rather than waiting for a navigation that never comes.
  await page.goto('/projects', { waitUntil: 'networkidle' });
  await myProjects.expectVisible();

  // The project exists, carries its status, and exists exactly once.
  await myProjects.expectProjectListedOnce(title, project.status);
  test.info().annotations.push({ type: 'project-published', description: `${title} (1 match)` });
}

/** "2027-02-06" -> "Feb 06, 2027", the format the review summary prints a date in (day padded). */
function shortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}
