// The Terms and Conditions and the Privacy Notice, as data so any consent checkbox can show them.
// Module map (caller-first):
//   LEGAL_DOCUMENTS   terms · privacy, each a title, summary and ordered sections
//   LegalDocument / LegalSection   the shape a dialog renders
// Draft wording that describes how the portal actually works; officers should have it reviewed.

export type LegalSection = { heading: string; paragraphs: string[] };

export type LegalDocument = { title: string; summary: string; updated: string; sections: LegalSection[] };

export type LegalDocumentKey = "terms" | "privacy";

const UPDATED = "September 30, 2026";

export const LEGAL_DOCUMENTS: Record<LegalDocumentKey, LegalDocument> = {
  terms: {
    title: "Terms and Conditions",
    summary: "The rules for using the PyTorch Philippines member portal.",
    updated: UPDATED,
    sections: [
      { heading: "1. About these terms", paragraphs: [
        "These terms apply to your PyTorch Philippines (PyTorch PH) account and to the member portal, leaderboard, events and browser extension. By creating an account you agree to them.",
      ] },
      { heading: "2. Your account", paragraphs: [
        "Give accurate details and keep your password private. One person, one account. You are responsible for activity on your account; tell the officers right away if you think someone else used it.",
        "New accounts become members at once. Officer roles are assigned separately by the organization.",
      ] },
      { heading: "3. Evidence and the leaderboard", paragraphs: [
        "Submit only evidence of your own work that is true and that you have the right to share. Officers review submissions and may reject them, remove points, or apply sanctions for false, copied or manipulated evidence. You can appeal a decision from the portal.",
        "Your leaderboard username and standing are public unless you choose anonymous ranking in Settings.",
      ] },
      { heading: "4. Acceptable use", paragraphs: [
        "Do not harass other members, post unlawful or harmful content, try to access accounts or data that are not yours, disrupt the service, or automate requests beyond normal use.",
      ] },
      { heading: "5. Your content", paragraphs: [
        "You keep ownership of what you submit. You let PyTorch PH store and display it as needed to run the portal, for example to review evidence or show your public profile.",
      ] },
      { heading: "6. AI features", paragraphs: [
        "AI provider keys stay in your browser extension and are never sent to or stored on PyTorch PH servers. You are responsible for your use of any third-party AI provider under its own terms.",
      ] },
      { heading: "7. Ending your account", paragraphs: [
        "You can delete your account anytime in Settings; this removes your account data. Officers may suspend or remove accounts that break these terms.",
      ] },
      { heading: "8. No warranty", paragraphs: [
        "PyTorch PH is a volunteer community. The portal is provided as is, without guarantees of availability or fitness for a particular purpose, to the extent the law allows.",
      ] },
      { heading: "9. Changes", paragraphs: [
        "We may update these terms. When we make significant changes we will tell members through the portal; continuing to use it means you accept the updated terms.",
      ] },
    ],
  },
  privacy: {
    title: "Privacy Notice",
    summary: "How PyTorch PH handles your personal data under the Data Privacy Act of 2012 (RA 10173).",
    updated: UPDATED,
    sections: [
      { heading: "1. What we collect", paragraphs: [
        "Account details: your name, email, leaderboard username, and a securely hashed password or your Google sign-in identity.",
        "Profile details you give when completing your profile: gender, age range, region, whether you study or work, school or company, industry, interests and how you heard about us.",
        "Activity in the portal: evidence you submit, event participation, leaderboard points, and bug reports you choose to send.",
      ] },
      { heading: "2. Why we use it", paragraphs: [
        "To run your account and the portal, review evidence, rank the leaderboard, organize events, and keep the service secure. With your separate consent, your profile answers are also counted in anonymous demographic statistics that help officers plan programs.",
      ] },
      { heading: "3. Sensitive personal information", paragraphs: [
        "Your age and education are sensitive personal information under RA 10173. We collect them only with your consent, every question offers a “prefer not to say” style answer, and they are never shown to other members.",
      ] },
      { heading: "4. Who can see it", paragraphs: [
        "Other members see only your public leaderboard profile. Officers see what they need to review evidence and manage the organization. Demographic reports show only groups of five or more people, so no individual can be singled out.",
        "We do not sell your data. We share it only when the law requires it.",
      ] },
      { heading: "5. How long we keep it", paragraphs: [
        "We keep your data while your account is active. Deleting your account removes your account, profile and related records, except records we must keep by law.",
      ] },
      { heading: "6. How we protect it", paragraphs: [
        "Passwords are hashed, sessions use secure cookies, and access to officer tools is limited by role. AI provider keys never leave your browser extension.",
      ] },
      { heading: "7. Your rights", paragraphs: [
        "Under RA 10173 you have the right to be informed, to access, to correct, to object, to erase or block, to data portability, and to claim damages. You can correct your profile or withdraw analytics consent anytime in Settings, and delete your account there.",
        "For other requests, contact the PyTorch PH officers through the portal’s report form. You may also file a complaint with the National Privacy Commission.",
      ] },
    ],
  },
};
