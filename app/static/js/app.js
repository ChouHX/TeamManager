function setDocumentTitleFromHeading() {
  const heading = document.querySelector("h1");
  if (heading?.textContent.trim()) {
    document.title = heading.textContent.trim();
  }
}

function highlightCurrentNav() {
  const path = window.location.pathname;
  document.querySelectorAll(".nav-link, .action-chip, .dropdown-link").forEach((node) => {
    const href = node.getAttribute("href");
    if (href && href === path) {
      node.classList.add("is-active");
    }
  });
}

function showToast(message, tone = "default") {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.className = "pointer-events-none fixed right-3 top-3 z-50 min-w-[220px] rounded-[6px] border px-3 py-2 text-[12px] shadow-panel";
  if (tone === "error") {
    toast.classList.add("border-rose-200", "bg-rose-50", "text-rose-700");
  } else {
    toast.classList.add("border-emerald-200", "bg-emerald-50", "text-emerald-700");
  }
  toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 2400);
}

async function parseJSON(response) {
  try {
    return await response.json();
  } catch (_) {
    return {};
  }
}

async function getJSON(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  const data = await parseJSON(response);
  if (!response.ok) throw new Error(data.detail || data.error || "请求失败");
  return data;
}

async function postJSON(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await parseJSON(response);
  if (!response.ok) throw new Error(data.detail || data.error || "请求失败");
  return data;
}

async function copyText(text) {
  if (!text) return false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    // fallback below
  }

  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "readonly");
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textArea);
    return copied;
  } catch (_) {
    return false;
  }
}

function formToJSON(form) {
  const data = new FormData(form);
  const payload = {};
  for (const [key, value] of data.entries()) {
    payload[key] = typeof value === "string" ? value.trim() : value;
  }
  form.querySelectorAll("input[type='checkbox']").forEach((input) => {
    payload[input.name] = input.checked;
  });
  return payload;
}

