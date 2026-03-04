from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql://localhost/atsystem"

    supabase_url: str = ""
    supabase_service_key: str = ""

    ghl_api_key: str = ""
    ghl_location_id: str = ""

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""

    resend_api_key: str = ""

    owner_phone: str = ""
    owner_email: str = ""

    frontend_url: str = "http://localhost:3000"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
