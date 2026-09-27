"""Twitter login flow: verify the 2FA console challenge is correctly dispatched.

We stub HttpClient entirely — no network. The point is to prove that when the
server replies with ``LoginTwoFactorAuthChallenge``, the flow runner asks the
prompt for the code and echoes it back in the next subtask payload.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from resume_builder.sources.social.auth import Credentials, LoginError, ScriptedPrompt
from resume_builder.sources.social.vendors.twitter import TwitterLogin


class _Cookie:
    def __init__(self, name: str, value: str):
        self.name = name
        self.value = value


class _FakeJar(list):
    pass


def _resp(payload: dict) -> MagicMock:
    r = MagicMock()
    r.text = json.dumps(payload)
    return r


def _make_client(responses, cookies=None):
    client = MagicMock()
    client.cookies = _FakeJar(cookies or [])
    client.post.side_effect = responses
    return client


def test_two_factor_challenge_routes_to_prompt():
    responses = [
        # 1) guest token
        _resp({"guest_token": "GUEST123"}),
        # 2) start flow -> ack instrumentation
        _resp({"flow_token": "T1", "subtasks": [{"subtask_id": "LoginJsInstrumentationSubtask"}]}),
        # 3) after instrumentation ack -> ask username
        _resp({"flow_token": "T2", "subtasks": [{"subtask_id": "LoginEnterUserIdentifierSSO"}]}),
        # 4) after username -> ask password
        _resp({"flow_token": "T3", "subtasks": [{"subtask_id": "LoginEnterPassword"}]}),
        # 5) after password -> 2FA challenge
        _resp({"flow_token": "T4", "subtasks": [{"subtask_id": "LoginTwoFactorAuthChallenge"}]}),
        # 6) after 2FA code -> success
        _resp({"flow_token": "T5", "subtasks": [{"subtask_id": "LoginSuccessSubtask"}]}),
    ]
    client = _make_client(
        responses, cookies=[_Cookie("auth_token", "AT"), _Cookie("ct0", "CT")]
    )
    prompt = ScriptedPrompt(["654321"])

    cookies = TwitterLogin(client=client).run(Credentials("alice", "pw"), prompt)

    assert cookies == {"auth_token": "AT", "ct0": "CT"}
    # The 6th request body must contain the TOTP code we scripted.
    last_call = client.post.call_args_list[-1]
    body = last_call.kwargs.get("json") or {}
    assert body["subtask_inputs"][0]["enter_text"]["text"] == "654321"


def test_acid_subtask_uses_console_prompt():
    responses = [
        _resp({"guest_token": "G"}),
        _resp({"flow_token": "1", "subtasks": [{"subtask_id": "LoginEnterPassword"}]}),
        _resp({"flow_token": "2", "subtasks": [{"subtask_id": "LoginAcid"}]}),
        _resp({"flow_token": "3", "subtasks": [{"subtask_id": "LoginSuccessSubtask"}]}),
    ]
    client = _make_client(responses, cookies=[_Cookie("auth_token", "x")])
    prompt = ScriptedPrompt(["111222"])
    TwitterLogin(client=client).run(Credentials("u", "p"), prompt)
    sms_call = client.post.call_args_list[-1]
    assert sms_call.kwargs["json"]["subtask_inputs"][0]["enter_text"]["text"] == "111222"


def test_denied_subtask_raises():
    responses = [
        _resp({"guest_token": "G"}),
        _resp({"flow_token": "1", "subtasks": [{"subtask_id": "DenyLoginSubtask"}]}),
    ]
    client = _make_client(responses)
    with pytest.raises(LoginError, match="locked or denied"):
        TwitterLogin(client=client).run(Credentials("u", "p"), ScriptedPrompt([]))


def test_missing_guest_token_raises():
    responses = [_resp({})]
    client = _make_client(responses)
    with pytest.raises(LoginError, match="guest token"):
        TwitterLogin(client=client).run(Credentials("u", "p"), ScriptedPrompt([]))