function openDialog(dialog) {
  if (dialog && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function setButtonLoading(button, loadingText) {
  if (!button) return () => {};
  const originalText = button.dataset.originalText || button.textContent;
  button.dataset.originalText = originalText;
  button.disabled = true;
  button.dataset.loading = "true";
  if (loadingText) button.textContent = loadingText;

  return () => {
    button.disabled = false;
    button.dataset.loading = "false";
    button.textContent = button.dataset.originalText || originalText;
  };
}

function mountDetailsMenus() {
  const menus = Array.from(document.querySelectorAll(".top-menu, .row-menu"));
  if (!menus.length) return;

  document.addEventListener("click", (event) => {
    menus.forEach((menu) => {
      if (!menu.contains(event.target)) menu.removeAttribute("open");
    });
  });

  menus.forEach((menu) => {
    menu.querySelectorAll(".dropdown-link").forEach((item) => {
      item.addEventListener("click", () => menu.removeAttribute("open"));
    });
  });
}

function formatStatusLabel(status) {
  const labels = {
    active: "正常",
    full: "已满员",
    expired: "已过期",
    error: "异常",
    banned: "已封禁",
    unused: "未使用",
    used: "已使用",
    warranty_active: "质保中",
    joined: "已加入",
    invited: "已邀请",
    pending: "待处理"
  };
  return labels[status] || status || "-";
}

function mountLoginForm() {
  const form = document.getElementById("loginForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = document.getElementById("password");
    const errorMessage = document.getElementById("errorMessage");
    const submitButton = form.querySelector("button[type='submit']");

    errorMessage.classList.add("hidden");
    submitButton.disabled = true;
    submitButton.textContent = "登录中...";

    try {
      await postJSON("/auth/login", { password: password.value });
      window.location.href = "/admin";
    } catch (error) {
      errorMessage.textContent = error.message || "登录失败";
      errorMessage.classList.remove("hidden");
      submitButton.disabled = false;
      submitButton.textContent = "登录";
    }
  });
}

function mountRedeemFlow() {
  const verifyForm = document.getElementById("verifyForm");
  if (!verifyForm) return;

  const step1 = document.getElementById("step1");
  const step2 = document.getElementById("step2");
  const step3 = document.getElementById("step3");
  const teamsList = document.getElementById("teamsList");
  const resultContent = document.getElementById("resultContent");
  const verifyError = document.getElementById("verifyError");
  const emailInput = document.getElementById("email");
  const codeInput = document.getElementById("code");
  const verifyBtn = document.getElementById("verifyBtn");
  const autoSelectBtn = document.getElementById("autoSelectBtn");
  const backBtn = document.getElementById("backBtn");
  const warrantyButton = document.getElementById("checkWarrantyBtn");
  const warrantyInput = document.getElementById("warrantyInput");
  const warrantyResult = document.getElementById("warrantyResult");
  const warrantyContent = document.getElementById("warrantyContent");
  const purchaseEmailInput = document.getElementById("purchaseEmail");
  const creditPurchaseForm = document.getElementById("creditPurchaseForm");
  const creditPurchaseBtn = document.getElementById("creditPurchaseBtn");
  const creditPurchaseResult = document.getElementById("creditPurchaseResult");
  const creditPurchaseContent = document.getElementById("creditPurchaseContent");

  let availableTeams = [];
  let creditPollTimer = null;
  let paidNoticeShown = false;

  function showStep(step) {
    [step1, step2, step3].forEach((node) => node?.classList.add("hidden"));
    step?.classList.remove("hidden");
  }

  function renderTeamsLoading() {
    if (!teamsList) return;
    teamsList.innerHTML = `
      <div class="rounded-[12px] border border-slate-200 bg-slate-50 p-4">
        <div class="flex items-center gap-3">
          <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500"></span>
          <div>
            <div class="text-[13px] font-semibold text-slate-900">正在加载可加入的 Team</div>
            <div class="mt-1 text-[12px] text-slate-500">正在校验兑换码并拉取可用席位，请稍候。</div>
          </div>
        </div>
      </div>
    `;
  }

  async function redeem(teamId) {
    const payload = {
      email: emailInput.value.trim(),
      code: codeInput.value.trim(),
      team_id: teamId
    };
    const data = await postJSON("/redeem/confirm", payload);
    const teamName = data.team_info?.team_name || data.team_info?.name || teamId || "auto";
    showStep(step3);
    resultContent.innerHTML = `
      <div class="rounded-[12px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
        <div class="text-[12px] font-semibold">兑换成功</div>
        <div class="mt-2 text-[12px] leading-6">${data.message || "邀请邮件已发送，请前往邮箱查收 Team 邀请通知。"}</div>
      </div>
      <div class="rounded-[12px] border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-600">
        email=${payload.email}<br>
        code=${payload.code}<br>
        team=${teamName}
      </div>
    `;
  }

  function formatTeamExpiry(expiresAt) {
    if (!expiresAt) return "长期有效";
    const date = new Date(expiresAt);
    if (Number.isNaN(date.getTime())) return expiresAt;
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }

  function renderRedeemLoading(teamId) {
    showStep(step3);
    resultContent.innerHTML = `
      <div class="rounded-[12px] border border-sky-200 bg-sky-50 p-4 text-sky-800">
        <div class="flex items-center gap-3">
          <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600"></span>
          <div>
            <div class="text-[12px] font-semibold">正在提交加入请求</div>
            <div class="mt-1 text-[12px] leading-6">系统正在为你发送 Team 邀请，请稍候。</div>
            <div class="mt-2 text-[11px] font-mono text-sky-700">team_id=${teamId || "auto"}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderTeams(teams) {
    teamsList.innerHTML = "";
    availableTeams = teams || [];
    if (!availableTeams.length) {
      teamsList.innerHTML = `<div class="rounded-[12px] border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-700">当前没有可加入的 Team。</div>`;
      return;
    }

    availableTeams.forEach((team) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "w-full rounded-[12px] border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-sky-300 hover:bg-white";
      card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-[13px] font-semibold text-slate-900">${team.team_name || "未命名 Team"}</div>
            <div class="mt-1 font-mono text-[11px] text-slate-500">id=${team.id} account=${team.account_id || "-"}</div>
            <div class="mt-1 text-[11px] text-slate-500">到期时间：${formatTeamExpiry(team.expires_at)}</div>
          </div>
          <div class="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">${team.current_members}/${team.max_members}</div>
        </div>
      `;
      card.addEventListener("click", async () => {
        try {
          renderRedeemLoading(team.id);
          await redeem(team.id);
        } catch (error) {
          resultContent.innerHTML = `<div class="rounded-[12px] border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-700">${error.message}</div>`;
          showStep(step3);
        }
      });
      teamsList.appendChild(card);
    });
  }

  verifyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    verifyBtn.disabled = true;
    verifyBtn.textContent = "验证中...";
    verifyError.classList.add("hidden");
    renderTeamsLoading();
    step2?.classList.remove("opacity-50");
    showStep(step2);

    try {
      const data = await postJSON("/redeem/verify", {
        code: codeInput.value.trim(),
        email: emailInput.value.trim()
      });
      if (!data.valid) throw new Error(data.reason || "兑换码无效");
      renderTeams(data.teams || []);
      showStep(step2);
    } catch (error) {
      verifyError.textContent = error.message || "验证失败";
      verifyError.classList.remove("hidden");
      showStep(step1);
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = "开始验证";
    }
  });

  autoSelectBtn?.addEventListener("click", async () => {
    try {
      if (!availableTeams.length) throw new Error("当前没有可自动加入的 Team");
      renderRedeemLoading(availableTeams[0].id);
      await redeem(availableTeams[0].id);
    } catch (error) {
      resultContent.innerHTML = `<div class="rounded-[12px] border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-700">${error.message}</div>`;
      showStep(step3);
    }
  });

  backBtn?.addEventListener("click", () => showStep(step1));

  warrantyButton?.addEventListener("click", async () => {
    const raw = warrantyInput.value.trim();
    if (!raw) return;

    try {
      const isEmail = raw.includes("@");
      const data = await postJSON("/warranty/check", isEmail ? { email: raw } : { code: raw });
      warrantyResult.classList.remove("hidden");
      warrantyContent.innerHTML = `
        <div class="rounded-[12px] border border-sky-200 bg-sky-50 p-3">
          <div class="text-[12px] font-semibold text-sky-700">查询结果</div>
          <div class="mt-2 text-[12px] text-slate-700">${data.message || "查询完成"}</div>
          <div class="mt-3 space-y-1 text-[11px] text-slate-600">
            <div>是否含质保：${String(data.has_warranty)}</div>
            <div>质保是否有效：${String(data.warranty_valid)}</div>
            <div>是否可复用：${String(data.can_reuse)}</div>
            <div>原始兑换码：${data.original_code || "-"}</div>
          </div>
        </div>
      `;
    } catch (error) {
      warrantyResult.classList.remove("hidden");
      warrantyContent.innerHTML = `<div class="rounded-[12px] border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-700">${error.message}</div>`;
    }
  });

  creditPurchaseForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = purchaseEmailInput?.value.trim() || "";
    if (!email) {
      showToast("请先填写购买邮箱，再发起席位购买", "error");
      purchaseEmailInput?.focus();
      return;
    }

    creditPurchaseBtn.disabled = true;
    creditPurchaseBtn.textContent = "生成中...";
    if (creditPollTimer) window.clearInterval(creditPollTimer);
    creditPollTimer = null;
    paidNoticeShown = false;

    try {
      const data = await postJSON("/api/credit/purchase-link", { email });
      creditPurchaseResult.classList.remove("hidden");
      creditPurchaseContent.innerHTML = `
        <div id="creditOrderStatusCard" class="rounded-[12px] border border-sky-200 bg-sky-50 p-4 transition-all">
          <div class="text-[12px] font-semibold text-sky-700">支付链接已生成</div>
          <div class="mt-2 text-[11px] text-slate-600">订单号：<span class="font-mono">${data.out_trade_no}</span></div>
          <div class="mt-1 text-[11px] text-slate-600">邮箱：<span class="font-mono">${email}</span></div>
          <div class="mt-1 text-[11px] text-slate-600">标题：${data.title || "-"}</div>
          <div class="mt-1 text-[11px] text-slate-600">积分：${data.price || "-"}</div>
          <div id="creditOrderStatusText" class="mt-2 text-[11px] text-sky-700">等待支付完成...</div>
          <div class="mt-3 break-all text-[11px] text-slate-600">${data.pay_url}</div>
          <div class="mt-3 flex flex-wrap gap-2">
            <a href="${data.pay_url}" target="_blank" rel="noopener noreferrer" class="inline-flex h-[38px] items-center justify-center rounded-[8px] bg-sky-600 px-4 text-[12px] font-semibold text-white">打开支付页面</a>
            <button type="button" id="copyCreditUrlBtn" class="inline-flex h-[38px] items-center justify-center rounded-[8px] border border-slate-300 px-4 text-[12px] font-semibold text-slate-700">复制链接</button>
          </div>
        </div>
      `;

      document.getElementById("copyCreditUrlBtn")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(data.pay_url);
          showToast("支付链接已复制");
        } catch (_) {
          showToast("复制失败，请手动复制链接", "error");
        }
      });

      const pollOrder = async () => {
        try {
          const orderData = await getJSON(`/api/credit/orders/${encodeURIComponent(data.out_trade_no)}`);
          const order = orderData.order || {};
          const statusText = document.getElementById("creditOrderStatusText");
          const card = document.getElementById("creditOrderStatusCard");
          if (!statusText || !card) return;

          if (order.status_text === "paid" && !paidNoticeShown) {
            paidNoticeShown = true;
            statusText.textContent = "积分已到账，正在自动加入 Team...";
            card.classList.add("ring-2", "ring-amber-300");
            showToast("积分划转已到账，系统正在自动为你加入 Team");
          }

          if (order.status_text === "fulfilled") {
            statusText.textContent = "已自动完成加入";
            card.classList.remove("ring-amber-300");
            card.classList.add("ring-2", "ring-emerald-300", "scale-[1.01]");
            showToast("系统已自动为当前邮箱发起 Team 邀请");
            if (creditPollTimer) window.clearInterval(creditPollTimer);
            creditPollTimer = null;
            showStep(step3);
            resultContent.innerHTML = `
              <div class="rounded-[12px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
                <div class="text-[12px] font-semibold">Linux.do 席位购买成功</div>
                <div class="mt-2 text-[12px] leading-6">系统已经为邮箱 <span class="font-mono">${email}</span> 自动匹配可用 Team，并发送邀请邮件。你也可以在右侧通过邮箱查询当前状态。</div>
                <div class="mt-3 text-[11px] font-mono text-emerald-600">order=${data.out_trade_no}</div>
              </div>
            `;
          }
        } catch (_) {
          // 忽略轮询瞬时错误
        }
      };

      await pollOrder();
      creditPollTimer = window.setInterval(pollOrder, 3000);
    } catch (error) {
      creditPurchaseResult.classList.remove("hidden");
      creditPurchaseContent.innerHTML = `<div class="rounded-[12px] border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-700">${error.message}</div>`;
    } finally {
      creditPurchaseBtn.disabled = false;
      creditPurchaseBtn.textContent = "使用 Linux.do 积分购买席位";
    }
  });
}

