import { isoDateMonthsAgo, type SkillRating } from './student-profile-data';

/**
 * Test data for completing an IT Professional profile on /profile.
 *
 * Only fields that are still empty after registration are filled from here; values that the
 * portal pre-populates (name, email, phone, date of birth, gender) are verified and left alone.
 * Dropdown values below were read from the staging option lists.
 */
export const itProfessionalProfileData = {
  personal: {
    citySearch: 'Islamabad',
    address: 'House 8, Street 12, Sector F-8',
    description:
      'IT professional focused on full-stack development and cloud delivery, looking to grow through industry projects and mentorship.',
  },

  education: {
    degreeType: 'Bachelors',
    institutionSearch: 'Air',
    institution: 'Air University',
    campus: 'Air University Islamabad Campus',
    /** Free-text input typed by the user (placeholder "e.g. BS Computer Science"). */
    program: 'BS Computer Science',
    studentId: 'AU-PRO-2020-0001',
    // Professionals use End Year (Currently Studying defaults to No); semester is student-only.
    startYear: isoDateMonthsAgo(72).slice(0, 7),
    endYear: isoDateMonthsAgo(24).slice(0, 7),
  },

  skills: {
    core: { name: 'Communication', rating: 80 } as SkillRating,
    secondary: { name: 'Leadership', rating: 70 } as SkillRating,
    technical: { name: 'JavaScript', rating: 85 } as SkillRating,
    language: { name: 'English', rating: 90 } as SkillRating,
  },

  experience: {
    jobType: 'Full Time',
    jobTitle: 'Software Engineer',
    company: 'Test Technology Solutions',
    startDate: isoDateMonthsAgo(36),
    endDate: isoDateMonthsAgo(2),
    skillGained: 'Software Development',
    description:
      'Delivered web application features, API integration, testing, and collaboration with cross-functional teams.',
  },

  certificate: {
    name: 'Cloud Practitioner Fundamentals',
    issuingOrganization: 'INDUS Test Academy',
    issuedDate: isoDateMonthsAgo(10),
    credential: 'CERT-PRO-001',
  },

  achievement: {
    award: 'Outstanding Project Delivery',
    issuingOrganization: 'INDUS Test Institute',
    awardedDate: isoDateMonthsAgo(12),
  },

  publication: {
    title: 'Practical Patterns for Scalable Web Applications',
    category: 'Research Paper',
    publishDate: isoDateMonthsAgo(6),
    link: 'https://example.com/publications/scalable-web-patterns',
  },
};

export type ItProfessionalProfileData = typeof itProfessionalProfileData;
