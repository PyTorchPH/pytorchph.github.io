use super::*;

#[test]
fn accepts_the_complete_typed_identity_service_wire_contract() {
    let member_id = Uuid::new_v4();
    for status in ["pending_credentials", "active", "disabled"] {
        let mut reply = valid_reply(member_id);
        reply["status"] = status.into();
        assert_eq!(
            decode(&reply, member_id).unwrap().address,
            "synthetic@pytorch.ph"
        );
    }
}

#[test]
fn rejects_missing_and_wrong_typed_fields_instead_of_accepting_partial_contracts() {
    let member_id = Uuid::new_v4();
    for field in ["memberId", "localPart", "address", "status"] {
        let mut missing = valid_reply(member_id);
        missing.as_object_mut().unwrap().remove(field);
        assert!(decode(&missing, member_id).is_err(), "missing {field}");
        for value in [
            serde_json::Value::Null,
            serde_json::json!(1),
            serde_json::json!(true),
            serde_json::json!([]),
        ] {
            let mut wrong_type = valid_reply(member_id);
            wrong_type[field] = value;
            assert!(
                decode(&wrong_type, member_id).is_err(),
                "wrong type for {field}"
            );
        }
    }
    let mut unexpected = valid_reply(member_id);
    unexpected["privateUnexpectedField"] = "private-upstream-value".into();
    assert!(decode(&unexpected, member_id).is_err());
}

#[test]
fn rejects_invalid_or_foreign_member_identifiers_and_unknown_mailbox_statuses() {
    let member_id = Uuid::new_v4();
    for value in ["not-a-uuid".to_owned(), Uuid::new_v4().to_string()] {
        let mut reply = valid_reply(member_id);
        reply["memberId"] = value.into();
        assert!(decode(&reply, member_id).is_err());
    }
    let mut reply = valid_reply(member_id);
    reply["status"] = "unexpected".into();
    assert!(decode(&reply, member_id).is_err());
}

#[test]
fn rejects_address_binding_domain_case_and_length_mismatches() {
    let member_id = Uuid::new_v4();
    for (local_part, address) in [
        ("synthetic".to_owned(), "foreign@pytorch.ph".to_owned()),
        ("synthetic".to_owned(), "synthetic@example.test".to_owned()),
        ("UpperCase".to_owned(), "UpperCase@pytorch.ph".to_owned()),
        ("has space".to_owned(), "has space@pytorch.ph".to_owned()),
        ("a".to_owned(), "a@pytorch.ph".to_owned()),
        ("a".repeat(65), format!("{}@pytorch.ph", "a".repeat(65))),
    ] {
        let mut reply = valid_reply(member_id);
        reply["localPart"] = local_part.into();
        reply["address"] = address.into();
        assert!(decode(&reply, member_id).is_err());
    }
}

fn valid_reply(member_id: Uuid) -> serde_json::Value {
    serde_json::json!({
        "memberId":member_id.to_string(), "localPart":"synthetic",
        "address":"synthetic@pytorch.ph", "status":"pending_credentials"
    })
}

fn decode(
    reply: &serde_json::Value,
    member_id: Uuid,
) -> Result<OrganizationMailbox, IdentityError> {
    decode_reply(&serde_json::to_vec(reply).unwrap(), member_id)
}
