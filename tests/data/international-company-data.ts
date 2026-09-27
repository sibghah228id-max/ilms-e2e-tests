import type { InternationalCompanyData } from '../pages/create-account.page';

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
    companyName: `${company.namePrefix} ${tag}`,
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
