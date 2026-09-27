"""Local-only black-box process verification; never imported by product code."""

from .contracts import BrowserJourneyResult, ServiceCheckResult

__all__ = ["BrowserJourneyResult", "ServiceCheckResult"]
