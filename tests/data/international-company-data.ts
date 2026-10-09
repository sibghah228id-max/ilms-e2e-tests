import type { InternationalCompanyData } from '../pages/create-account.page';
import { isoMonthMonthsAgo, type SkillRating } from './student-profile-data';

/**
 * Values for the company profile wizard (/profile). Only fields still empty after registration
 * are filled from here; dropdown values were read from the staging option lists.
 */
export const internationalCompanyProfileData = {
  information: {
    foundingYear: isoMonthMonthsAgo(60),
    website: 'https://www.test-intl-company.example.com',
    linkedin: 'https://linkedin.com/company/test-intl-company',
    address: '100 Market Street, Suite 400, San Francisco, CA',
    description:
      'International technology company sourcing verified Pakistani IT talent for software projects and remote roles.',
  },
  contact: {
    designation: 'Chief Executive Officer (CEO)',
  },
  // One option per category; ratings are fixed so a failed run is reproducible.
  expertise: {
    core: { name: 'Communication', rating: 75 } as SkillRating,
    secondary: { name: 'Leadership', rating: 65 } as SkillRating,
    technical: { name: 'JavaScript', rating: 80 } as SkillRating,
    tools: { name: 'GitHub', rating: 85 } as SkillRating,
    language: { name: 'English', rating: 90 } as SkillRating,
  },
};

export type InternationalCompanyProfileData = typeof internationalCompanyProfileData;

/**
 * Fallback values for an ALREADY REGISTERED company account, where most of the profile is filled
 * in already. Only a field the portal hands back empty is written from here, so these values show
 * up solely in the gaps; the signup fixtures above are reused wherever they fit.
 */
export const registeredCompanyProfileData = {
  information: {
    ...internationalCompanyProfileData.information,
    companyName: 'Test Intl Company Registered',
    /**
     * Country picked when the field is empty. An International Company is registered outside
     * Pakistan, so never leave this blank: a blank value would take the list's first option,
     * which is Pakistan. The option may render as "Australia AUS"; the leading name is matched.
     */
    country: 'Australia',
  },
  contact: {
    ...internationalCompanyProfileData.contact,
    fullName: 'Daniel Carter',
    contactEmail: 'daniel.carter@test-intl-company.example.com',
    /** National part only; the country code comes from the phone field's own selector. */
    phone: '3001234567',
  },
};

export type RegisteredCompanyProfileData = typeof registeredCompanyProfileData;

/**
 * Step 1 ("Basic Info") of the "Post New Job" wizard for the registered company account.
 *
 * `city` is only a preference: the portal filters the City list to the company's own country, and
 * the page object verifies that the offered cities belong to that country before picking one, so a
 * city that is not on the list is replaced by the first one the portal offers rather than failing
 * the run. Keep it a city of `registeredCompanyProfileData.information.country`.
 */
export const registeredCompanyJobData = {
  title: 'Senior QA Automation Engineer',
  /** One of the five job-type cards: Onsite | Hybrid | Remote | Contract | Freelance. */
  jobType: 'Remote' as const,
  /**
   * The country the account is registered in, as the locked Country field of the company profile
   * shows it. The test reads that field and fails here if it ever names another country, because
   * the city below would then belong to the wrong one.
   */
  country: 'Australia',
  /**
   * ISO-3166 alpha-2 code the job form's city options carry for `country` ("Sydney AU"). Checked
   * against every city the portal offers, so a list from another country fails the step.
   */
  cityCountryCode: 'AU',
  city: 'Sydney',
  /**
   * Target for the vacancy stepper. At least 2, so "-" can be exercised without ever taking the
   * count to 0 (the portal's own floor is 0, see PostJobPage.setVacancies).
   */
  vacancies: 3,
  /** One of the two job-shift radios: Day | Night. */
  jobShift: 'Night' as const,
  /** Years dragged on the Minimum Experience slider (the portal offers 1–50). */
  minimumExperienceYears: 6,

  // ---- Step 2: Job Details ----
  /** Option of the "Required Skills" list; added as a tag. */
  requiredSkill: 'Communication',
  description:
    'We are hiring a senior QA automation engineer to own our end-to-end Playwright suite, review ' +
    'test coverage and mentor the wider QA team.',
  /**
   * Minimum qualification for a job that ticks step 2's optional "Qualification Required" opt-in.
   * The portal's dropdown offers exactly Bachelors, Masters and PhD, spelled without apostrophes.
   */
  qualification: 'Masters',

  // ---- Step 3: Compensation & Settings ----
  /** Always in the future: the Application Deadline field refuses anything before today. */
  applicationDeadline: isoDateDaysFromNow(90),
  /**
   * Salary thumbs in thousands of PKR per month, as the slider reports them (it offers 10–900).
   * `min` must stay below `max`; the page object asserts that before dragging.
   */
  salary: { min: 150, max: 500 },
  /** "Visible To" checkboxes to tick. The portal ships with both ticked; at least one is required. */
  visibleTo: ['IT Professional', 'Student'],
  /** Option of the "Status" list (the portal offers Active and Closed). */
  status: 'Active',

  // ---- Step 3: Screening questions ----
  textQuestion: 'How many years of test automation experience do you have?',
  multipleChoiceQuestion: {
    question: 'Which test automation tools have you used professionally?',
    /** At least two options; the modal starts with two empty option fields. */
    options: ['Playwright', 'Cypress'],
  },
};

