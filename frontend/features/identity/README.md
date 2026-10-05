# Identity UI

Status: login, signup credentials, Google login, and session shell exist. Email-link verification,
mailbox onboarding, guardian approval, and recovery views are target additions.

## UI routes and components

Keep identity UI inside this feature and keep transport calls behind its API module.

| Experience | Implementation home |
| --- | --- |
| Manual signup and handle selection | `session/credentials/` plus new verification components |
| Google signup/linking | existing Google button and callback flow |
| Verification-link result | new `verification/` folder |
| Local password setup/reset | new `password/` folder |
| Guardian pending/review result | new `guardian/` folder |
| Mail-client onboarding | new `mailbox/` folder |
| Account deletion/recovery | account settings view using identity gateway routes |

## Product rules

- Manual signup sends a 15-minute single-use email link; do not implement numeric OTP or phone OTP.
- Google `email_verified` replaces that link, but a local PyTorch/mail password is still required.
- Explain that the local password is not the user's Gmail/Outlook password.
- Do not display whether an unrelated email already has an account.
- Under-18 accounts show a pending guardian-review state and no mailbox credentials.
- Mailbox onboarding documents IMAP 993 TLS and SMTP 587 STARTTLS for `mail.pytorch.ph`.
- Gmail mobile, Outlook, and Thunderbird are supported clients; Gmail web is not represented as full
  IMAP synchronization.

## Privacy

Collect only fields needed for the declared flow. Legal name and personal email are rendered only in
authorized identity views. Analytics/profile UI uses age with `recorded_on`, coded school/program,
education level/year, broad region, and public handle. Provide a child-friendly privacy notice when
age is below 18.

## Tests

Test accessible validation, generic account-existence messaging, expired/replayed links, Google
linking, password setup, guardian pending state, recovery, mail-client instructions, and redaction of
private identity fields from portal responses.
