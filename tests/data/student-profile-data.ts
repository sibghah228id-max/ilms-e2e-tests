/**
 * Test data for completing an IT Student profile on /profile.
 *
 * Only fields that are still empty after registration are filled from here; values that the
 * portal pre-populates (name, email, phone, date of birth, gender, degree type, institution) are
 * verified and left alone. Dropdown values below were read from the staging option lists.
 */

/** ISO date (YYYY-MM-DD) `monthsAgo` months before today, on the 15th to avoid month-end edge cases. */
export function isoDateMonthsAgo(monthsAgo: number): string {
  const d = new Date();
  d.setUTCDate(15);
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

/** ISO month (YYYY-MM) `monthsAgo` months before today, for <input type="month">. */
export function isoMonthMonthsAgo(monthsAgo: number): string {
  return isoDateMonthsAgo(monthsAgo).slice(0, 7);
}

export type SkillRating = { name: string; rating: number };

export const studentProfileData = {
  personal: {
    /** Typed into the City combobox; the matching option is picked from the list. */
    citySearch: 'Islamabad',
    address: 'House 12, Street 4, Sector G-10',
    description:
      'IT student focused on web development and software quality, keen to grow through internships and industry projects.',
  },

  education: {
    // Degree Type and Institution are normally set from registration; they are only picked here
    // when the record comes back empty. The remaining selections are staging list entries for
    // Air University.
    degreeType: 'Bachelors',
    institutionSearch: 'Air',
    institution: 'Air University',
    campus: 'Air University Islamabad Campus',
    department: 'Computer Science',
    program: 'Computer Science · Bachelors',
    studentId: 'AU-2024-0001',
    semester: '3rd Semester',
    startYear: isoMonthMonthsAgo(24),
  },

  // One option per category; ratings are fixed so a failed run is reproducible.
  skills: {
    core: { name: 'Communication', rating: 75 } as SkillRating,
    secondary: { name: 'Leadership', rating: 65 } as SkillRating,
    technical: { name: 'JavaScript', rating: 80 } as SkillRating,
    language: { name: 'English', rating: 90 } as SkillRating,
  },

  experience: {
    jobType: 'Internship',
    jobTitle: 'Junior Software Engineer',
    company: 'Test Technology Solutions',
    startDate: isoDateMonthsAgo(14),
    endDate: isoDateMonthsAgo(2),
    skillGained: 'Software Development',
    description:
      'Worked on web application development, API integration, testing, and collaboration with the development team.',
  },

  certificate: {
    name: 'Web Development Fundamentals',
    issuingOrganization: 'INDUS Test Academy',
    issuedDate: isoDateMonthsAgo(6),
    /** The field accepts an ID or a URL ("Paste ID or URL"). */
    credential: 'CERT-AUTO-001',
  },

  achievement: {
    award: 'Outstanding Student Project',
    issuingOrganization: 'INDUS Test Institute',
    awardedDate: isoDateMonthsAgo(8),
  },

  publication: {
    title: 'Automation Testing Practices for Modern Web Applications',
    /** Picked from the Category list when it offers options; typed otherwise. */
    category: 'Research Paper',
    publishDate: isoDateMonthsAgo(4),
    link: 'https://example.com/publications/automation-testing-practices',
  },
};

export type StudentProfileData = typeof studentProfileData;
