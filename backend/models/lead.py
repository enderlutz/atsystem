from pydantic import BaseModel
from typing import Any, Optional
from datetime import datetime
from enum import Enum


class ServiceType(str, Enum):
    fence_staining = "fence_staining"
    pressure_washing = "pressure_washing"


class LeadStatus(str, Enum):
    new = "new"
    estimated = "estimated"
    approved = "approved"
    rejected = "rejected"
    sent = "sent"


class Lead(BaseModel):
    id: str
    ghl_contact_id: str
    service_type: ServiceType
    status: LeadStatus
    address: str
    form_data: dict[str, Any]
    contact_name: str = ""
    contact_phone: str = ""
    contact_email: str = ""
    priority: str = "MEDIUM"
    urgency_level: str = ""
    customer_responded: bool = False
    customer_response_text: str = ""
    tags: list[str] = []
    va_notes: str = ""
    created_at: datetime


class LeadDetail(Lead):
    estimate: Optional[Any] = None