function mountAdminConsole() {
  const adminRoot = document.querySelector("[data-action], #teamImportForm, #teamBatchImportForm, #codeGenerateForm, #batchCodeGenerateForm, #proxySettingsForm, #logSettingsForm, #teamBanPollingSettingsForm, #webhookSettingsForm, #logoutButton");
  if (!adminRoot) return;

  const membersDialog = document.getElementById("membersDialog");
  const editDialog = document.getElementById("teamEditDialog");
  const teamImportDialog = document.getElementById("teamImportDialog");
  const codeGenerateDialog = document.getElementById("codeGenerateDialog");
  const batchCodeResultDialog = document.getElementById("batchCodeResultDialog");
  const membersTableBody = document.getElementById("membersTableBody");
  const membersModalMeta = document.getElementById("membersModalMeta");
  const memberInviteForm = document.getElementById("memberInviteForm");
  const teamEditForm = document.getElementById("teamEditForm");
  const batchCodeResultCount = document.getElementById("batchCodeResultCount");
  const batchCodeResultTextarea = document.getElementById("batchCodeResultTextarea");
  let activeTeamId = null;
  let refreshAfterBatchCodeResultClose = false;

  function withFormLoading(form, loadingText) {
    const submitButton = form?.querySelector("button[type='submit']");
    return setButtonLoading(submitButton, loadingText);
  }

  function withActionLoading(button, loadingText) {
    return setButtonLoading(button, loadingText);
  }

  async function openMembers(teamId, teamEmail) {
    activeTeamId = teamId;
    openDialog(membersDialog);
    membersModalMeta.textContent = `Team #${teamId} / ${teamEmail || ""}`;
    membersTableBody.innerHTML = `<tr><td colspan="5" class="px-3 py-5 text-center text-[12px] text-slate-500">加载中...</td></tr>`;

    try {
      const data = await getJSON(`/admin/teams/${teamId}/members/list`);
      const members = data.members || [];
      if (!members.length) {
        membersTableBody.innerHTML = `<tr><td colspan="5" class="px-3 py-5 text-center text-[12px] text-slate-500">暂无成员或邀请记录。</td></tr>`;
        return;
      }
      membersTableBody.innerHTML = members.map((item) => `
        <tr>
          <td>${item.email || "-"}</td>
          <td>${item.name || "-"}</td>
          <td>${item.role || "-"}</td>
          <td><span class="badge-status">${formatStatusLabel(item.status)}</span></td>
          <td>
            ${item.status === "joined"
              ? `<button type="button" class="btn-table btn-table-danger" data-action="member-delete" data-user-id="${item.user_id}" data-team-id="${teamId}">移除</button>`
              : `<button type="button" class="btn-table btn-table-danger" data-action="invite-revoke" data-email="${item.email}" data-team-id="${teamId}">撤销</button>`}
          </td>
        </tr>
      `).join("");
    } catch (error) {
      membersTableBody.innerHTML = `<tr><td colspan="5" class="px-3 py-5 text-center text-[12px] text-rose-600">${error.message}</td></tr>`;
    }
  }

  async function openTeamEdit(teamId) {
    if (!teamEditForm || !editDialog) return;
    const data = await getJSON(`/admin/teams/${teamId}/info`);
    const team = data.team || {};
    const tokens = data.tokens || {};

    teamEditForm.dataset.teamId = String(teamId);
    teamEditForm.querySelector("[name='email']").value = team.email || "";
    teamEditForm.querySelector("[name='account_id']").value = team.account_id || "";
    teamEditForm.querySelector("[name='team_name']").value = team.team_name || "";
    teamEditForm.querySelector("[name='subscription_plan']").value = team.subscription_plan || "";
    teamEditForm.querySelector("[name='status']").value = team.status || "";
    teamEditForm.querySelector("[name='access_token']").value = tokens.access_token || "";
    teamEditForm.querySelector("[name='refresh_token']").value = tokens.refresh_token || "";
    teamEditForm.querySelector("[name='session_token']").value = tokens.session_token || "";
    teamEditForm.querySelector("[name='client_id']").value = tokens.client_id || "";

    openDialog(editDialog);
  }

  function attachBackdropClose(dialogs) {
    dialogs.forEach((dialog) => {
      dialog?.addEventListener("click", (event) => {
        const rect = dialog.getBoundingClientRect();
        const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        if (!inside) dialog.close();
      });
    });
  }

  document.querySelectorAll("[data-close-members]").forEach((button) => button.addEventListener("click", () => closeDialog(membersDialog)));
  document.querySelectorAll("[data-close-edit]").forEach((button) => button.addEventListener("click", () => closeDialog(editDialog)));
  document.querySelectorAll("[data-open-dialog]").forEach((button) => button.addEventListener("click", () => openDialog(document.getElementById(button.dataset.openDialog))));
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => closeDialog(document.getElementById(button.dataset.closeDialog))));
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = document.getElementById(button.dataset.tabTarget);
      const wrapper = button.closest("dialog, .tab-scope") || document;
      wrapper.querySelectorAll(".tab-btn").forEach((node) => node.classList.remove("is-active"));
      wrapper.querySelectorAll(".tab-panel").forEach((node) => node.classList.remove("is-active"));
      button.classList.add("is-active");
      panel?.classList.add("is-active");
    });
  });

  attachBackdropClose([membersDialog, editDialog, teamImportDialog, codeGenerateDialog, batchCodeResultDialog]);

  batchCodeResultDialog?.addEventListener("close", () => {
    if (!refreshAfterBatchCodeResultClose) return;
    refreshAfterBatchCodeResultClose = false;
    window.location.reload();
  });

  document.querySelector("[data-copy-batch-codes]")?.addEventListener("click", async () => {
    const copied = await copyText(batchCodeResultTextarea?.value || "");
    showToast(copied ? "鍏戞崲鐮佸凡澶嶅埗" : "澶嶅埗澶辫触", copied ? "default" : "error");
  });

  document.getElementById("batchCodeGenerateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const form = event.currentTarget;
    const resetLoading = withFormLoading(form, "Generating...");

    try {
      const data = await handleCodeGenerate(form);
      const codes = Array.isArray(data.codes) ? data.codes : [];

      if (codes.length) {
        batchCodeResultCount.textContent = String(data.total || codes.length);
        batchCodeResultTextarea.value = codes.join("\n");
        refreshAfterBatchCodeResultClose = true;
        closeDialog(codeGenerateDialog);
        openDialog(batchCodeResultDialog);
      }

      showToast(`Generated ${data.total || codes.length || 0} codes`);
      form.reset();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  }, true);

  document.getElementById("teamBanPollingSettingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const resetLoading = withFormLoading(form, "Saving...");
    const payload = formToJSON(form);
    payload.interval_minutes = Number(payload.interval_minutes || 0);

    try {
      await postJSON("/admin/settings/team-ban-polling", payload);
      showToast("Polling settings saved");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });

  memberInviteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeTeamId) return;
    const resetLoading = withFormLoading(memberInviteForm, "发送中...");
    try {
      await postJSON(`/admin/teams/${activeTeamId}/members/add`, formToJSON(memberInviteForm));
      showToast("邀请已发送");
      memberInviteForm.reset();
      await openMembers(activeTeamId, "");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });

  teamEditForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const teamId = teamEditForm.dataset.teamId;
    const resetLoading = withFormLoading(teamEditForm, "保存中...");
    try {
      await postJSON(`/admin/teams/${teamId}/update`, formToJSON(teamEditForm));
      showToast(`Team #${teamId} 已更新`);
      closeDialog(editDialog);
      window.location.reload();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const teamId = button.dataset.teamId;
    const code = button.dataset.code;
    const recordId = button.dataset.recordId;
    const userId = button.dataset.userId;
    const email = button.dataset.email;
    const teamEmail = button.dataset.teamEmail;
    let resetLoading = () => {};

    try {
      if (action === "team-refresh") {
        resetLoading = withActionLoading(button, "刷新中...");
        await getJSON(`/api/teams/${teamId}/refresh`);
        showToast(`Team #${teamId} 已刷新`);
        window.location.reload();
        return;
      }
      if (action === "team-edit") {
        await openTeamEdit(teamId);
        return;
      }
      if (action === "team-delete") {
        if (!window.confirm(`确认删除 Team #${teamId} 吗？`)) return;
        resetLoading = withActionLoading(button, "删除中...");
        await postJSON(`/admin/teams/${teamId}/delete`, {});
        showToast(`Team #${teamId} 已删除`);
        window.location.reload();
        return;
      }
      if (action === "team-device-auth") {
        resetLoading = withActionLoading(button, "开启中...");
        await postJSON(`/admin/teams/${teamId}/enable-device-auth`, {});
        showToast(`Team #${teamId} 已开启设备代码验证`);
        window.location.reload();
        return;
      }
      if (action === "team-members") {
        await openMembers(teamId, teamEmail);
        return;
      }
      if (action === "code-delete") {
        if (!window.confirm(`确认删除兑换码 ${code} 吗？`)) return;
        resetLoading = withActionLoading(button, "删除中...");
        await postJSON(`/admin/codes/${encodeURIComponent(code)}/delete`, {});
        showToast(`兑换码 ${code} 已删除`);
        window.location.reload();
        return;
      }
      if (action === "record-withdraw") {
        if (!window.confirm(`确认撤回记录 #${recordId} 吗？`)) return;
        resetLoading = withActionLoading(button, "撤回中...");
        await postJSON(`/admin/records/${recordId}/withdraw`, {});
        showToast(`记录 #${recordId} 已撤回`);
        window.location.reload();
        return;
      }
      if (action === "member-delete") {
        resetLoading = withActionLoading(button, "移除中...");
        await postJSON(`/admin/teams/${teamId}/members/${userId}/delete`, {});
        showToast("成员已移除");
        await openMembers(teamId, "");
        return;
      }
      if (action === "invite-revoke") {
        resetLoading = withActionLoading(button, "撤销中...");
        await postJSON(`/admin/teams/${teamId}/invites/revoke`, { email });
        showToast("邀请已撤销");
        await openMembers(teamId, "");
      }
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });

  document.getElementById("teamImportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const resetLoading = withFormLoading(event.currentTarget, "导入中...");
    try {
      await postJSON("/admin/teams/import", formToJSON(event.currentTarget));
      showToast("Team 导入成功");
      event.currentTarget.reset();
      closeDialog(teamImportDialog);
      window.location.reload();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });

  document.getElementById("teamBatchImportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const resetLoading = withFormLoading(form, "导入中...");
    const payload = formToJSON(form);
    const summaryRows = [];
    let finalSummary = "";

    try {
      const response = await fetch("/admin/teams/import", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok || !response.body) {
        const data = await parseJSON(response);
        throw new Error(data.detail || data.error || "批量导入失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        lines.forEach((line) => {
          if (!line.trim()) return;
          const item = JSON.parse(line);
          if (item.type === "progress") {
            const result = item.result || {};
            summaryRows.push(`${item.current}. ${result.email || result.team_id || "项目"} - ${result.success ? "成功" : result.error || "失败"}`);
          }
          if (item.type === "finish") {
            finalSummary = `完成：成功 ${item.success_count || 0}，失败 ${item.failed_count || 0}`;
          }
        });
      }

      const summaryText = [finalSummary, ...summaryRows.slice(-8)].filter(Boolean).join("\n");
      if (summaryText) window.alert(summaryText);
      showToast(finalSummary || "批量导入完成");
      form.reset();
      closeDialog(teamImportDialog);
      window.location.reload();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });

  async function handleCodeGenerate(form) {
    const payload = formToJSON(form);
    if (payload.expires_days === "") delete payload.expires_days;
    else payload.expires_days = Number(payload.expires_days);
    payload.warranty_days = Number(payload.warranty_days || 30);
    if (payload.count !== undefined) payload.count = Number(payload.count || 0);
    return postJSON("/admin/codes/generate", payload);
  }

  document.getElementById("codeGenerateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const resetLoading = withFormLoading(event.currentTarget, "生成中...");
    try {
      const data = await handleCodeGenerate(event.currentTarget);
      showToast(data.code ? `已生成 ${data.code}` : "兑换码已生成");
      event.currentTarget.reset();
      closeDialog(codeGenerateDialog);
      window.location.reload();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });

  document.getElementById("batchCodeGenerateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const resetLoading = withFormLoading(event.currentTarget, "生成中...");
    try {
      const data = await handleCodeGenerate(event.currentTarget);
      if (Array.isArray(data.codes) && data.codes.length) {
        window.alert(`批量生成完成\n总数：${data.total || data.codes.length}\n\n${data.codes.join("\n")}`);
      }
      showToast(`已生成 ${data.total || 0} 个兑换码`);
      event.currentTarget.reset();
      closeDialog(codeGenerateDialog);
      window.location.reload();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });

  document.getElementById("proxySettingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const resetLoading = withFormLoading(event.currentTarget, "保存中...");
    try {
      await postJSON("/admin/settings/proxy", formToJSON(event.currentTarget));
      showToast("代理设置已保存");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });

  document.getElementById("logSettingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const resetLoading = withFormLoading(event.currentTarget, "保存中...");
    try {
      await postJSON("/admin/settings/log-level", formToJSON(event.currentTarget));
      showToast("日志级别已保存");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });

  document.getElementById("webhookSettingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const resetLoading = withFormLoading(event.currentTarget, "保存中...");
    const payload = formToJSON(event.currentTarget);
    payload.low_stock_threshold = Number(payload.low_stock_threshold || 0);
    try {
      await postJSON("/admin/settings/webhook", payload);
      showToast("Webhook 与 API 设置已保存");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });

  document.getElementById("logoutButton")?.addEventListener("click", async () => {
    const resetLoading = setButtonLoading(document.getElementById("logoutButton"), "退出中...");
    try {
      await postJSON("/auth/logout", {});
      window.location.href = "/login";
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      resetLoading();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setDocumentTitleFromHeading();
  highlightCurrentNav();
  mountDetailsMenus();
  mountLoginForm();
  mountRedeemFlow();
  mountAdminConsole();
});
