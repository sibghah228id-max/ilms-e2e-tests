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
    phoneCountryLabel: 'PK | +92',
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
