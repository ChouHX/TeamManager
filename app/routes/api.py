import logging
from typing import Optional

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.services.linuxdo_credit import linuxdo_credit_service
from app.services.team import TeamService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["api"])

team_service = TeamService()


class LinuxDoCreditCreateRequest(BaseModel):
    email: EmailStr = Field(..., description="用户邮箱")


class LinuxDoCreditRefundRequest(BaseModel):
    trade_no: str = Field(..., description="平台订单号")
    money: float = Field(..., description="退款积分数量")
    out_trade_no: Optional[str] = Field(None, description="业务单号")


@router.get("/teams/{team_id}/refresh")
async def refresh_team(
    team_id: int,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    try:
        result = await team_service.sync_team_info(team_id, db, force_refresh=force)
        if not result["success"]:
            return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=result)
        return JSONResponse(content=result)
    except Exception as exc:
        logger.error("刷新 Team 失败: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"success": False, "error": f"刷新 Team 失败: {exc}"},
        )


@router.post("/credit/purchase-link")
async def create_linuxdo_credit_purchase_link(
    request: Request,
    payload: LinuxDoCreditCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        base_url = str(request.base_url).rstrip("/")
        result = await linuxdo_credit_service.create_payment(
            session=db,
            email=payload.email,
            notify_url=f"{base_url}/api/credit/notify",
            return_url=f"{base_url}/credit/callback",
        )
        if not result["success"]:
            return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=result)
        return JSONResponse(content=result)
    except Exception as exc:
        logger.error("创建 Linux.do Credit 支付链接失败: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"success": False, "error": f"创建支付链接失败: {exc}"},
        )


@router.get("/credit/orders/{out_trade_no}")
async def query_linuxdo_credit_order(
    out_trade_no: str,
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await linuxdo_credit_service.query_order(db, out_trade_no)
        if not result["success"]:
            return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=result)
        return JSONResponse(content=result)
    except Exception as exc:
        logger.error("查询 Linux.do Credit 订单失败: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"success": False, "error": f"查询订单失败: {exc}"},
        )


@router.post("/credit/refund")
async def refund_linuxdo_credit_order(
    payload: LinuxDoCreditRefundRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    try:
        result = await linuxdo_credit_service.refund_order(
            session=db,
            trade_no=payload.trade_no,
            money=payload.money,
            out_trade_no=payload.out_trade_no,
        )
        if not result["success"]:
            return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=result)
        return JSONResponse(content=result)
    except Exception as exc:
        logger.error("退款 Linux.do Credit 订单失败: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"success": False, "error": f"退款失败: {exc}"},
        )


@router.get("/credit/notify")
async def linuxdo_credit_notify(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    params = dict(request.query_params)
    config = await linuxdo_credit_service.get_config(db)
    secret = config.get("key") or ""
    if not secret or not linuxdo_credit_service.verify_callback(params, secret):
        logger.warning("Linux.do Credit 回调验签失败: %s", params)
        return PlainTextResponse("fail", status_code=status.HTTP_400_BAD_REQUEST)

    callback_result = await linuxdo_credit_service.handle_paid_callback(db, params)
    if not callback_result.get("success"):
        logger.warning("Linux.do Credit 回调处理失败: %s", callback_result)
        return PlainTextResponse("fail", status_code=status.HTTP_400_BAD_REQUEST)

    logger.info("Linux.do Credit 回调成功: %s", params)
    return PlainTextResponse("success")
