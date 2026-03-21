import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from api.auth import router as auth_router
from api.webhooks import router as webhook_router
from api.leads import router as leads_router
from api.estimates import router as estimates_router
from api.settings import router as settings_router
from api.sync import router as sync_router
from api.proposals import router as proposals_router
from api.schedule import router as schedule_router
from api.workflow import router as workflow_router
from services.poller import poll_ghl_contacts
from services.sms_worker import poll_sms_queue, poll_stage_timeouts

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(poll_ghl_contacts())
    asyncio.create_task(poll_sms_queue())
    asyncio.create_task(poll_stage_timeouts())
    yield


app = FastAPI(
    title="Operations Dashboard API",
    description="Backend for fence staining & pressure washing operations dashboard",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://admin.atpressurewash.com", "https://proposal.atpressurewash.com"],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(webhook_router)
app.include_router(leads_router)
app.include_router(estimates_router)
app.include_router(settings_router)
app.include_router(sync_router)
app.include_router(proposals_router)
app.include_router(schedule_router)
app.include_router(workflow_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
