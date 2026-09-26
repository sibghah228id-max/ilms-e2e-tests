import type { StudentData } from '../pages/create-account.page';
import signupData from './student-signup.json';

/** Static signup fixtures (defaults, form labels, OTP mail subject) from student-signup.json. */
export const studentSignupData = signupData;

/**
 * Fresh, unique IT Student registration data for every call.
 *
 * The portal rejects duplicate emails and CNICs, so the identity fields are never hard-coded:
 * the timestamp + a random tail seed the name, CNIC, email and phone. Everything else
 * (date of birth, gender, password, university, email domain) comes from student-signup.json.
 * The email lands in a throwaway yopmail inbox so the test can read the OTP back.
 */
export function uniqueStudentData(overrides: Partial<StudentData> = {}): StudentData {
  const { student } = studentSignupData;

  const stamp = Date.now().toString(); // 13 digits
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const tag = `${stamp.slice(-8)}${rand}`; // 11 digits, unique enough per run

  // CNIC: 13 digits, no dashes. Timestamp is already 13 digits; swap the tail for randomness.
  const cnic = stamp.slice(0, 10) + rand;

  // Phone: the field has maxlength 10 and the +92 code is fixed, so use a 3XXXXXXXXX mobile number.
  const phone = '3' + tag.slice(-9);

  return {
    // The portal only allows English letters (and spaces) in the name, so encode the tag as letters.
    name: `${student.namePrefix} ${digitsToLetters(tag)}`,
    cnic,
    dateOfBirth: student.dateOfBirth,
    gender: student.gender as StudentData['gender'],
    email: `student${tag}@${student.emailDomain}`,
    phone,
    password: student.password,
    confirmPassword: student.password,
    university: student.university,
    ...overrides,
  };
}

/** "0123456789" → "ABCDEFGHIJ", capitalised so it reads like a surname (e.g. "Bcfgh"). */
function digitsToLetters(digits: string): string {
  const letters = digits.replace(/\d/g, (d) => String.fromCharCode(97 + Number(d)));
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}

/** The yopmail inbox name (local part) of a yopmail address. */
export function yopmailInbox(email: string): string {
  return email.split('@')[0];
}
