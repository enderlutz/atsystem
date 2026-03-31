from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql://localhost/atsystem"

    supabase_url: str = ""
    supabase_service_key: str = ""

    ghl_api_key: str = ""
    ghl_location_id: str = ""        # Cypress
    ghl_api_key_2: str = ""           # Woodlands API key (if separate from primary)
    ghl_location_id_2: str = ""      # Woodlands (optional — set to enable)
    ghl_location_2_pipeline: str = "FENCE STAINING NEW AUTOMATION FLOW"
    ghl_location_1_label: str = "Cypress"
    ghl_location_2_label: str = "Woodlands"

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""

    resend_api_key: str = ""

    owner_phone: str = ""
    owner_email: str = ""

    frontend_url: str = "http://localhost:3000"
    proposal_base_url: str = "http://localhost:3000"

    owner_ghl_contact_id: str = ""

    google_maps_api_key: str = ""
    google_review_link: str = ""
    google_calendar_credentials_json: str = ""
    google_calendar_id: str = "primary"

    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None

    auth_secret: str = "change-me-in-production"

    # GHL pipeline stage ID to move opportunities to when a booking is made.
    # Find this in GHL: Settings → Pipelines → hover over stage → copy ID.
    ghl_booked_stage_id: str = ""

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
