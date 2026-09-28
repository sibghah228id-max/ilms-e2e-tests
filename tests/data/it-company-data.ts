import type { ItCompanyData } from '../pages/create-account.page';
import { isoDateMonthsAgo, type SkillRating } from './student-profile-data';

/** Static IT Company signup fixtures (dropdown values as listed on staging). */
export const itCompanySignupData = {
  company: {
    namePrefix: 'Test IT Company',
    /** Option in the "Company Type" list. */
    companyType: 'Private Limited Company',
    address: 'Plot 12, Software Technology Park, Sector I-9',
    /** Typed into the "City" combobox; the option is matched by `cityOption`. */
    citySearch: 'Isl',
    cityOption: /^Islamabad/,
    website: 'https://www.test-it-company.example.com',
    /** Option in the "Verticals" list. */
    vertical: 'Information Technology',
    /** The portal requires at least 10 characters. */
    password: 'ItCo@Pass2026',
  },
  form: {
    placeholders: {
      companyName: 'Enter your company name',
      email: 'Enter your email address',
      phone: 'Enter your phone number',
      address: 'Enter your company address',
    },
    phoneCountryLabel: 'PK | +92',
  },
};

/**
 * Fresh, unique IT Company registration data for every call.
 *
 * The portal rejects duplicate emails, so the email is the address of a throwaway inbox created
 * per run (see helpers/mailtm.ts); the company name and phone carry a per-run tag as well. The
 * tag is encoded as letters because the name is reused where only English letters are allowed.
 */
export function uniqueItCompanyData(email: string, overrides: Partial<ItCompanyData> = {}): ItCompanyData {
  const { company } = itCompanySignupData;
  const stamp = Date.now().toString();
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const tag = `${stamp.slice(-8)}${rand}`;

  return {
    companyName: `${company.namePrefix} ${digitsToLetters(tag)}`,
    companyType: company.companyType,
    email,
    // Phone field is capped at 10 digits behind the fixed +92 code, so use a 3XXXXXXXXX mobile number.
    phone: '3' + tag.slice(-9),
    password: company.password,
    confirmPassword: company.password,
    address: company.address,
    citySearch: company.citySearch,
    cityOption: company.cityOption,
    website: company.website,
    vertical: company.vertical,
    ...overrides,
  };
}

/**
 * Values for the IT Company profile wizard (/profile). Only fields still empty after registration
 * and admin verification are filled from here; dropdown values were read from the staging lists.
 */
export const itCompanyProfileData = {
  companyInfo: {
    /** Option in the "No. Of Employees" list (en dash, as rendered). */
    employees: '11–50',
    establishmentDate: isoDateMonthsAgo(48),
    linkedin: 'https://linkedin.com/company/test-it-company',
    officePhone: '3005551234',
    description:
      'Pakistani IT company delivering web, mobile and cloud solutions for local and international clients.',
    /** "Human Resource" rows: area option and headcount. */
    humanResource: { area: 'IT Professional', count: '25' },
  },
  contact: {
    /** Primary contact email is the company's own (signup) email; the secondary gets its own. */
    primary: { fullName: 'Ahmed Khan', designation: 'Chief Executive Officer (CEO)', phone: '3011234567' },
    secondary: {
      fullName: 'Fatima Noor',
      designation: 'Chief Technology Officer (CTO)',
      email: 'fatima.noor@example.com',
      phone: '3041234567',
    },
  },
  stakeholders: [
    { fullName: 'Sara Ali', designation: 'Chief Technology Officer (CTO)', email: 'sara.ali@example.com', phone: '3021234567' },
    { fullName: 'Bilal Ahmed', designation: 'Project Manager', email: 'bilal.ahmed@example.com', phone: '3031234567' },
  ],
  // One option per category; ratings are fixed so a failed run is reproducible.
  expertise: {
    core: { name: 'Communication', rating: 75 } as SkillRating,
    secondary: { name: 'Leadership', rating: 65 } as SkillRating,
    technical: { name: 'JavaScript', rating: 80 } as SkillRating,
    tools: { name: 'GitHub', rating: 85 } as SkillRating,
    language: { name: 'English', rating: 90 } as SkillRating,
  },
  project: {
    name: 'Talent Portal Automation',
    client: 'INDUS Test Client',
    skillUsed: 'Software Development',
    description: 'End-to-end automation of the talent portal onboarding and verification workflows.',
    deliveryDate: isoDateMonthsAgo(3),
  },
};

export type ItCompanyProfileData = typeof itCompanyProfileData;

/** "0123456789" → "Abcdefghij", capitalised so it reads like a name. */
function digitsToLetters(digits: string): string {
  const letters = digits.replace(/\d/g, (d) => String.fromCharCode(97 + Number(d)));
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}
