"""Execution-capacity policies for bounded browser automation.

Runtime policy measures and limits resources. It does not contain vendor
selectors, application answers, or persistence behavior.
"""

from .resource_governor import (
    BrowserResourceLimits,
    BrowserResourceSnapshot,
    calculate_browser_resource_limits,
    read_browser_resource_snapshot,
)

__all__ = [
    "BrowserResourceLimits",
    "BrowserResourceSnapshot",
    "calculate_browser_resource_limits",
    "read_browser_resource_snapshot",
]
