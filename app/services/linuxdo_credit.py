import hashlib
import logging
import secrets
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from typing import Any, Dict

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LinuxDoCreditOrder, RedemptionCode
from app.services.settings import settings_service
from app.utils.time_utils import get_now

logger = logging.getLogger(__name__)


class LinuxDoCreditService:
    BASE_URL = "https://credit.linux.do/epay"

    async def get_config(self, session: AsyncSession) -> Dict[str, str]:
        return {
            "enabled": await settings_service.get_setting(session, "linuxdo_credit_enabled", "false") or "false",
            "pid": await settings_service.get_setting(session, "linuxdo_credit_pid", "") or "",
            "key": await settings_service.get_setting(session, "linuxdo_credit_key", "") or "",
            "price": await settings_service.get_setting(session, "linuxdo_credit_price", "") or "",
            "default_name": await settings_service.get_setting(session, "linuxdo_credit_default_name", "Linux.do 席位购买") or "Linux.do 席位购买",
        }

    async def get_public_config(self, session: AsyncSession) -> Dict[str, Any]:
        config = await self.get_config(session)
        enabled = str(config["enabled"]).lower() in {"1", "true", "yes", "on"}
        return {
            "enabled": bool(enabled and config["pid"] and config["key"] and config["price"]),
            "price": config["price"],
            "title": config["default_name"],
        }

    def _normalize_money(self, money: Any) -> str:
        try:
            amount = Decimal(str(money)).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
        except (InvalidOperation, ValueError) as exc:
            raise ValueError("积分数量格式不合法") from exc

        if amount <= 0:
            raise ValueError("积分数量必须大于 0")

        return format(amount, "f")

    def _build_sign(self, payload: Dict[str, str], secret: str) -> str:
        items = []
        for key in sorted(payload.keys()):
            value = payload[key]
            if value in (None, "") or key in {"sign", "sign_type"}:
                continue
            items.append(f"{key}={value}")

        raw = "&".join(items) + secret
        return hashlib.md5(raw.encode("utf-8")).hexdigest()

    def verify_callback(self, payload: Dict[str, str], secret: str) -> bool:
        incoming = (payload.get("sign") or "").lower()
        if not incoming:
            return False
        expected = self._build_sign(payload, secret)
        return incoming == expected

    async def create_payment(
        self,
        session: AsyncSession,
        email: str,
        notify_url: str,
        return_url: str,
        out_trade_no: str | None = None,
        device: str = "pc",
    ) -> Dict[str, Any]:
        config = await self.get_config(session)
        enabled = str(config["enabled"]).lower() in {"1", "true", "yes", "on"}
        if not enabled:
            return {"success": False, "error": "Linux.do 积分购席位当前已禁用"}
        if not config["pid"] or not config["key"] or not config["price"]:
            return {"success": False, "error": "Linux.do Credit 尚未完成配置"}

        amount = self._normalize_money(config["price"])
        trade_no = out_trade_no or f"ldc_{secrets.token_hex(8)}"
        order_title = (config["default_name"] or "Linux.do 席位购买")[:64]

        payload = {
            "pid": config["pid"],
            "type": "epay",
            "out_trade_no": trade_no,
            "name": order_title,
            "money": amount,
            "notify_url": notify_url,
            "return_url": return_url,
            "device": device,
            "sign_type": "MD5",
        }
        payload["sign"] = self._build_sign(payload, config["key"])

        async with httpx.AsyncClient(follow_redirects=False, timeout=20.0) as client:
            response = await client.post(
                f"{self.BASE_URL}/pay/submit.php",
                data=payload,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        location = response.headers.get("location")
        if response.is_redirect and location:
            session.add(
                LinuxDoCreditOrder(
                    out_trade_no=trade_no,
                    email=email,
                    title=order_title,
                    money=amount,
                    pay_url=location,
                    status="pending",
                )
            )
            await session.commit()
            return {
                "success": True,
                "out_trade_no": trade_no,
                "pay_url": location,
                "query_url": f"/api/credit/orders/{trade_no}",
                "price": amount,
                "title": order_title,
            }

        try:
            data = response.json()
        except Exception:
            data = {}

        error_msg = data.get("error_msg") or response.text or "创建支付链接失败"
        return {"success": False, "error": error_msg}

    async def query_order(self, session: AsyncSession, out_trade_no: str) -> Dict[str, Any]:
        stmt = select(LinuxDoCreditOrder).where(LinuxDoCreditOrder.out_trade_no == out_trade_no)
        result = await session.execute(stmt)
        local_order = result.scalar_one_or_none()

        if not local_order:
            return {"success": False, "error": "订单不存在"}

        config = await self.get_config(session)
        if config["pid"] and config["key"]:
            params = {
                "act": "order",
                "pid": config["pid"],
                "key": config["key"],
                "out_trade_no": out_trade_no,
            }
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    response = await client.get(f"{self.BASE_URL}/api.php", params=params)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("code") == 1:
                        local_order.trade_no = data.get("trade_no") or local_order.trade_no
                        if int(data.get("status", 0)) == 1 and local_order.status == "pending":
                            local_order.status = "paid"
                        await session.commit()
            except Exception:
                logger.exception("查询 Linux.do 远端订单失败: %s", out_trade_no)

        return {
            "success": True,
            "order": {
                "out_trade_no": local_order.out_trade_no,
                "trade_no": local_order.trade_no,
                "name": local_order.title,
                "money": local_order.money,
                "email": local_order.email,
                "status": 1 if local_order.status == "fulfilled" else 0,
                "status_text": local_order.status,
                "pay_url": local_order.pay_url,
            },
        }

    async def refund_order(
        self,
        session: AsyncSession,
        trade_no: str,
        money: Any,
        out_trade_no: str | None = None,
    ) -> Dict[str, Any]:
        config = await self.get_config(session)
        if not config["pid"] or not config["key"]:
            return {"success": False, "error": "Linux.do Credit 尚未完成配置"}

        payload = {
            "pid": config["pid"],
            "key": config["key"],
            "trade_no": trade_no,
            "money": self._normalize_money(money),
        }
        if out_trade_no:
            payload["out_trade_no"] = out_trade_no

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(f"{self.BASE_URL}/api.php", json=payload)

        data = response.json()
        if data.get("code") != 1:
            return {"success": False, "error": data.get("msg") or "退款失败"}

        return {"success": True, "message": data.get("msg") or "退款成功"}

    async def handle_paid_callback(self, session: AsyncSession, payload: Dict[str, str]) -> Dict[str, Any]:
        out_trade_no = payload.get("out_trade_no") or payload.get("trade_no")
        trade_no = payload.get("trade_no")
        if not out_trade_no:
            return {"success": False, "error": "缺少订单号"}

        stmt = select(LinuxDoCreditOrder).where(LinuxDoCreditOrder.out_trade_no == out_trade_no)
        result = await session.execute(stmt)
        order = result.scalar_one_or_none()
        if not order:
            return {"success": False, "error": "订单不存在"}

        order.trade_no = trade_no or order.trade_no
        if order.status == "fulfilled":
            await session.commit()
            return {"success": True, "status": "fulfilled", "email": order.email, "out_trade_no": order.out_trade_no}

        order.status = "paid"
        if not order.redeem_code:
            order.redeem_code = f"LDC{out_trade_no.replace('_', '').replace('-', '')}"[:32]
        await session.flush()

        code_stmt = select(RedemptionCode).where(RedemptionCode.code == order.redeem_code)
        code_result = await session.execute(code_stmt)
        redeem_code = code_result.scalar_one_or_none()
        if not redeem_code:
            session.add(
                RedemptionCode(
                    code=order.redeem_code,
                    status="unused",
                    created_at=get_now(),
                )
            )
            await session.flush()

        await session.commit()

        from app.services.redeem_flow import redeem_flow_service

        redeem_result = await redeem_flow_service.redeem_and_join_team(
            email=order.email,
            code=order.redeem_code,
            team_id=None,
            db_session=session,
        )
        if not redeem_result.get("success"):
            order.status = "paid"
            await session.commit()
            return {"success": False, "error": redeem_result.get("error") or "自动加入 Team 失败"}

        order.status = "fulfilled"
        await session.commit()
        return {
            "success": True,
            "status": "fulfilled",
            "email": order.email,
            "out_trade_no": order.out_trade_no,
            "message": redeem_result.get("message"),
        }


linuxdo_credit_service = LinuxDoCreditService()
