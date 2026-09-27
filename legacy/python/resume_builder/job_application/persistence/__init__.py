"""Durable job-application knowledge and idempotency boundaries.

Persistence modules store validated facts and observations. They do not decide
answers or perform browser actions.
"""

from .questionnaire_store import (
    DEFAULT_MONGODB_DATABASE,
    DEFAULT_MONGODB_URI,
    MongoQuestionnaireRepository,
)
from .application_profile_store import (
    ApplicationProfileStore,
    OnboardingPreferences,
    StoredResumeRoute,
    VerifiedApplicationIdentity,
)

__all__ = [
    "ApplicationProfileStore",
    "DEFAULT_MONGODB_DATABASE",
    "DEFAULT_MONGODB_URI",
    "MongoQuestionnaireRepository",
    "OnboardingPreferences",
    "StoredResumeRoute",
    "VerifiedApplicationIdentity",
]
