import asyncio
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.webhooks import router as webhook_router
from api.leads import router as leads_router
from api.estimates import router as estimates_router
from api.settings import router as settings_router
from api.sync import router as sync_router
from services.poller import poll_ghl_contacts

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Operations Dashboard API",
    description="Backend for fence staining & pressure washing operations dashboard",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhook_router)
app.include_router(leads_router)
app.include_router(estimates_router)
app.include_router(settings_router)
app.include_router(sync_router)


@app.on_event("startup")
async def start_poller():
    asyncio.create_task(poll_ghl_contacts())


@app.get("/health")
async def health():
    return {"status": "ok"}
