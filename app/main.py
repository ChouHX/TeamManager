"""
FastAPI application entrypoint for the GPT Team admin console.
"""

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.database import AsyncSessionLocal, close_db, init_db
from app.routes import admin, api, auth, redeem, user, warranty
from app.services.auth import auth_service


BASE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = BASE_DIR / "app"

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def team_ban_polling_loop() -> None:
    """Periodically probe Team accounts and mark banned ones in the background."""
    from app.services.settings import (
        DEFAULT_TEAM_BAN_POLL_INTERVAL_MINUTES,
        settings_service,
    )
    from app.services.team import team_service

    logger.info("Team ban polling loop started")

    while True:
        interval_minutes = DEFAULT_TEAM_BAN_POLL_INTERVAL_MINUTES
        try:
            async with AsyncSessionLocal() as session:
                interval_minutes = await settings_service.get_team_ban_poll_interval_minutes(session)
                result = await team_service.poll_team_ban_statuses(session)

            if result.get("success"):
                logger.info(
                    "Team ban polling finished: checked=%s banned=%s failed=%s next=%smin",
                    result.get("checked_count", 0),
                    result.get("banned_count", 0),
                    result.get("failed_count", 0),
                    interval_minutes,
                )
            else:
                logger.warning("Team ban polling failed: %s", result.get("error"))
        except asyncio.CancelledError:
            logger.info("Team ban polling loop cancelled")
            raise
        except Exception as exc:
            logger.exception("Team ban polling loop error: %s", exc)

        await asyncio.sleep(interval_minutes * 60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize resources on startup and release them on shutdown."""
    from app.services.chatgpt import chatgpt_service

    logger.info("Application startup: initializing database")
    team_ban_polling_task = None

    try:
        db_file = settings.database_url.split("///")[-1]
        Path(db_file).parent.mkdir(parents=True, exist_ok=True)

        await init_db()

        from app.db_migrations import run_auto_migration

        run_auto_migration()

        async with AsyncSessionLocal() as session:
            await auth_service.initialize_admin_password(session)

        team_ban_polling_task = asyncio.create_task(team_ban_polling_loop())
        logger.info("Application startup complete")
    except Exception as exc:
        logger.exception("Application startup failed: %s", exc)

    yield

    if team_ban_polling_task:
        team_ban_polling_task.cancel()
        with suppress(asyncio.CancelledError):
            await team_ban_polling_task

    await chatgpt_service.close()
    await close_db()
    logger.info("Application shutdown complete")


app = FastAPI(
    title="GPT Team Admin",
    description="ChatGPT Team account management and redemption workflow system.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Redirect HTML auth failures to login and keep JSON for API callers."""
    if exc.status_code in [401, 403]:
        accept = request.headers.get("accept", "")
        if "text/html" in accept:
            return RedirectResponse(url="/login")

    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


app.add_middleware(
    SessionMiddleware,
    secret_key=settings.secret_key,
    session_cookie="session",
    max_age=14 * 24 * 60 * 60,
    same_site="lax",
    https_only=False,
)

app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")

templates = Jinja2Templates(directory=str(APP_DIR / "templates"))


def format_datetime(dt):
    """Format a datetime for template rendering."""
    if not dt:
        return "-"
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except Exception:
            return dt

    import pytz

    if dt.tzinfo is not None:
        dt = dt.astimezone(pytz.timezone(settings.timezone))

    return dt.strftime("%Y-%m-%d %H:%M")


def escape_js(value):
    """Escape a string so it can be embedded in JavaScript."""
    if not value:
        return ""
    return (
        value.replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


templates.env.filters["format_datetime"] = format_datetime
templates.env.filters["escape_js"] = escape_js

app.include_router(user.router)
app.include_router(redeem.router)
app.include_router(warranty.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(api.router)


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse(
        "auth/login.html",
        {
            "request": request,
            "user": None,
            "title": "Admin Login",
            "message": "Enter the administrator password to continue.",
        },
    )


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(APP_DIR / "static" / "img" / "favicon.png")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.debug,
    )
