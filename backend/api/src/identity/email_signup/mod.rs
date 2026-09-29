//! Email and password accounts: sign up with an emailed code, then sign in with a password.
//!
//! Module map:
//!   signup         start_signup (send a code) → verify_signup (create the member, sign in)
//!   login          password_login
//!   credentials    email normalization, password and code hashing, rate limits, hashing slots
//!   relay          the HTTPS mail relay that delivers verification codes
//!   test_accounts  temporary member/officer accounts for an approved production test
mod credentials;
mod login;
mod relay;
mod signup;
mod test_accounts;

pub(crate) use login::password_login;
pub(crate) use relay::RelayConfig;
pub(crate) use signup::{start_signup, verify_signup};
// Inputs and hashes the tests build directly.
pub(crate) use test_accounts::seed_test_accounts;
#[cfg(test)]
pub(crate) use {
    credentials::{code_hash, password_hash},
    login::PasswordLogin,
    signup::SignupVerify,
};
