/**
 * Expected copy of the post-login dashboard onboarding, as specified for INDUS Tech Connect:
 * the "Welcome" feature preview shown first, then the profile activation checklist.
 */

export type PreviewSlide = {
  title: string;
  description: string;
  /** Bullet points listed under the description. */
  points: string[];
};

export const WELCOME_PREVIEW = {
  /** Small label in the dialog header. */
  label: 'Welcome to INDUS Tech Connect',
  skipLabel: 'Skip preview',
  nextLabel: 'Next',
  backLabel: 'Back',
  /** Label of the button on the last slide (the spec calls it the final "Next"). */
  finishLabel: 'Start onboarding',
  /** Slides in order; the first one is the content the spec describes. */
  slides: [
    {
      title: 'Build a trusted professional profile',
      description:
        'Create a profile that presents your identity, experience, skills, education, or organization clearly.',
      points: ['Complete your role-specific profile', 'Verify eligible identity and credentials'],
    },
    {
      title: 'Discover opportunities',
      description: 'Find the opportunities available to your account type across the INDUS Tech Connect ecosystem.',
      points: ['Explore jobs and projects', 'Join mentorship and professional opportunities'],
    },
    {
      title: 'Learn and grow',
      description:
        'Use courses, certifications, career tools, and industry intelligence to plan your next step.',
      points: ['Browse learning resources', 'Track certificates and development'],
    },
    {
      title: 'Connect with the ecosystem',
      description:
        'Use Talent Hub and social features to discover people, organizations, groups, and support.',
      points: ['Build relevant connections', 'Reach support whenever you need help'],
    },
  ] as PreviewSlide[],
};

export type ActivationStep = {
  title: string;
  /**
   * Expected description. `{pct}` stands for the dynamic profile completion percentage,
   * e.g. "Your profile is currently 56% complete."
   */
  description: string;
  /** Text of the step's action button/link. */
  action: string;
  /** Required steps gate profile activation; optional ones can be done any time. */
  required: boolean;
};

/** Profile completion (in %) at which "Complete your profile" counts as done. */
export const PROFILE_COMPLETION_TARGET = 80;

export const ACTIVATION_CHECKLIST = {
  heading: 'Activate your INDUS Tech Connect profile',
  description: 'Complete the required steps to activate your profile. Optional steps can be completed at any time.',
  /** "0 of 4 completed", "1 of 4 completed", ... */
  progressPattern: /^(\d+) of (\d+) completed$/,
  /** Percentage inside the "Complete your profile" description. */
  completionPattern: /Your profile is currently (\d+)% complete\./,
  completedLabel: 'Completed',
};

/** Steps shown to IT Students (and IT Professionals), in display order. */
export const STUDENT_ACTIVATION_STEPS: ActivationStep[] = [
  {
    title: 'Verify your identity with PakID',
    description: 'Complete the one-time identity verification through NADRA.',
    action: 'Verify with PakID',
    required: true,
  },
  {
    title: 'Complete your profile',
    description:
      `Add the required information to bring your profile completion to at least ${PROFILE_COMPLETION_TARGET}%. ` +
      'Your profile is currently {pct}% complete.',
    action: 'Complete Profile',
    required: true,
  },
  {
    title: 'Verify with PSEB (Optional)',
    description: 'Connect and verify your PSEB registration.',
    action: 'Verify with PSEB',
    required: false,
  },
  {
    title: 'Give consent for Talent Hub (Optional)',
    description: 'Allow your profile to be displayed in the Talent Hub directory.',
    action: 'Give Consent',
    required: false,
  },
];
