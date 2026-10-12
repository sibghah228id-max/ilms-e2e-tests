/**
 * Signup password policy shared by every role (IT Student, IT Professional, IT Company,
 * International Company). The portal enforces it in two places, which is why each invalid case
 * records where its message shows up:
 *
 * - `field`: the length rule is checked in the browser and rendered under the Password field
 *   (also under Confirm Password) before anything is sent.
 * - `toast`: the letter-case rule is only checked by the server; the form is posted, the API
 *   answers 422 and the portal shows the error message as a toast notification.
 *
 * Messages were read from staging on 2026-10-12.
 */

/** Meets every rule: 14 characters, uppercase "T" and "A", lowercase letters. */
export const VALID_PASSWORD = 'TestpasswordA1';

export const PASSWORD_MIN_LENGTH = 10;

export type InvalidPasswordCase = {
  /** Used in the test title: "rejects a password <title>". */
  title: string;
  password: string;
  /** Exact message the portal shows. */
  message: string;
  shownAs: 'field' | 'toast';
};

export const PASSWORD_TOO_SHORT_MESSAGE = 'Password must be at least 10 characters';
export const PASSWORD_LETTER_CASE_MESSAGE =
  'The password field must contain at least one uppercase and one lowercase letter';

export const INVALID_PASSWORD_CASES: InvalidPasswordCase[] = [
  {
    title: 'shorter than 10 characters',
    password: 'ShortA1',
    message: PASSWORD_TOO_SHORT_MESSAGE,
    shownAs: 'field',
  },
  {
    title: 'without an uppercase letter',
    password: 'testpassworda1',
    message: PASSWORD_LETTER_CASE_MESSAGE,
    shownAs: 'toast',
  },
  {
    title: 'without a lowercase letter',
    password: 'TESTPASSWORDA1',
    message: PASSWORD_LETTER_CASE_MESSAGE,
    shownAs: 'toast',
  },
];
