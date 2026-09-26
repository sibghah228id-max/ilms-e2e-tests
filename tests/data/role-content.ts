export type RoleContent = {
  /** Yellow (amber) notice box text; null when the role has no notice. */
  notice: string | null;
  benefits: string[];
};

export const ROLE_CONTENT: Record<string, RoleContent> = {
  'IT Student': {
    notice:
      "IT Students must be enrolled in an IT degree/program doing BS at an HEC approved university. " +
      "Students who have already completed their Bachelor's degree, or who are currently working as IT professionals, " +
      'should sign up as an IT Professional instead. Already graduated? Switch to IT Professional',
    benefits: [
      'Build a trusted professional profile verified through NADRA and HEC',
      'Access diverse IT opportunities offered through government-led initiatives',
      'Upskill through industry-relevant virtual and in-person training programs',
      'Discover the right career path with an AI-curated journey tailored to your profile',
      'Connect with leading IT companies and experienced industry mentors for guidance',
      'Grow your professional network through a dedicated community platform',
      'Stay updated on the latest job and internship opportunities',
      'Prepare confidently with AI-powered mock interviews and skill assessments',
    ],
  },
  'IT Professional': {
    notice:
      'Register as an IT Professional if you are employed by a company or work independently as a freelancer. ' +
      'If you are already registered with PSEB as a freelancer, select “Sign Up with PSEB” to verify your credentials and receive a verified badge.',
    benefits: [
      'Build a trusted professional profile verified through NADRA, HEC & PSEB',
      'Access diverse IT opportunities offered through government-led initiatives',
      'Upskill through industry-relevant virtual and in-person training programs',
      'Discover the right career path with an AI-curated journey tailored to your profile',
      'Connect with leading IT companies and experienced industry mentors for guidance',
      'Grow your professional network through a dedicated community platform',
      'Stay updated on the latest job and internship opportunities',
      'Prepare confidently with AI-powered mock interviews and skill assessments',
    ],
  },
  'IT Company': {
    notice:
      'To register as an IT Company, your business must be registered or incorporated in Pakistan and operate within the IT or technology sector. ' +
      'Only a company Director or Owner is authorized to create its profile. ' +
      'If your company is already registered with PSEB, select “Sign Up with PSEB” to verify your credentials and receive a verified badge.',
    benefits: [
      'Build a trusted company profile with credentials verified through NADRA, PSEB, and SECP',
      'Post jobs and projects, then use advanced filters to quickly find the right talent',
      'Apply for domestic and international projects',
      'Increase your company’s visibility, and unlock new revenue opportunities',
      'Access a wide range of opportunities offered through government-led IT initiatives',
      'Stay informed about emerging IT trends and market demand in Pakistan and worldwide',
      'Connect with leading IT professionals and experienced industry mentors',
      'Expand your professional network through a dedicated industry community',
    ],
  },
  Academia: {
    notice: null,
    benefits: [
      'View your current students and alumni, and showcase their professional achievements',
      'Connect students with relevant jobs, internships, and career opportunities',
      'Offer physical and virtual training programs through your institution',
      'Stay informed about industry trends and talent demand to align your curriculum with market needs',
      'Access BI reports covering key talent supply-and-demand metrics',
      'Benchmark your institution against other universities and gain insights from their successful initiatives',
    ],
  },
  'International Company': {
    notice:
      'Register here if you are a foreign national without Pakistani identification and represent a company seeking verified Pakistani IT talent for jobs or projects.',
    benefits: [
      'INDUS Tech Connect connects you with Pakistan’s most suitable and verified IT talent for your jobs and projects',
      'Post jobs and projects to attract qualified Pakistani IT talent',
      'Access an exclusive database of verified IT professionals and companies, with credentials authenticated by relevant government organizations',
      'Use built-in messaging to discuss requirements with professionals and companies before hiring or awarding a project',
      'Explore key metrics and insights from Pakistan’s IT industry at a glance',
    ],
  },
};

export const ACADEMIA_CONTACT_TEXT =
  'Please contact our support team to request an Academia account. ' +
  'Academia accounts for HEC-recognized universities teaching IT degrees are created and issued by INDUS Tech Connect upon receiving an official request from the institution.';
