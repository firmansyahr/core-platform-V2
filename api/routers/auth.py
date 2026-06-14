from datetime import datetime, timedelta, timezone
from pathlib import Path
import json

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel

SECRET_KEY = "core-platform-v2-secret-key-2026"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 8

USERS_FILE = Path("api/core/users.json")

router = APIRouter(prefix="/api/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str
    expires_in: int


class UserInfo(BaseModel):
    username: str
    name: str
    role: str


def _load_users() -> dict:
    with open(USERS_FILE, encoding="utf-8") as f:
        return json.load(f)


def _verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def _create_token(sub: str, name: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": sub, "name": name, "role": role, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def _get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserInfo:
    if creds is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token tidak ditemukan")
    try:
        payload = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token tidak valid")
        return UserInfo(
            username=username,
            name=payload.get("name", username),
            role=payload.get("role", "viewer"),
        )
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token tidak valid atau kadaluarsa")


@router.post("/login", response_model=Token)
def login(req: LoginRequest) -> Token:
    users = _load_users()
    user = users.get(req.username)
    if not user or not _verify_password(req.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username atau password salah",
        )
    token = _create_token(
        sub=req.username,
        name=user["name"],
        role=user["role"],
    )
    return Token(
        access_token=token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
    )


@router.get("/me", response_model=UserInfo)
def get_me(user: UserInfo = Depends(_get_current_user)) -> UserInfo:
    return user
