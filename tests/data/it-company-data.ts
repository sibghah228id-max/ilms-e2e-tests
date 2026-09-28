import type { ItCompanyData } from '../pages/create-account.page';

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

/** "0123456789" → "Abcdefghij", capitalised so it reads like a name. */
function digitsToLetters(digits: string): string {
  const letters = digits.replace(/\d/g, (d) => String.fromCharCode(97 + Number(d)));
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}
