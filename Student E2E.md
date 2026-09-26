open the link "https://portal.industechconnect.pk/login"
then click on the signup text it will take you to the  url " https://portal.industechconnect.pk/create-account"
then clcik on the IT student card and then click on the create account it open the student registration form 
that have the field Name with the place holder "Enter your full name"
CNIC with the place holder Enter 13-digit CNIC (no dashes)
Date of Birth with the formate mm/dd/yyyy
Gender have radio button have three option male female and others select the female from one of this 
Email with the place holder Enter your email address
Phone Number with the place holder Enter your phone number with the selected number code PK | +92
Password with the place holder ******** and with eye icon when enter the password it should be hideded and have 10 charater if less then 8 chaarter it should show error 
Confirm Password with placeholder ******** the password should match with the password 
University a drop down open slecte one from this 

Enter data are 
Name=>
CNIC=>
Enter 13-digit CNIC (no dashes) =>1234567892345
Date of Birth => mm/dd/yyyy 09/12/1999
Gender=> female
Email =>zanibtahir@yopmail.com
Phone Number=> 03349765439
Enter your phone number
Password=> 1234567890
Confirm Password=> 1234567890
University=> Air University
click on the create account 
it open the otp page 

Open the https://yopmail.com/wm for this email and get the 6 didgit otp 

enetr the otp that you fetch fromt yopmail

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
Continue working inside the existing INDUS Tech Connect project and modify the files/components I am currently working on. Do not create a separate demo or standalone implementation unless the existing project structure requires a new reusable component.

First inspect the existing codebase, current dashboard implementation, routing, components, styling conventions, state management, and API patterns. Reuse the current architecture and design system.

IMPORTANT:

Add this functionality directly into the existing dashboard flow.

Preserve all existing working functionality.

Do not unnecessarily rewrite unrelated code.

Whenever you add NEW code, add clear and concise code comments explaining the new logic.

Do not add comments to every line. Comment only important sections, conditions, state handling, API logic, and new workflow behavior.

Follow the existing project coding conventions.

Make the UI responsive.

Use the existing INDUS Tech Connect design system, colors, typography, buttons, cards, modal components, and spacing wherever possible.

Required User Flow

After a user successfully logs in/registers and reaches the dashboard, show a User Journey / Welcome popup before showing the profile activation checklist.

Step 1 — User Journey Popup

Show a modal/onboarding popup with:

Heading:

"Welcome to INDUS Tech Connect"

At the top-left corner of the popup show:

"Skip preview"

Main onboarding content:

"Build a trusted professional profile"

Description:

"Create a profile that presents your identity, experience, skills, education, or organization clearly."

Next onboarding content:

"Complete your role-specific profile"

Description:

"Verify eligible identity and credentials"

At the bottom-left area show a:

"Next"

button.

Onboarding Behaviour

The onboarding/journey can end in two ways:

The user goes through the journey and clicks the final "Next" button.

The user clicks "Skip preview".

In both cases:

Mark the onboarding preview as completed/skipped appropriately.

Close the onboarding popup.

Do not automatically show the onboarding popup again for that user after it has already been completed or skipped.

Persist this state using the existing backend/database/API mechanism if one already exists.

If no backend mechanism currently exists, inspect the project and implement the cleanest maintainable solution compatible with the existing architecture.

Do not rely only on temporary React state because the onboarding should not continuously reappear after refresh/login.

Step 2 — Profile Activation Checklist

After the onboarding journey has been completed or skipped, show the activation section on the dashboard.

Heading:

"Activate your INDUS Tech Connect profile"

Description:

"Complete the required steps to activate your profile. Optional steps can be completed at any time."

Show dynamic progress:

"0 of 4 completed"

The completed count must update automatically according to the actual user's status.

There are four activation steps.

1. Verify Identity with PakID

Title:

"Verify your identity with PakID"

Description:

"Complete the one-time identity verification through NADRA."

Button:

"Verify with PakID"

The state of this item should update when PakID verification is completed.

2. Complete Profile

Title:

"Complete your profile"

Description:

"Add the required information to bring your profile completion to at least 80%. Your profile is currently [X]% complete."

IMPORTANT:
[X]% must be dynamic.

For example:

"Your profile is currently 56% complete."

Do not hardcode the percentage.

Use the profile completion percentage already available in the project/API if possible. If the calculation is not currently available, inspect the current profile fields and existing completion logic before introducing new calculations.

Button:

"Complete Profile"

This should navigate the user to the appropriate profile completion/edit page.

The step should be treated as complete when profile completion reaches at least 80%.

3. Verify with PSEB — Optional

Title:

"Verify with PSEB (Optional)"

Description:

"Connect and verify your PSEB registration."

Button:

"Verify with PSEB"

This is an optional step.

The UI should clearly distinguish optional steps from mandatory activation requirements.

4. Talent Hub Consent — Optional

Title:

"Give consent for Talent Hub (Optional)"

Description:

"Allow your profile to be displayed in the Talent Hub directory."

Button:

"Give Consent"

This is also optional.

Use the existing Talent Hub consent state/API if already implemented.

Progress Behaviour

The progress count must dynamically reflect completion.

Examples:

"0 of 4 completed"
"1 of 4 completed"
"2 of 4 completed"
"3 of 4 completed"
"4 of 4 completed"

Each step should visually indicate its state, such as:

Pending

Completed

Optional

Verification in progress, if applicable

Reuse the project's existing UI patterns rather than introducing a completely different visual style.

Existing INDUS Access Logic

Do not break the existing role-specific access logic.

For Students and IT Professionals, the important activation requirements include:

PakID verification

Minimum 80% profile completion

PSEB verification and Talent Hub consent are optional within this checklist unless existing backend business rules specify otherwise.

Keep the implementation extensible for other stakeholder roles.

