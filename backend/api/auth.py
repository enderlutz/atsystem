"""Dashboard authentication — JWT-based login for internal users."""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from jose import jwt, JWTError
import bcrypt

from db import get_db
from config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)
SECRET_ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 7


class LoginRequest(BaseModel):
    username: str
    password: str


def make_token(user: dict) -> str:
    settings = get_settings()
    payload = {
        "sub": user["username"],
        "name": user["display_name"],
        "role": user["role"],
        "exp": datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, settings.auth_secret, algorithm=SECRET_ALGORITHM)


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        settings = get_settings()
        payload = jwt.decode(creds.credentials, settings.auth_secret, algorithms=[SECRET_ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_admin(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.post("/login")
async def login(body: LoginRequest):
    db = get_db()
    result = db.table("users").select("*").eq("username", body.username).execute()
    user = (result.data or [None])[0]
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {
        "token": make_token(user),
        "user": {
            "username": user["username"],
            "name": user["display_name"],
            "role": user["role"],
        },
    }


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.post("/logout")
async def logout():
    return {"status": "ok"}
