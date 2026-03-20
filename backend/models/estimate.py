from __future__ import annotations

from pydantic import BaseModel
from typing import Any, Optional
from datetime import datetime
from enum import Enum

from models.lead import ServiceType


class EstimateStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    adjusted = "adjusted"


class BreakdownItem(BaseModel):
    label: str
    value: float
    note: Optional[str] = None


class Estimate(BaseModel):
    id: str
    lead_id: str
    service_type: ServiceType
    status: EstimateStatus
    estimate_low: float
    estimate_high: float
    owner_notes: Optional[str] = None
    additional_services_sent: bool = False
    created_at: datetime
    approved_at: Optional[datetime] = None
    lead: Optional[Any] = None


class EstimateDetail(Estimate):
    inputs: dict[str, Any]
    breakdown: list[BreakdownItem]


class EstimateAdjust(BaseModel):
    estimate_low: float
    estimate_high: float
    owner_notes: Optional[str] = None


class EstimateReject(BaseModel):
    notes: Optional[str] = None


class EstimateApprove(BaseModel):
    selected_tier: str = "signature"
    force_send: bool = False  # bypass the customer-responded guardrail
    bypass_approval: bool = False  # VA bypass for RED estimates
    bypass_password: str | None = None  # VA must enter password to confirm bypass


class AdminApproveRequest(BaseModel):
    essential: float | None = None
    signature: float | None = None
    legacy: float | None = None
    notes: str | None = None
    force_send: bool = False