export type RegisteredCompanyJobData = typeof registeredCompanyJobData;

/**
 * The "Create Project" wizard (/projects/new) for the registered company account.
 *
 * Status and Visibility already hold the portal's defaults (Open / Public) when the step opens;
 * they are selected explicitly anyway so the test drives every control the step offers.
 */
export const registeredCompanyProjectData = {
  title: 'Playwright Suite Modernisation',
  description:
    'Modernise our end-to-end Playwright suite: port the remaining legacy specs, add reporting ' +
    'and bring the pipeline down to under ten minutes.',
  /** Option of the "Skills Required" list; added as a tag. */
  skill: 'Communication',
  /** Always in the future: the Deadline field refuses anything before today. */
  deadline: isoDateDaysFromNow(120),
  /**
   * Budget thumbs as the slider reports them. It covers 0–1,000,000 in steps of 500, so both ends
   * must be multiples of 500 and `lower` must stay below `upper`.
   */
  budget: { lower: 20_000, upper: 100_000 },
  /** Option of the "Currency" list; the portal names currencies in full, not as codes. */
  currency: 'Pakistani Rupee',
  /** Option of the "Status" list (Open, Draft or Closed). */
  status: 'Open',
  /** Option of the "Visibility" list (Public or Private). */
  visibility: 'Public',
};

export type RegisteredCompanyProjectData = typeof registeredCompanyProjectData;

/**
 * A project title that is unique per run, so the published project can be found again — and
 * counted — in the projects list without older runs' projects matching too.
 */
export function uniqueProjectTitle(): string {
  return `${registeredCompanyProjectData.title} ${digitsToLetters(runStamp())}`;
}

/**
 * A job title that is unique per run, so the published job can be found again in the jobs list
 * without older runs' jobs matching too.
 *
 * The portal's Job Title accepts letters and spaces only ("Only letters allowed"), so the per-run
 * stamp is encoded as letters the same way the company name is.
 */
export function uniqueJobTitle(): string {
  return `${registeredCompanyJobData.title} ${digitsToLetters(runStamp())}`;
}

/** Digits that are distinct for every call: the clock to the millisecond plus two random ones. */
function runStamp(): string {
  return Date.now().toString().slice(-8) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
}

/** Today + `days` as `YYYY-MM-DD`, built from local date parts so no timezone shift creeps in. */
function isoDateDaysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Static International Company signup fixtures (dropdown values as listed on staging). */
export const internationalCompanySignupData = {
  company: {
    namePrefix: 'Test Intl Company',
    /** Option in the "Verticals" list. */
    vertical: 'Information Technology',
    /** Typed into the "Country" combobox; the option is matched by `countryOption`. */
    countrySearch: 'United States',
    countryOption: /^United States/,
    /** The portal requires at least 10 characters. */
    password: 'Intl@Pass2026',
  },
  form: {
    placeholders: {
      companyName: 'Enter your name',
      email: 'Enter your email address',
      phone: 'Enter your phone number',
    },
    phoneCountryLabel: '+92',
  },
};

/**
 * Fresh, unique International Company registration data for every call.
 *
 * The portal rejects duplicate emails, so the email is the address of a throwaway inbox created
 * per run (see helpers/mailtm.ts); the company name and phone carry a per-run tag as well.
 */
export function uniqueInternationalCompanyData(
  email: string,
  overrides: Partial<InternationalCompanyData> = {},
): InternationalCompanyData {
  const { company } = internationalCompanySignupData;
  const stamp = Date.now().toString();
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const tag = `${stamp.slice(-8)}${rand}`;

  return {
    // The company name is reused as the contact person's name, which allows English letters only,
    // so the tag is encoded as letters ("0123456789" → "Abcdefghij").
    companyName: `${company.namePrefix} ${digitsToLetters(tag)}`,
    vertical: company.vertical,
    email,
    // Phone field is capped at 10 digits behind the fixed +92 code, so use a 3XXXXXXXXX mobile number.
    phone: '3' + tag.slice(-9),
    password: company.password,
    confirmPassword: company.password,
    countrySearch: company.countrySearch,
    countryOption: company.countryOption,
    ...overrides,
  };
}

/** "0123456789" → "Abcdefghij", capitalised so it reads like a name. */
function digitsToLetters(digits: string): string {
  const letters = digits.replace(/\d/g, (d) => String.fromCharCode(97 + Number(d)));
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}
