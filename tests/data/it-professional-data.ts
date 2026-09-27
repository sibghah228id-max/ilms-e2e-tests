import type { ItProfessionalData } from '../pages/create-account.page';
import signupData from './it-professional-signup.json';
import { studentSignupData } from './student-data';

/** Static IT Professional signup fixtures (defaults, form labels) from it-professional-signup.json. */
export const itProfessionalSignupData = signupData;

/** OTP mail subject is the same for every role. */
export const itProfessionalOtpData = studentSignupData.otp;

/**
 * Fresh, unique IT Professional registration data for every call.
 *
 * The portal rejects duplicate emails and CNICs, so the identity fields are never hard-coded:
 * the timestamp + a random tail seed the name, CNIC and phone, and the email is the address of
 * a throwaway inbox created per run (see helpers/mailtm.ts). Everything else (date of birth,
 * gender, password, years of experience, work status) comes from it-professional-signup.json.
 */
export function uniqueItProfessionalData(
  email: string,
  overrides: Partial<ItProfessionalData> = {},
): ItProfessionalData {
  const { professional } = itProfessionalSignupData;

  const stamp = Date.now().toString(); // 13 digits
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  const tag = `${stamp.slice(-8)}${rand}`; // 11 digits, unique enough per run

  // CNIC: 13 digits, no dashes. Timestamp is already 13 digits; swap the tail for randomness.
  const cnic = stamp.slice(0, 10) + rand;

  // Phone: the field has maxlength 10 and the +92 code is fixed, so use a 3XXXXXXXXX mobile number.
  const phone = '3' + tag.slice(-9);

  return {
    // The portal only allows English letters (and spaces) in the name, so encode the tag as letters.
    name: `${professional.namePrefix} ${digitsToLetters(tag)}`,
    cnic,
    dateOfBirth: professional.dateOfBirth,
    gender: professional.gender as ItProfessionalData['gender'],
    email,
    phone,
    password: professional.password,
    confirmPassword: professional.password,
    yearsOfExperience: professional.yearsOfExperience,
    workStatus: professional.workStatus as ItProfessionalData['workStatus'],
    ...overrides,
  };
}

/** "0123456789" → "ABCDEFGHIJ", capitalised so it reads like a surname (e.g. "Bcfgh"). */
function digitsToLetters(digits: string): string {
  const letters = digits.replace(/\d/g, (d) => String.fromCharCode(97 + Number(d)));
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}
