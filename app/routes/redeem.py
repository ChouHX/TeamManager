import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.redeem_flow import redeem_flow_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/redeem", tags=["redeem"])


class VerifyCodeRequest(BaseModel):
    code: str = Field(..., description="兑换码", min_length=1)
    email: Optional[EmailStr] = Field(None, description="用户邮箱，用于筛选可加入 Team")


class RedeemRequest(BaseModel):
    email: EmailStr = Field(..., description="用户邮箱")
    code: str = Field(..., description="兑换码", min_length=1)
    team_id: Optional[int] = Field(None, description="Team ID，不提供则自动选择")


class TeamInfo(BaseModel):
    id: int
    team_name: str
    current_members: int
    max_members: int
    expires_at: Optional[str]
    subscription_plan: Optional[str]


class VerifyCodeResponse(BaseModel):
    success: bool
    valid: bool
    reason: Optional[str] = None
    teams: List[TeamInfo] = []
    error: Optional[str] = None


class RedeemResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    team_info: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@router.post("/verify", response_model=VerifyCodeResponse)
async def verify_code(
    request: VerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        logger.info("验证兑换码请求: code=%s email=%s", request.code, request.email)
        result = await redeem_flow_service.verify_code_and_get_teams(
            request.code,
            db,
            email=request.email,
            enforce_redeem_seat_limit=True,
        )

        if not result["success"]:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=result["error"],
            )

        return VerifyCodeResponse(
            success=result.get("success", False),
            valid=result.get("valid", False),
            reason=result.get("reason"),
            teams=[TeamInfo(**team) for team in result.get("teams", [])],
            error=result.get("error"),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("验证兑换码失败: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"验证失败: {exc}",
        )


@router.post("/confirm", response_model=RedeemResponse)
async def confirm_redeem(
    request: RedeemRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        logger.info("兑换请求: %s -> Team %s (兑换码: %s)", request.email, request.team_id, request.code)
        result = await redeem_flow_service.redeem_and_join_team(
            request.email,
            request.code,
            request.team_id,
            db,
            enforce_redeem_seat_limit=True,
        )

        if not result["success"]:
            error_msg = result.get("error") or "未知原因"
            if any(kw in error_msg for kw in ["不存在", "已使用", "已过期", "截止时间", "已满", "席位", "质保", "无效", "失效", "maximum number of seats"]):
                error_status = status.HTTP_400_BAD_REQUEST
                if any(kw in error_msg for kw in ["已满", "席位", "maximum number of seats"]):
                    error_status = status.HTTP_409_CONFLICT
                raise HTTPException(status_code=error_status, detail=error_msg)

            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error_msg,
            )

        return RedeemResponse(
            success=result.get("success", False),
            message=result.get("message"),
            team_info=result.get("team_info"),
            error=result.get("error"),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("兑换失败: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"兑换失败: {exc}",
        )
