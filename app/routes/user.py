import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["user"])


@router.get("/credit/callback")
async def linuxdo_credit_callback(request: Request):
    """Linux.do 支付后的回跳地址。"""
    query = str(request.url.query).strip()
    target = "/"
    if query:
        target = f"/?{query}"
    return RedirectResponse(url=target, status_code=302)


@router.get("/", response_class=HTMLResponse)
async def redeem_page(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        from app.main import templates
        from app.services.linuxdo_credit import linuxdo_credit_service
        from app.services.team import TeamService

        team_service = TeamService()
        remaining_spots = await team_service.get_total_available_seats(db)
        credit_config = await linuxdo_credit_service.get_public_config(db)

        logger.info("用户访问兑换页面，剩余席位: %s", remaining_spots)

        return templates.TemplateResponse(
            request,
            "user/redeem.html",
            {
                "remaining_spots": remaining_spots,
                "credit_config": credit_config,
                "title": "兑换入口",
                "message": "输入邮箱和兑换码，系统将为你匹配可加入的 Team。",
            },
        )
    except Exception as exc:
        logger.exception("渲染兑换页面失败")
        return HTMLResponse(
            content=f"<h1>页面加载失败</h1><p>{type(exc).__name__}: {exc}</p>",
            status_code=500,
        )
