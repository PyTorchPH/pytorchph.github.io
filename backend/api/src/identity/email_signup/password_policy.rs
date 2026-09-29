//! The password rule every new password must meet (sign-up and seeded test accounts).
//! Sign-in never checks it, so a stored password is judged only by its hash.
//!
//! Module map (caller-first):
//!   meets_password_policy   length window plus the four character classes
//!   ├─ is_within_length     MIN_PASSWORD_LENGTH..=MAX_PASSWORD_LENGTH bytes
//!   └─ has_every_class      lowercase, uppercase, digit, symbol

pub(crate) const MIN_PASSWORD_LENGTH: usize = 8;
pub(crate) const MAX_PASSWORD_LENGTH: usize = 1024;
pub(crate) const PASSWORD_POLICY: &str = "Use at least 8 characters with an uppercase letter, a lowercase letter, a number, and a symbol";

pub(crate) fn meets_password_policy(password: &str) -> bool {
    is_within_length(password) && has_every_class(password)
}

#[inline]
fn is_within_length(password: &str) -> bool {
    (MIN_PASSWORD_LENGTH..=MAX_PASSWORD_LENGTH).contains(&password.len())
}

fn has_every_class(password: &str) -> bool {
    let has = |class: fn(&char) -> bool| password.chars().any(|c| class(&c));
    has(char::is_ascii_lowercase)
        && has(char::is_ascii_uppercase)
        && has(char::is_ascii_digit)
        && has(is_symbol)
}

#[inline]
fn is_symbol(c: &char) -> bool {
    !c.is_alphanumeric() && !c.is_whitespace()
}

#[cfg(test)]
mod tests {
    use super::meets_password_policy;

    #[test]
    fn accepts_a_password_with_every_class() {
        assert!(meets_password_policy("Sample#Pass9"));
    }

    #[test]
    fn rejects_short_or_missing_class_passwords() {
        for weak in [
            "Sh#1a",
            "alllowercase#9",
            "ALLUPPER#9",
            "NoDigits#here",
            "NoSymbol9here",
            "strong-password",
        ] {
            assert!(!meets_password_policy(weak), "{weak} should be rejected");
        }
    }
}
