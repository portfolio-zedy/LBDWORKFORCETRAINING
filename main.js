// ============================================================
//  LIVING BY DESIGN NATION — MAIN JAVASCRIPT
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycby_9iOJuOAmTlRh_MdKFvYraBIEoyu7TydALdsNTJo-MXBjhndrt1cxbLMg1Eo8qSetcg/exec";

// Global Shared Variables
let user, allProgress = [], pendingReviews = [], allUsers = [], allCourses = [], milestones = [], progress = [];
let filteredProgress = [], lastGroupedMembers = [];
let currentCourse = null;
let userRoadmap = [];
let totalCurriculumMilestones = 0;

// Video Tracking Globals
let ytPlayers = {};
let vimeoPlayers = {};
let ytApiLoading = false;
let pendingYTInits = [];
let cinemaActiveMid = null;
let vimeoApiPromise = null;

// Login Mode State
let currentLoginMode = 'email';

// ==========================================
// SHARED UTILITIES
// ==========================================
async function apiCall(action, payload = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, ...payload })
  });
  return await res.json();
}

function getSession() {
  try { return JSON.parse(sessionStorage.getItem("wtp_user")); } catch { return null; }
}
function setSession(userObj) { sessionStorage.setItem("wtp_user", JSON.stringify(userObj)); }
function clearSession() { sessionStorage.removeItem("wtp_user"); }
function logout() { clearSession(); window.location.href = "index.html"; }

function requireAuth(allowedRoles) {
  const currentUser = getSession();
  if (!currentUser) { window.location.href = "login.html"; return null; }
  if (allowedRoles && !allowedRoles.includes(currentUser.role)) {
    alert("Access denied.");
    window.location.href = "login.html";
    return null;
  }
  return currentUser;
}

function hidePageLoader() {
  const loader = document.getElementById("pageLoader");
  if (loader) loader.classList.add("page-loader--hidden");
}

function setBtnLoading(btn, text) {
  if (!btn) return;
  if (btn.dataset.originalHtml === undefined) btn.dataset.originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="btn-spinner"></span>${text}`;
}

function resetBtn(btn) {
  if (!btn) return;
  btn.disabled = false;
  if (btn.dataset.originalHtml !== undefined) btn.innerHTML = btn.dataset.originalHtml;
}

function showToast(message, type = "info") {
  const existing = document.querySelector(".wtp-toast");
  if (existing) existing.remove();

  const icons = { success: "✓", error: "✕", info: "ℹ" };
  const toast = document.createElement("div");
  toast.className = `wtp-toast wtp-toast--${type}`;
  toast.innerHTML = `<span class="wtp-toast-icon">${icons[type] || "ℹ"}</span><span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("wtp-toast--visible"), 10);
  setTimeout(() => {
    toast.classList.remove("wtp-toast--visible");
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

function statusBadge(status) {
  const map = {
    LOCKED:    ["🔒", "badge--locked",    "Locked"],
    UNLOCKED:  ["📖", "badge--unlocked",  "In Progress"],
    SUBMITTED: ["⏳", "badge--submitted", "Awaiting Review"],
    PASSED:    ["✅", "badge--passed",    "Passed"],
    FAILED:    ["❌", "badge--failed",    "Not Passed"],
  };
  const [icon, cls, label] = map[status] || ["❓","","Unknown"];
  return `<span class="badge ${cls}">${icon} ${label}</span>`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {day:"2-digit",month:"short",year:"numeric"});
}

function escHtml(str) {
  return (str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Milestone content_html is authored by TEACHER/ADMIN accounts and rendered
// via innerHTML for every enrolled learner. Facilitator accounts are
// self-registered (admin-approved, not code-reviewed), so this field is
// untrusted input as far as the browser is concerned. Sanitize it to a safe
// allow-list before it ever touches the DOM.
let _dompurifyHookInstalled = false;
function sanitizeContentHtml(html) {
  if (!html) return "";
  if (window.DOMPurify) {
    if (!_dompurifyHookInstalled) {
      DOMPurify.addHook("afterSanitizeAttributes", node => {
        if (node.tagName === "A") {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      });
      _dompurifyHookInstalled = true;
    }
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["h1","h2","h3","h4","h5","h6","p","br","hr","strong","b","em","i","u",
                     "ul","ol","li","blockquote","a","span","div","sub","sup","table","thead",
                     "tbody","tr","td","th"],
      ALLOWED_ATTR: ["href"],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i
    });
  }
  // Fail safe: if DOMPurify didn't load (e.g. CDN blocked), render as
  // plain text rather than risk unsanitized HTML reaching the page.
  console.warn("DOMPurify unavailable — rendering milestone content as plain text.");
  const tmp = document.createElement("div");
  tmp.textContent = html;
  return tmp.innerHTML;
}

// ── AUTHENTICATION & REGISTRATION FUNCTIONS ──
function setLoginMode(mode) {
  currentLoginMode = mode;
  if (mode === 'email') {
    document.getElementById("btn-mode-email").classList.add("active");
    document.getElementById("btn-mode-username").classList.remove("active");
    document.getElementById("field-login-email").style.display = "block";
    document.getElementById("field-login-username").style.display = "none";
  } else {
    document.getElementById("btn-mode-username").classList.add("active");
    document.getElementById("btn-mode-email").classList.remove("active");
    document.getElementById("field-login-username").style.display = "block";
    document.getElementById("field-login-email").style.display = "none";
  }
}

async function doLogin() {
  const emailEl = document.getElementById("login-email");
  const usernameEl = document.getElementById("username");
  const passwordEl = document.getElementById("password");
  
  let email = currentLoginMode === 'email' && emailEl ? emailEl.value.trim() : "";
  let username = currentLoginMode === 'username' && usernameEl ? usernameEl.value.trim() : "";
  const password = passwordEl ? passwordEl.value : "";
  
  const errEl = document.getElementById("loginError");
  const btn = document.getElementById("loginBtn");

  if (errEl) errEl.style.display = "none";
  
  if ((currentLoginMode === 'email' && !email) || (currentLoginMode === 'username' && !username) || !password) {
    if (errEl) { errEl.textContent = `Please enter your ${currentLoginMode} and password.`; errEl.style.display = "block"; }
    return;
  }

  if (btn) setBtnLoading(btn, "Signing in…");

  try {
    const result = await apiCall("login", { username, email, password });

    if (result.success) {
      setSession(result.user);
      showToast("Welcome back, " + result.user.full_name.split(" ")[0] + "!", "success");
      setTimeout(() => {
        if (["TEACHER","ADMIN"].includes(result.user.role)) window.location.href = "admin.html";
        else window.location.href = "learner.html";
      }, 600);
    } else {
      if (errEl) { errEl.textContent = result.error || "Invalid credentials."; errEl.style.display = "block"; }
      resetBtn(btn);
    }
  } catch (err) {
    if (errEl) { errEl.textContent = "Connection error. Check API setup."; errEl.style.display = "block"; }
    resetBtn(btn);
  }
}

async function doSignup() {
  const fname = document.getElementById("reg-fname").value.trim();
  const lname = document.getElementById("reg-lname").value.trim();
  const username = document.getElementById("reg-username").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const start_date = document.getElementById("reg-date").value;
  const tribe_id = document.getElementById("reg-tribe").value.trim();
  const hub_id = document.getElementById("reg-hub").value.trim();
  const colony = document.getElementById("reg-colony").value;
  const phone = document.getElementById("reg-phone").value.trim();
  
  const errEl = document.getElementById("signupError");
  const btn = document.getElementById("signupBtn");

  if (errEl) errEl.style.display = "none";
  if (!fname || !lname || !username || !email || !password || !colony || !phone) {
    if (errEl) { errEl.textContent = "Please fill in all required fields."; errEl.style.display = "block"; }
    return;
  }
  if (btn) setBtnLoading(btn, "Creating account…");

  try {
    const result = await apiCall("signup", { fname, lname, username, email, password, tribe_id, hub_id, colony, phone, start_date });

    if (result.success) {
      showToast("Account created successfully! You can now sign in.", "success");
      toggleAuthView('login');
      setLoginMode('email');
      document.getElementById("login-email").value = email;
      document.getElementById("password").value = "";
    } else {
      if (errEl) { errEl.textContent = result.error || "Error creating account."; errEl.style.display = "block"; }
    }
  } catch (err) {
    if (errEl) { errEl.textContent = "Connection error. Check API setup."; errEl.style.display = "block"; }
  } finally {
    resetBtn(btn);
  }
}

async function doFacilitatorSignup() {
  const name = document.getElementById("fac-name").value.trim();
  const username = document.getElementById("fac-username").value.trim();
  const email = document.getElementById("fac-email").value.trim();
  const password = document.getElementById("fac-password").value;
  const created_at = document.getElementById("fac-date").value;
  
  const errEl = document.getElementById("facSignupError");
  const btn = document.getElementById("facSignupBtn");

  if (errEl) errEl.style.display = "none";
  if (!name || !username || !email || !password) {
    if (errEl) { errEl.textContent = "Please fill in all required fields."; errEl.style.display = "block"; }
    return;
  }
  if (btn) setBtnLoading(btn, "Submitting…");

  try {
    const result = await apiCall("signupFacilitator", { name, username, email, password, created_at });

    if (result.success) {
      showToast("Request submitted! Please wait for administration approval.", "success");
      toggleAuthView('login');
      setLoginMode('email');
      document.getElementById("login-email").value = email;
      document.getElementById("password").value = "";
    } else {
      if (errEl) { errEl.textContent = result.error || "Error creating account."; errEl.style.display = "block"; }
    }
  } catch (err) {
    if (errEl) { errEl.textContent = "Connection error. Check API setup."; errEl.style.display = "block"; }
  } finally {
    resetBtn(btn);
  }
}

function toggleAuthView(view) {
  const views = ['login-view', 'signup-view', 'facilitator-signup-view'];
  views.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = 'none';
  });
  if(view === 'login') history.replaceState(null, null, ' ');
  const activeEl = document.getElementById(view + '-view');
  if (activeEl) activeEl.style.display = 'block';
}

// ── DOM CONTENT LOADED ──
document.addEventListener("DOMContentLoaded", async () => {
  // Footer year update
  const footerYearEl = document.getElementById('footerYear');
  if (footerYearEl) footerYearEl.textContent = new Date().getFullYear();

  // ── INIT: LOGIN PAGE ──
  if (document.getElementById("auth-container")) {
    if (typeof clearSession === 'function') clearSession();
    const today = new Date();
    if(document.getElementById('reg-date')) document.getElementById('reg-date').valueAsDate = today;
    if(document.getElementById('fac-date')) document.getElementById('fac-date').valueAsDate = today;
    if (window.location.hash === "#facilitator") toggleAuthView('facilitator-signup');

    document.addEventListener("keydown", e => { 
      if (e.key === "Enter" && document.getElementById('login-view') && document.getElementById('login-view').style.display !== 'none') {
        doLogin();
      }
    });
  }

  // ── INIT: ADMIN DASHBOARD ──
  if (document.getElementById("statGrid")) {
    user = requireAuth(["TEACHER", "ADMIN"]);
    if (!user) return;
    document.getElementById("sidebarName").textContent = user.full_name;
    document.getElementById("sidebarRole").textContent = user.role;

    if (user.role === "TEACHER") {
      document.getElementById("nav-facilitators").style.display = "none";
      document.getElementById("addMemberBtn").style.display = "none";
      document.getElementById("usersViewSub").textContent = "View existing member accounts";
    }

    try {
      const tasks = [loadOverview(), loadPendingReviews(), loadCoursesAdmin()];
      if (user.role === "ADMIN") tasks.push(loadPendingFacilitators(), loadActiveTeachers());
      await Promise.all(tasks);
      await loadCurriculumMilestoneCounts();
      renderStats();
      updateSyncStatus();
    } catch (err) {
      console.warn("Initial admin load failed:", err);
      showToast("Some data failed to load. Try refreshing.", "error");
    } finally {
      hidePageLoader();
    }
  }

  // ── INIT: LEARNER DASHBOARD ──
  if (document.getElementById("trackContainer")) {
    user = requireAuth(["LEARNER"]);
    if (!user) return;
    document.getElementById("sidebarName").textContent = user.full_name;
    try {
      await loadCoursesLearner();
    } catch (err) {
      console.warn("Initial learner load failed:", err);
      showToast("Some data failed to load. Try refreshing.", "error");
    } finally {
      hidePageLoader();
    }
  }

  // ── MODAL DISMISSAL: click backdrop or press Escape ──
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) overlay.classList.remove("active");
    });
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay.active").forEach(overlay => overlay.classList.remove("active"));
    }
  });
});


// ==========================================
// ADMIN LOGIC FUNCTIONS
// ==========================================
let isPolling = false;
let pendingFacilitators = [];
let activeTeachers = [];
let knownUserIds = null; 
let newUsersCount = 0;
let currentSearch = "";
let currentStatus = "";
let currentLearnerSearch = "";
let activeCourseForMilestone = null;
let userToAssign = null;

async function pollUpdates() {
  if (isPolling) return;
  isPolling = true;
  const btn = document.getElementById("refreshBtn");
  if (btn) btn.classList.add("loading");
  try {
    showToast("Syncing data...", "info");
    const tasks = [loadOverview(), loadPendingReviews(), loadCoursesAdmin()];
    if (user.role === "ADMIN") tasks.push(loadPendingFacilitators(), loadActiveTeachers());
    await Promise.all(tasks);
    await loadCurriculumMilestoneCounts();
    renderStats();
    showToast("Data refreshed.", "success");
    updateSyncStatus();
  } catch (err) {
    console.warn("Refresh failed:", err);
    showToast("Failed to sync data.", "error");
  } finally {
    isPolling = false;
    if (btn) btn.classList.remove("loading");
  }
}

function updateSyncStatus() {
  const el = document.getElementById("lastSynced");
  if (!el) return;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  el.innerHTML = `<span class="sync-dot"></span><span class="sync-label">Synced ${time}</span>`;
}

async function loadActiveTeachers() {
  const res = await apiCall("getActiveTeachers", { requester_role: user.role });
  activeTeachers = res.teachers || [];
  renderActiveTeachersTable();
}

function renderActiveTeachersTable() {
  const tbody = document.getElementById("activeTeachersBody");
  if(!tbody) return;
  if (!activeTeachers.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:2rem">No active facilitators yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = activeTeachers.map(t => `
    <tr id="teacher-row-${t.user_id}">
      <td>${t.full_name}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:.82rem;color:var(--text-muted)">${t.username}</td>
      <td style="color:var(--text-dim);font-size:.8rem">${fmtDate(t.created_at)}</td>
      <td><button style="padding:0.4rem 0.875rem;background:var(--steel-bg);color:var(--steel);border:1px solid var(--steel);border-radius:6px;font-size:0.8rem;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;" onclick="promoteToAdmin('${t.user_id}','${escHtml(t.full_name)}')">⬆ Promote to Admin</button></td>
    </tr>`).join("");
}

async function promoteToAdmin(userId, name) {
  if (!confirm(`Promote ${name} to Admin? They will gain full platform access.`)) return;
  const row = document.getElementById(`teacher-row-${userId}`);
  if (row) row.style.opacity = "0.5";
  const res = await apiCall("promoteToAdmin", { user_id: userId, requester_role: user.role });
  if (res.success) {
    showToast(`${name} promoted to Admin.`, "success");
    activeTeachers = activeTeachers.filter(t => t.user_id !== userId);
    renderActiveTeachersTable();
  } else {
    showToast(res.error || "Error", "error");
    if (row) row.style.opacity = "1";
  }
}

async function loadPendingFacilitators() {
  const res = await apiCall("getPendingFacilitators", { requester_role: user.role });
  pendingFacilitators = res.pending || [];
  const badge = document.getElementById("facilitatorBadge");
  if(badge) {
    if (pendingFacilitators.length > 0) {
      badge.style.display = "inline"; badge.textContent = pendingFacilitators.length;
    } else { badge.style.display = "none"; }
  }
  renderFacilitatorsTable();
}

function renderFacilitatorsTable() {
  const tbody = document.getElementById("facilitatorsBody");
  if(!tbody) return;
  if (!pendingFacilitators.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:2rem">No pending requests. 🎉</td></tr>`;
    return;
  }
  tbody.innerHTML = pendingFacilitators.map(f => `
    <tr id="fac-row-${f.user_id}">
      <td>${f.full_name}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:.82rem;color:var(--text-muted)">${f.username}</td>
      <td style="color:var(--text-dim);font-size:.8rem">${fmtDate(f.created_at)}</td>
      <td><button style="padding:0.4rem 0.875rem;background:var(--success-bg);color:var(--success);border:1px solid rgba(34,197,94,0.25);border-radius:6px;font-size:0.8rem;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;" onclick="approveFacilitator('${f.user_id}')">✓ Approve</button></td>
    </tr>`).join("");
}

async function approveFacilitator(userId) {
  const row = document.getElementById(`fac-row-${userId}`);
  if (row) row.style.opacity = "0.5";
  const res = await apiCall("approveFacilitator", { user_id: userId, requester_role: user.role });
  if (res.success) {
    showToast("Facilitator approved — they can now sign in.", "success");
    pendingFacilitators = pendingFacilitators.filter(f => f.user_id !== userId);
    renderFacilitatorsTable();
    const badge = document.getElementById("facilitatorBadge");
    if(badge) {
      if (pendingFacilitators.length > 0) { badge.style.display = "inline"; badge.textContent = pendingFacilitators.length; }
      else badge.style.display = "none";
    }
  } else {
    showToast(res.error || "Error", "error");
    if (row) row.style.opacity = "1";
  }
}

async function loadCoursesAdmin() {
  const res = await apiCall("getCourses", { user_id: user.user_id, role: user.role });
  allCourses = res.courses || [];
  const sel = document.getElementById("nf-course");
  if(sel) {
    sel.innerHTML = '<option value="">— Select course —</option>';
    allCourses.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.course_id; opt.textContent = c.title;
      sel.appendChild(opt);
    });
  }
  renderAdminCoursesTable();
}

// Sums milestone counts across every active course so "Members Completed"
// can be measured against the full curriculum, not just whatever course(s)
// a given member happens to have Progress rows for so far.
async function loadCurriculumMilestoneCounts() {
  if (!allCourses.length) { totalCurriculumMilestones = 0; return; }
  const results = await Promise.all(allCourses.map(c => apiCall("getMilestones", { course_id: c.course_id })));
  totalCurriculumMilestones = results.reduce((sum, r) => sum + (r.milestones ? r.milestones.length : 0), 0);
}

function renderAdminCoursesTable() {
  const tbody = document.getElementById("adminCoursesBody");
  if(!tbody) return;
  if(!allCourses.length) { tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:2rem">No courses found.</td></tr>`; return; }
  tbody.innerHTML = allCourses.map(c => `
    <tr>
      <td style="font-weight:500;color:var(--text-main)">${escHtml(c.title)}</td>
      <td style="color:var(--text-muted);font-size:0.85rem">${escHtml(c.description)}</td>
      <td style="color:var(--text-dim);font-size:0.85rem;font-family:'JetBrains Mono',monospace;">${c.course_id}</td>
      <td><button style="padding:0.4rem 0.875rem;background:var(--gold-bg);color:var(--gold);border:1px solid var(--gold);border-radius:6px;font-size:0.8rem;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;" onclick="openMilestoneModal('${c.course_id}', '${escHtml(c.title)}')">➕ Add Milestone</button></td>
    </tr>`).join("");
}

async function loadOverview() {
  const [pRes, uRes] = await Promise.all([
    apiCall("getAllProgress", { requester_role: user.role }),
    apiCall("getUsers", { requester_role: user.role })
  ]);
  
  allUsers = uRes.users || [];
  allProgress = pRes.progress || [];
  
  detectNewRegistrations();
  applyProgressFilters();
  renderLearnerCards();
  applyLearnerCardFilter();
  renderUsersTable();
}

function detectNewRegistrations() {
  const currentIds = new Set(allUsers.map(u => u.user_id));
  if (knownUserIds === null) { knownUserIds = currentIds; return; }
  const newUsers = allUsers.filter(u => !knownUserIds.has(u.user_id));
  knownUserIds = currentIds;
  if (!newUsers.length) return;
  if (newUsers.length === 1) showToast(`New registration: ${newUsers[0].full_name}`, "success");
  else showToast(`${newUsers.length} new registrations`, "success");

  newUsersCount += newUsers.length;
  const badge = document.getElementById("newUsersBadge");
  if(badge) {
    badge.style.display = "inline"; badge.textContent = newUsersCount;
  }
}

async function loadPendingReviews() {
  const res = await apiCall("getPendingReviews", { requester_role: user.role });
  pendingReviews = res.pending || [];
  updatePendingBadge();
  renderPendingTable();
}

function renderStats() {
  const el = document.getElementById("statGrid");
  if(!el) return;

  const totalMembers = allUsers.length;
  const grouped = groupProgressByMember(allProgress);

  // "Enrolled" = has actually started a course (submitted, passed, or failed
  // at least one milestone) — not just auto-enrolled into Module 1 the first
  // time their dashboard happened to load.
  const enrolledMembers = grouped.filter(m =>
    m.milestones.some(x => ["SUBMITTED", "PASSED", "FAILED"].includes(x.status))
  ).length;

  const pending = pendingReviews.length;

  // "Completed" = passed every milestone across the full active curriculum,
  // not just whatever course(s) they've been auto-enrolled into so far.
  const completedMembers = totalCurriculumMilestones > 0
    ? grouped.filter(m => m.passed >= totalCurriculumMilestones).length
    : 0;

  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--steel">👥</div>
      <div class="kpi-body"><div class="kpi-num">${totalMembers}</div><div class="kpi-label">Members</div></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--gold">📘</div>
      <div class="kpi-body"><div class="kpi-num">${enrolledMembers}</div><div class="kpi-label">Enrolled Members</div></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--warning">⏳</div>
      <div class="kpi-body"><div class="kpi-num">${pending}</div><div class="kpi-label">Awaiting Review</div></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon kpi-icon--success">🏆</div>
      <div class="kpi-body"><div class="kpi-num">${completedMembers}</div><div class="kpi-label">Members Completed</div></div>
    </div>`;
}

function groupProgressByMember(data) {
  const map = {};
  data.forEach(p => {
    if (!map[p.user_id]) { map[p.user_id] = { user_id: p.user_id, full_name: p.full_name, username: p.username, courseSet: new Set(), milestones: [] }; }
    map[p.user_id].courseSet.add(p.course_title || p.course_id);
    map[p.user_id].milestones.push(p);
  });
  return Object.values(map).map(m => {
    const total = m.milestones.length;
    const passed = m.milestones.filter(x => x.status === "PASSED").length;
    const rate = total ? Math.round((passed / total) * 100) : 0;
    const upNext = m.milestones.find(x => x.status === "UNLOCKED");
    return { ...m, courses: Array.from(m.courseSet).join(", "), total, passed, rate, upNext };
  });
}

function renderProgressTable(data) {
  const tbody = document.getElementById("progressBody");
  if(!tbody) return;
  let grouped = groupProgressByMember(data);
  if (currentStatus === "COMPLETE") grouped = grouped.filter(m => m.total > 0 && m.rate === 100);
  else if (currentStatus) grouped = grouped.filter(m => m.milestones.some(x => x.status === currentStatus));
  lastGroupedMembers = grouped;

  if (!grouped.length) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:2rem">No members found.</td></tr>`; return; }
  tbody.innerHTML = grouped.map(m => {
    const name = m.full_name || m.user_id;
    const initials = String(name).trim().split(/\s+/).map(w => w[0]).join("").substring(0, 2).toUpperCase();
    return `
    <tr>
      <td>
        <button class="member-cell" onclick="openMemberDetail('${m.user_id}')">
          <span class="avatar-chip">${initials}</span>
          <span class="member-name">${name}</span>
        </button>
      </td>
      <td style="color:var(--text-muted);font-size:.82rem">${m.courses || "—"}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:.85rem">${m.passed}/${m.total} passed</td>
      <td>
        <div class="mini-progress-wrap">
          <div class="mini-progress"><div class="mini-progress-fill" style="width:${m.rate}%"></div></div>
          <span class="mini-progress-label">${m.rate}%</span>
        </div>
      </td>
      <td style="color:var(--text-dim);font-size:.8rem">${m.upNext ? "🔓 " + (m.upNext.milestone_title || m.upNext.milestone_id) : (m.total > 0 && m.rate === 100 ? "✅ All complete" : "—")}</td>
    </tr>`;
  }).join("");
}

function openMemberDetail(userId) {
  const m = lastGroupedMembers.find(x => x.user_id === userId);
  if (!m) return;
  const info = allUsers.find(u => u.user_id === userId) || {};
  document.getElementById("md-name").textContent = m.full_name || userId;
  document.getElementById("md-username").textContent = "@" + (m.username || info.username || "");
  document.getElementById("md-email").textContent = info.email || "—";
  document.getElementById("md-phone").textContent = info.phone || "—";
  document.getElementById("md-courses").textContent = m.courses || "—";
  document.getElementById("md-rate").textContent = m.rate + "%";
  document.getElementById("md-rate-bar").style.width = m.rate + "%";
  const sorted = [...m.milestones].sort((a,b) => (a.order_index||0) - (b.order_index||0));
  document.getElementById("md-milestones").innerHTML = sorted.map(ms => {
    const isUpNext = ms.status === "UNLOCKED";
    return `
      <div style="display:flex;align-items:center;gap:.75rem;padding:.65rem 0;border-bottom:1px solid var(--border-subtle);">
        <div style="flex:1;">
          <div style="font-size:.85rem;color:var(--text-main);font-weight:500;">
            ${ms.milestone_title || ms.milestone_id}
            ${isUpNext ? '<span style="font-size:.68rem;color:var(--steel);font-weight:600;margin-left:6px;">🔓 UP NEXT</span>' : ''}
          </div>
          ${ms.score ? `<div style="font-size:.75rem;color:var(--text-dim);margin-top:2px;">Score: ${ms.score}%</div>` : ''}
        </div>
        ${statusBadge(ms.status)}
      </div>`;
  }).join("");
  document.getElementById("memberDetailModal").classList.add("active");
}

function closeMemberDetailModal() { document.getElementById("memberDetailModal").classList.remove("active"); }

function renderPendingTable() {
  const tbody = document.getElementById("pendingBody");
  if(!tbody) return;
  if (!pendingReviews.length) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:2rem">No submissions awaiting review. 🎉</td></tr>`; return; }
  tbody.innerHTML = pendingReviews.map(sub => `
    <tr id="sub-row-${sub.sub_id}">
      <td>${sub.full_name || sub.user_id}</td>
      <td style="color:var(--text-muted)">${sub.milestone_title || sub.milestone_id}</td>
      <td style="color:var(--text-dim);font-size:.8rem">${fmtDate(sub.submitted_at)}</td>
      <td><div style="background:var(--bg-main);border-radius:8px;padding:1rem;font-size:0.85rem;color:var(--text-muted);line-height:1.7;max-height:120px;overflow-y:auto;border:1px solid var(--border-subtle);font-style:italic;">${escHtml(sub.content)}</div></td>
      <td><div style="display:flex;gap:6px;">
          <button style="padding:0.4rem 0.875rem;background:var(--success-bg);color:var(--success);border:1px solid rgba(34,197,94,0.25);border-radius:6px;font-size:0.8rem;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;" onclick="approve('${sub.user_id}','${sub.milestone_id}','${sub.course_id}','${sub.sub_id}')">✓ Approve</button>
          <button style="padding:0.4rem 0.875rem;background:var(--error-bg);color:var(--error);border:1px solid rgba(239,68,68,0.2);border-radius:6px;font-size:0.8rem;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;" onclick="reject('${sub.user_id}','${sub.milestone_id}','${sub.course_id}','${sub.sub_id}')">✕ Reject</button>
      </div></td>
    </tr>`).join("");
}

function renderLearnerCards() {
  const grid = document.getElementById("learnerGrid");
  if(!grid) return;
  const learnerMap = {};
  allProgress.forEach(p => {
    if (!learnerMap[p.user_id]) learnerMap[p.user_id] = { name: p.full_name, username: p.username, milestones: [] };
    learnerMap[p.user_id].milestones.push(p);
  });
  const entries = Object.entries(learnerMap);
  if (!entries.length) { grid.innerHTML = `<p style="color:var(--text-dim);font-size:.875rem">No member data.</p>`; return; }
  grid.innerHTML = entries.map(([uid, data]) => {
    const initials = data.name ? data.name.split(" ").map(w=>w[0]).join("").substring(0,2).toUpperCase() : "??";
    const passed = data.milestones.filter(m => m.status === "PASSED").length;
    const total  = data.milestones.length;
    return `
      <div class="learner-card" data-name="${(data.name||"").toLowerCase()}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;">
          <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--steel),var(--bg-surface));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;color:var(--text-main);flex-shrink:0;">${initials}</div>
          <div>
            <div style="font-weight:600;font-size:0.9rem;color:var(--text-main);">${data.name || uid}</div>
            <div style="font-size:0.75rem;color:var(--text-dim);">${data.username} · ${passed}/${total} milestones passed</div>
          </div>
        </div>
        <div>
          ${data.milestones.sort((a,b)=>(a.order_index||0)-(b.order_index||0)).map(m => {
            let dotColor = "var(--bg-surface)";
            if(m.status === "UNLOCKED") dotColor = "var(--steel)";
            if(m.status === "SUBMITTED") dotColor = "var(--warning)";
            if(m.status === "PASSED") dotColor = "var(--success)";
            if(m.status === "FAILED") dotColor = "var(--error)";
            return `<div style="display:flex;align-items:center;gap:8px;padding:0.4rem 0;border-bottom:1px solid var(--border-subtle);font-size:0.82rem;"><div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${dotColor}"></div><div style="color:var(--text-muted);flex:1;">${m.milestone_title || m.milestone_id}</div><div style="font-size:0.75rem;color:var(--text-dim);">${m.status}</div></div>`}).join("")}
        </div>
      </div>`;
  }).join("");
}

function renderUsersTable() {
  const tbody = document.getElementById("usersBody");
  if(!tbody) return;
  if (!allUsers.length) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:2rem">No members found.</td></tr>`; return; }
  tbody.innerHTML = allUsers.map(u => `
    <tr>
      <td>${u.full_name}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:.82rem;color:var(--text-muted)">${u.username}</td>
      <td style="color:var(--text-dim)">${u.email}</td>
      <td style="color:var(--text-dim);font-size:.82rem;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${u.enrolled_courses || "—"}">${u.enrolled_courses || "—"}</td>
      <td><button style="padding:0.4rem 0.875rem;background:var(--steel-bg);color:var(--steel);border:1px solid var(--steel);border-radius:6px;font-size:0.8rem;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;" onclick="openAssignModal('${u.user_id}', '${escHtml(u.full_name)}')">➕ Assign Course</button></td>
    </tr>`).join("");
}

async function approve(userId, milestoneId, courseId, subId) {
  const row = document.getElementById(`sub-row-${subId}`);
  if (row) row.style.opacity = "0.5";
  const res = await apiCall("approveMilestone", { user_id: userId, milestone_id: milestoneId, course_id: courseId, reviewer_id: user.user_id, requester_role: user.role });
  if (res.success) {
    showToast("Milestone approved — next milestone unlocked!", "success");
    pendingReviews = pendingReviews.filter(s => !(s.user_id===userId && s.milestone_id===milestoneId));
    renderPendingTable();
    await loadOverview();
    updatePendingBadge();
  } else {
    showToast(res.error || "Error", "error");
    if (row) row.style.opacity = "1";
  }
}

async function reject(userId, milestoneId, courseId, subId) {
  const row = document.getElementById(`sub-row-${subId}`);
  if (row) row.style.opacity = "0.5";
  const res = await apiCall("rejectMilestone", { user_id: userId, milestone_id: milestoneId, course_id: courseId, reviewer_id: user.user_id, requester_role: user.role });
  if (res.success) {
    showToast("Submission rejected. Member can resubmit.", "info");
    pendingReviews = pendingReviews.filter(s => !(s.user_id===userId && s.milestone_id===milestoneId));
    renderPendingTable();
    await loadOverview();
    updatePendingBadge();
  } else {
    showToast(res.error || "Error", "error");
    if (row) row.style.opacity = "1";
  }
}

function updatePendingBadge() {
  const badge = document.getElementById("pendingBadge");
  if(!badge) return;
  const count = pendingReviews.length;
  if (count > 0) { badge.style.display = "inline"; badge.textContent = count; }
  else badge.style.display = "none";
}

function filterProgressTable(query) { currentSearch = query.toLowerCase(); applyProgressFilters(); }
function filterByStatus(status) { currentStatus = status; applyProgressFilters(); }
function applyProgressFilters() {
  filteredProgress = allProgress.filter(p => !currentSearch || (p.full_name||"").toLowerCase().includes(currentSearch));
  renderProgressTable(filteredProgress);
}
function filterLearnerCards(query) { currentLearnerSearch = query.toLowerCase(); applyLearnerCardFilter(); }
function applyLearnerCardFilter() {
  document.querySelectorAll(".learner-card").forEach(card => {
    card.style.display = card.dataset.name.includes(currentLearnerSearch) ? "" : "none";
  });
}

function switchView(name) {
  document.querySelectorAll(".view").forEach(v => {
    if(v.id === `view-${name}`) v.style.display = "block";
    else v.style.display = "none";
  });
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  if(event && event.currentTarget) event.currentTarget.classList.add("active");
  const viewTitles = {
    overview: ["Overview", "Platform at a glance"],
    pending:  ["Pending Reviews", "Written submissions awaiting your approval"],
    learners: ["Member Progress", "Per-member milestone tracking"],
    courses:  ["Manage Courses", "Create and structure learning pathways"],
    users:    ["Manage Members", "Add and view member accounts"],
    facilitators: ["Facilitator Requests", "Approve leadership clearance requests"]
  };
  const [title, sub] = viewTitles[name] || ["", ""];
  if(document.getElementById("topbarTitle")) document.getElementById("topbarTitle").textContent = title;
  if(document.getElementById("topbarSub")) document.getElementById("topbarSub").textContent = sub;
  closeMobileSidebar();
  if (name === "users" && document.getElementById("newUsersBadge")) {
    newUsersCount = 0; document.getElementById("newUsersBadge").style.display = "none";
  }
}

function openAddUserModal() { document.getElementById("addUserModal").classList.add("active"); }
function closeAddUserModal() { document.getElementById("addUserModal").classList.remove("active"); }
function openCourseModal() { document.getElementById("courseModal").classList.add("active"); }
function closeCourseModal() { document.getElementById("courseModal").classList.remove("active"); }

function openMilestoneModal(cid, ctitle) {
  activeCourseForMilestone = cid;
  document.getElementById("nm-course-title").textContent = ctitle;
  document.getElementById("milestoneModal").classList.add("active");
}
function closeMilestoneModal() { document.getElementById("milestoneModal").classList.remove("active"); }
function handleSubTypeChange() {
  const type = document.getElementById("nm-type").value;
  document.getElementById("nm-quiz-wrap").style.display = type === "QUIZ" ? "block" : "none";
}

function openAssignModal(uid, name) {
  userToAssign = uid;
  document.getElementById("assign-user-name").textContent = name;
  const sel = document.getElementById("assign-course-select");
  sel.innerHTML = '<option value="">— Select course —</option>' + allCourses.map(c => `<option value="${c.course_id}">${escHtml(c.title)}</option>`).join("");
  document.getElementById("assignModal").classList.add("active");
}
function closeAssignModal() { document.getElementById("assignModal").classList.remove("active"); }

async function createUser() {
  const name = document.getElementById("nf-name").value.trim();
  const username = document.getElementById("nf-username").value.trim();
  const email = document.getElementById("nf-email").value.trim();
  const password = document.getElementById("nf-password").value;
  const course = document.getElementById("nf-course").value;
  if (!name || !username || !email || !password) return showToast("Please fill in all fields.", "error");
  const res = await apiCall("createUser", { full_name: name, username, password, email, role: "LEARNER", course_id: course, requester_role: user.role });
  if (res.success) {
    showToast(`Account created for ${name}!`, "success"); closeAddUserModal();
    ["nf-name","nf-username","nf-email","nf-password"].forEach(id => document.getElementById(id).value = "");
    await loadOverview();
  } else { showToast(res.error || "Error creating user", "error"); }
}

async function submitNewCourse() {
  const title = document.getElementById("nc-title").value.trim();
  const desc = document.getElementById("nc-desc").value.trim();
  if(!title || !desc) return showToast("Please fill all fields", "error");
  const btn = document.getElementById("btn-submit-course");
  btn.disabled = true; btn.textContent = "Saving...";
  const res = await apiCall("createCourse", {title, description: desc, teacher_id: user.user_id, requester_role: user.role});
  if(res.success) {
    showToast("Course created!", "success"); closeCourseModal();
    document.getElementById("nc-title").value = ""; document.getElementById("nc-desc").value = "";
    await loadCoursesAdmin(); 
  } else { showToast(res.error || "Error", "error"); }
  btn.disabled = false; btn.textContent = "Save Course";
}

async function submitNewMilestone() {
  const title = document.getElementById("nm-title").value.trim();
  const desc = document.getElementById("nm-desc").value.trim();
  const content = document.getElementById("nm-content").value.trim();
  const video = document.getElementById("nm-video").value.trim();
  const type = document.getElementById("nm-type").value;
  let passScore = "", quizJson = "";
  if(!title || !desc || !content) return showToast("Fill title, description, and content", "error");
  if(type === "QUIZ") {
    passScore = document.getElementById("nm-pass").value;
    const rawQuiz = document.getElementById("nm-quiz").value.trim();
    try { JSON.parse(rawQuiz); quizJson = rawQuiz; } catch(e) { return showToast("Invalid JSON in Quiz Data", "error"); }
  }
  const btn = document.getElementById("btn-submit-milestone");
  btn.disabled = true; btn.textContent = "Saving...";
  const res = await apiCall("createMilestone", {
    course_id: activeCourseForMilestone, title, description: desc, content_html: content, video_url: video,
    submission_type: type, pass_score: passScore, quiz_json: quizJson, requester_role: user.role
  });
  if(res.success) {
    showToast("Milestone created!", "success"); closeMilestoneModal();
    ["nm-title","nm-desc","nm-content","nm-video"].forEach(id => document.getElementById(id).value = "");
  } else { showToast(res.error || "Error", "error"); }
  btn.disabled = false; btn.textContent = "Add Milestone";
}

async function submitAssignCourse() {
  const cid = document.getElementById("assign-course-select").value;
  if(!cid) return showToast("Please select a course", "error");
  const btn = document.getElementById("btn-submit-assign");
  btn.disabled = true; btn.textContent = "Assigning...";
  const res = await apiCall("assignCourse", {target_user_id: userToAssign, course_id: cid, requester_role: user.role});
  if(res.success) { showToast("Course assigned successfully", "success"); closeAssignModal(); await loadOverview(); } 
  else { showToast(res.error || "Error", "error"); }
  btn.disabled = false; btn.textContent = "Assign Course";
}


// ==========================================
// LEARNER ROADMAP & PROGRESSION
// ==========================================
async function loadCoursesLearner() {
  const tc = document.getElementById("trackContainer");
  if(tc) tc.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--text-dim);">Syncing your roadmap...</div>`;
  
  const res = await apiCall("getLearnerDashboard", { user_id: user.user_id });
  if (res.success) {
    userRoadmap = res.roadmap || [];
    renderWelcomeDashboard();
    renderCourseList(); // Syncs the sidebar
  } else {
    if(tc) tc.innerHTML = `<div style="color:var(--error);padding:2rem;">Failed to load curriculum.</div>`;
  }
}

function renderCourseList() {
  const el = document.getElementById("courseList");
  if(!el) return;
  
  if (!userRoadmap.length) { 
    el.innerHTML = `<p style="font-size:.8rem;color:var(--text-dim);padding:.5rem 0">No paths available.</p>`; 
    return; 
  }
  
  el.innerHTML = userRoadmap.map((c) => {
    const isCompleted = c.progress_pct === 100;
    const icon = isCompleted ? '✅' : (c.is_unlocked ? '📖' : '🔒');
    const lockedStyle = c.is_unlocked ? '' : 'opacity: 0.6; cursor: not-allowed;';
    const clickAction = c.is_unlocked ? `openCourse('${c.course_id}')` : '';
    
    return `<button class="course-btn ${currentCourse?.course_id === c.course_id ? 'active' : ''}" style="${lockedStyle}" onclick="${clickAction}">
      <span style="font-size: 14px;">${icon}</span> ${escHtml(c.title)}
    </button>`;
  }).join("");
}

function renderWelcomeDashboard() {
  closeMobileSidebar();
  if(document.getElementById("topbarTitle")) document.getElementById("topbarTitle").textContent = "Your Journey";
  if(document.getElementById("topbarSub")) document.getElementById("topbarSub").textContent = "Complete milestones sequentially to unlock new pathways.";
  if(document.getElementById("progressSummary")) document.getElementById("progressSummary").style.display = "none";
  currentCourse = null; // Reset active course state when on the dashboard
  renderCourseList(); // Update sidebar active state
  
  const tc = document.getElementById("trackContainer");
  if(!tc) return;

  let html = `
    <div class="welcome-dashboard-wrap">
      <div class="welcome-dashboard-content">
        <div style="margin-bottom: 2rem;">
          <h2 style="font-family: 'DM Serif Display', serif; font-size: 2rem; color: var(--text-main); margin-bottom: 0.4rem;">Welcome Leader, ${user.full_name.split(' ')[0]}</h2>
          <p style="font-size: 0.95rem; color: var(--text-dim);">Pick up where you left off or begin your next module.</p>
        </div>
        <div class="roadmap-grid">`;

  userRoadmap.forEach((c) => {
    const isCompleted = c.progress_pct === 100;
    const cardClass = c.is_unlocked ? (isCompleted ? 'unlocked completed' : 'unlocked') : 'locked';
    const icon = c.is_unlocked ? (isCompleted ? '✅' : '📖') : '🔒';
    const statusText = c.is_unlocked ? (isCompleted ? 'Completed' : 'In Progress') : 'Locked';

    html += `
      <div class="roadmap-card ${cardClass}" onclick="${c.is_unlocked ? `openCourse('${c.course_id}')` : ''}">
        <div class="roadmap-icon">${icon}</div>
        <div class="roadmap-title">${escHtml(c.title)}</div>
        <div class="roadmap-desc">${escHtml(c.description)}</div>
        <div class="roadmap-progress-wrap">
          <div class="roadmap-progress-bar">
            <div class="roadmap-progress-fill" style="width: ${c.progress_pct}%; ${isCompleted ? 'background: var(--success);' : ''}"></div>
          </div>
          <div class="roadmap-meta">
            <span>${c.passed_milestones} / ${c.total_milestones} Passed</span>
            <span style="${isCompleted ? 'color: var(--success);' : (c.is_unlocked ? 'color: var(--gold);' : '')}">${statusText}</span>
          </div>
        </div>
      </div>`;
  });

  html += `
        </div>
      </div>
    </div>`;
    
  tc.innerHTML = html;
}

async function openCourse(courseId) {
  const courseData = userRoadmap.find(c => c.course_id === courseId);
  if (!courseData) return;
  currentCourse = courseData;
  renderCourseList(); // Refreshes sidebar to highlight the active course
  
  if(document.getElementById("topbarTitle")) document.getElementById("topbarTitle").textContent = currentCourse.title;
  if(document.getElementById("topbarSub")) document.getElementById("topbarSub").textContent = currentCourse.description;
  
  const tc = document.getElementById("trackContainer");
  tc.innerHTML = `<div class="skeleton" style="height:70px;margin-bottom:1rem;border-radius:12px;"></div><div class="skeleton" style="height:80px;margin-bottom:1rem;border-radius:14px;"></div><div class="skeleton" style="height:80px;border-radius:14px;"></div>`;
  
  const [mRes, pRes] = await Promise.all([ 
    apiCall("getMilestones", { course_id: courseId }), 
    apiCall("getProgress", { user_id: user.user_id, course_id: courseId }) 
  ]);
  
  milestones = mRes.milestones || [];
  progress   = pRes.progress  || [];
  renderTrack();
}

function getStatus(milestone_id) {
  const p = progress.find(p => p.milestone_id === milestone_id); return p ? p.status : "LOCKED";
}

function renderTrack() {
  const passed = progress.filter(p => p.status === "PASSED").length;
  const total  = milestones.length;
  const pct    = total ? Math.round((passed/total)*100) : 0;
  
  if(document.getElementById("progressSummary")) document.getElementById("progressSummary").style.display = "flex";
  if(document.getElementById("progressCount")) document.getElementById("progressCount").textContent = `${passed} / ${total}`;

  const html = `
    <div style="margin-bottom: 2rem; display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem;">
      <div>
        <button onclick="loadCoursesLearner()" style="background: none; border: none; color: var(--gold); font-size: 0.85rem; font-weight: 500; cursor: pointer; padding: 0; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 4px;">← Back to Roadmap</button>
        <h2 style="font-family: 'DM Serif Display', serif; font-size: 1.6rem; color: var(--text-main); margin-bottom: 0.4rem;">${escHtml(currentCourse.title)}</h2>
        <p style="font-size: 0.875rem; color: var(--text-muted);">${escHtml(currentCourse.description)}</p>
      </div>
    </div>
    <div style="background: var(--bg-surface); border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 2rem;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;"><span style="font-size: 0.8rem; color: var(--text-dim);">Overall Progress</span><strong style="color: var(--gold-lt); font-size: 0.875rem;">${pct}% complete</strong></div>
      <div style="height: 6px; background: var(--border-subtle); border-radius: 3px; overflow: hidden;"><div style="height: 100%; background: linear-gradient(90deg, var(--gold), var(--gold-lt)); border-radius: 3px; transition: width 0.6s ease; width:${pct}%"></div></div>
    </div>
    ${milestones.map((m,i) => renderMilestoneCard(m, i)).join("")}`;
    
  const tc = document.getElementById("trackContainer");
  if(tc) tc.innerHTML = html;
  milestones.forEach(m => { if (m.video_url) initVideoTracker(m); });
}

function renderMilestoneCard(m, idx) {
  const status = getStatus(m.milestone_id);
  const locked = status === "LOCKED";
  let statusStyle = "";
  if(status === "LOCKED") statusStyle = "background: var(--bg-surface); color: var(--text-dim); border: 2px solid var(--border-strong);";
  if(status === "UNLOCKED") statusStyle = "background: var(--steel-bg); color: var(--steel); border: 2px solid var(--steel);";
  if(status === "SUBMITTED") statusStyle = "background: var(--warning-bg); color: var(--warning); border: 2px solid var(--warning);";
  if(status === "PASSED") statusStyle = "background: var(--success-bg); color: var(--success); border: 2px solid var(--success);";
  if(status === "FAILED") statusStyle = "background: var(--error-bg); color: var(--error); border: 2px solid var(--error);";
  let borderStyle = status === 'UNLOCKED' ? "border-color: var(--gold);" : "border-color: var(--border-subtle);";
  const vinfo = getVideoInfo(m.video_url);
  const trackable = ["youtube","vimeo","file"].includes(vinfo.type);
  const needsGate = trackable && status === "UNLOCKED" && sessionStorage.getItem(watchedKey(m.milestone_id)) !== "1";

  return `
    <div class="milestone-card" id="card-${m.milestone_id}" style="background: var(--bg-panel); border: 1px solid; ${borderStyle} border-radius: 14px; margin-bottom: 1rem; overflow: hidden; transition: border-color 0.2s; ${locked ? 'opacity: 0.55;' : ''}">
      <div style="padding: 1.25rem 1.5rem; display: flex; align-items: center; gap: 1rem; ${locked ? 'cursor: default;' : 'cursor: pointer;'}" onclick="${!locked?`toggleCard('${m.milestone_id}')`:''}">
        <div style="width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; font-weight: 500; ${statusStyle}">${idx+1}</div>
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-main); margin-bottom: 3px;">${escHtml(m.title)}</div>
          <div style="font-size: 0.8rem; color: var(--text-dim);">${escHtml(m.description)}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0;">${statusBadge(status)} ${!locked ? `<span id="chev-${m.milestone_id}" style="color: var(--text-dim); transition: transform 0.25s; font-size: 0.9rem;">▾</span>` : ''}</div>
      </div>
      <div id="body-${m.milestone_id}" style="display: none; padding: 0 1.5rem 1.5rem; border-top: 1px solid var(--border-subtle);">
        ${renderVideoEmbed(m.video_url, m.milestone_id, needsGate)}
        <div style="background: var(--bg-surface); border-radius: 10px; padding: 1.25rem 1.5rem; margin: 1rem 0; font-size: 0.875rem; line-height: 1.75; color: var(--text-muted);">${sanitizeContentHtml(m.content_html)}</div>
        ${trackable ? `<div id="video-lock-note-${m.milestone_id}" style="display:${needsGate ? 'flex' : 'none'};align-items:center;gap:8px;margin-bottom:1rem;padding:.75rem 1rem;background:var(--warning-bg);color:var(--warning);border-radius:8px;font-size:.82rem;">🔒 Watch the full video above to unlock this step.</div>` : ""}
        <div id="submission-area-${m.milestone_id}" style="display:${needsGate ? 'none' : 'block'};">${renderSubmissionArea(m, status)}</div>
      </div>
    </div>`;
}

// ── VIDEO INFO UPDATED WITH GOOGLE DRIVE EXCLUSION ──
function getVideoInfo(url) {
  if (!url) return { type: null };
  const trimmed = url.trim();
  const ytMatch = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/);
  if (ytMatch) return { type: "youtube", id: ytMatch[1], trimmed };
  const vimeoMatch = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch) return { type: "vimeo", id: vimeoMatch[1], trimmed };
  const driveMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) return { type: "drive", id: driveMatch[1], trimmed };
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(trimmed)) return { type: "file", trimmed };
  return { type: "link", trimmed };
}

function watchedKey(mid) { return `video_watched_${user.user_id}_${mid}`; }
function fmtTime(sec) { sec = Math.max(0, Math.floor(sec || 0)); const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${s.toString().padStart(2, "0")}`; }

function updateVideoUI(mid, current, duration, isPlaying) {
  const fill = document.getElementById(`vc-progress-${mid}`);
  const time = document.getElementById(`vc-time-${mid}`);
  const btn = document.getElementById(`vc-playbtn-${mid}`);
  if (fill && duration > 0) fill.style.width = Math.min(100, (current / duration) * 100) + "%";
  if (time) time.textContent = `${fmtTime(current)} / ${fmtTime(duration)}`;
  if (btn) btn.textContent = isPlaying ? "⏸" : "▶";
}

function toggleVideoPlay(mid) {
  if (ytPlayers[mid]) { const state = ytPlayers[mid].getPlayerState(); if (state === 1) ytPlayers[mid].pauseVideo(); else ytPlayers[mid].playVideo(); return; }
  if (vimeoPlayers[mid]) { vimeoPlayers[mid].getPaused().then(paused => { paused ? vimeoPlayers[mid].play() : vimeoPlayers[mid].pause(); }); return; }
  const el = document.getElementById(`native-video-${mid}`);
  if (el) { el.paused ? el.play() : el.pause(); }
}

function renderVideoEmbed(url, mid, needsGate) {
  const vinfo = getVideoInfo(url);
  if (vinfo.type === null) return "";
  let inner = "";
  
  if (vinfo.type === "drive") needsGate = false; 

  if (vinfo.type === "youtube") {
    const origin = encodeURIComponent(window.location.origin);
    const params = needsGate ? `enablejsapi=1&origin=${origin}&rel=0&controls=0&disablekb=1&fs=0&modestbranding=1` : `rel=0`;
    inner = `<iframe id="yt-embed-${mid}" src="https://www.youtube-nocookie.com/embed/${vinfo.id}?${params}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe>`;
  } else if (vinfo.type === "vimeo") {
    const params = needsGate ? "?controls=false" : "";
    inner = `<iframe id="vimeo-embed-${mid}" src="https://player.vimeo.com/video/${vinfo.id}${params}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="autoplay; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe>`;
  } else if (vinfo.type === "drive") {
    inner = `<iframe id="drive-embed-${mid}" src="https://drive.google.com/file/d/${vinfo.id}/preview" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe>`;
  } else if (vinfo.type === "file") {
    inner = `<video id="native-video-${mid}" ${needsGate ? 'oncontextmenu="return false"' : 'controls'} style="position:absolute;top:0;left:0;width:100%;height:100%;background:#000;"><source src="${vinfo.trimmed}">Your browser doesn't support embedded video.</video>`;
  } else { 
    return `<div style="margin-top:1rem;"><a href="${vinfo.trimmed}" target="_blank" rel="noopener" class="btn-action btn-secondary" style="padding:0.6rem 1rem;font-size:0.85rem;">▶ Watch video</a></div>`; 
  }

  const customControls = needsGate ? `<div class="video-controls"><button onclick="toggleVideoPlay('${mid}')" id="vc-playbtn-${mid}" class="vc-play-btn">▶</button><div class="vc-progress-track"><div class="vc-progress-fill" id="vc-progress-${mid}"></div></div><span class="vc-time" id="vc-time-${mid}">0:00 / 0:00</span></div>` : "";
  return `<div class="video-wrap" id="video-wrap-${mid}" style="position:relative;padding-top:56.25%;border-radius:10px;overflow:hidden;margin-top:1rem;background:#000;">${inner}${customControls}<button class="cinema-toggle-btn" onclick="enterCinemaMode('${mid}')" title="Expand" style="position:absolute;top:8px;right:8px;width:34px;height:34px;border-radius:8px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.25);color:#fff;font-size:16px;cursor:pointer;z-index:5;display:flex;align-items:center;justify-content:center;">⛶</button></div>`;
}

function ensureYouTubeApi(cb) {
  if (window.YT && window.YT.Player) { cb(); return; }
  pendingYTInits.push(cb);
  if (ytApiLoading) return;
  ytApiLoading = true;
  const tag = document.createElement("script"); tag.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = function () { pendingYTInits.forEach(fn => fn()); pendingYTInits = []; };
}
function ensureVimeoApi(cb) {
  if (window.Vimeo && window.Vimeo.Player) { cb(); return; }
  if (!vimeoApiPromise) {
    vimeoApiPromise = new Promise(resolve => {
      const tag = document.createElement("script"); tag.src = "https://player.vimeo.com/api/player.js";
      tag.onload = resolve; document.head.appendChild(tag);
    });
  }
  vimeoApiPromise.then(cb);
}

function enterCinemaMode(mid) {
  const wrap = document.getElementById(`video-wrap-${mid}`);
  if (!wrap) return;
  cinemaActiveMid = mid;
  const isPortraitMobile = window.matchMedia("(max-width: 900px)").matches && window.innerHeight > window.innerWidth;
  wrap.classList.add("cinema");
  if (isPortraitMobile) wrap.classList.add("rotate");
  const expandBtn = wrap.querySelector(".cinema-toggle-btn");
  if (expandBtn) expandBtn.style.display = "none";
  const exitBtn = document.createElement("button"); exitBtn.id = "cinema-exit-btn"; exitBtn.className = "cinema-exit-btn"; exitBtn.textContent = "✕"; exitBtn.onclick = exitCinemaMode;
  document.body.appendChild(exitBtn); document.body.style.overflow = "hidden";
  if (!isPortraitMobile && wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {});
  window.addEventListener("resize", reevaluateCinemaOrientation); window.addEventListener("orientationchange", reevaluateCinemaOrientation);
}

function reevaluateCinemaOrientation() {
  if (!cinemaActiveMid) return;
  const wrap = document.getElementById(`video-wrap-${cinemaActiveMid}`);
  if (!wrap) return;
  const isPortraitMobile = window.matchMedia("(max-width: 900px)").matches && window.innerHeight > window.innerWidth;
  wrap.classList.toggle("rotate", isPortraitMobile);
}

function exitCinemaMode() {
  if (!cinemaActiveMid) return;
  const wrap = document.getElementById(`video-wrap-${cinemaActiveMid}`);
  if (wrap) { wrap.classList.remove("cinema", "rotate"); const expandBtn = wrap.querySelector(".cinema-toggle-btn"); if (expandBtn) expandBtn.style.display = "flex"; }
  const exitBtn = document.getElementById("cinema-exit-btn"); if (exitBtn) exitBtn.remove();
  document.body.style.overflow = "";
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  window.removeEventListener("resize", reevaluateCinemaOrientation); window.removeEventListener("orientationchange", reevaluateCinemaOrientation);
  cinemaActiveMid = null;
}

document.addEventListener("keydown", e => { if (e.key === "Escape" && cinemaActiveMid) exitCinemaMode(); });
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && cinemaActiveMid) exitCinemaMode(); });

function initVideoTracker(m) {
  const mid = m.milestone_id;
  if (getStatus(mid) !== "UNLOCKED" || sessionStorage.getItem(watchedKey(mid)) === "1") return; 
  const vinfo = getVideoInfo(m.video_url);
  if (vinfo.type === "youtube") ensureYouTubeApi(() => createYTTracker(mid));
  else if (vinfo.type === "vimeo") ensureVimeoApi(() => createVimeoTracker(mid));
  else if (vinfo.type === "file") createNativeTracker(mid);
}

function createYTTracker(mid) {
  const el = document.getElementById(`yt-embed-${mid}`);
  if (!el) return;
  let maxTime = 0;
  const player = new YT.Player(el, {
    events: {
      onReady: () => {
        ytPlayers[mid] = player;
        setInterval(() => {
          const p = ytPlayers[mid];
          if (!p || typeof p.getCurrentTime !== "function") return;
          const t = p.getCurrentTime(); const dur = p.getDuration ? p.getDuration() : 0;
          if (t > maxTime + 1.5) p.seekTo(maxTime, true); else if (t > maxTime) maxTime = t;
          updateVideoUI(mid, maxTime, dur, p.getPlayerState && p.getPlayerState() === 1);
        }, 500);
      },
      onStateChange: e => { if (e.data === YT.PlayerState.ENDED) markVideoWatched(mid); }
    }
  });
}

function createVimeoTracker(mid) {
  const el = document.getElementById(`vimeo-embed-${mid}`);
  if (!el) return;
  const player = new Vimeo.Player(el); vimeoPlayers[mid] = player;
  let maxTime = 0, duration = 0;
  player.getDuration().then(d => { duration = d; });
  player.on("timeupdate", data => { if (data.seconds > maxTime) maxTime = data.seconds; updateVideoUI(mid, maxTime, duration || data.duration, true); });
  player.on("play", () => updateVideoUI(mid, maxTime, duration, true));
  player.on("pause", () => updateVideoUI(mid, maxTime, duration, false));
  player.on("seeked", data => { if (data.seconds > maxTime + 1.5) player.setCurrentTime(maxTime); });
  player.on("ended", () => markVideoWatched(mid));
}

function createNativeTracker(mid) {
  const el = document.getElementById(`native-video-${mid}`);
  if (!el) return;
  let maxTime = 0;
  el.addEventListener("timeupdate", () => { if (el.currentTime > maxTime) maxTime = el.currentTime; updateVideoUI(mid, maxTime, el.duration, !el.paused); });
  el.addEventListener("play", () => updateVideoUI(mid, maxTime, el.duration, true));
  el.addEventListener("pause", () => updateVideoUI(mid, maxTime, el.duration, false));
  el.addEventListener("seeking", () => { if (el.currentTime > maxTime + 1.5) el.currentTime = maxTime; });
  el.addEventListener("ended", () => markVideoWatched(mid));
}

function markVideoWatched(mid) {
  sessionStorage.setItem(watchedKey(mid), "1");
  const lockNote = document.getElementById(`video-lock-note-${mid}`);
  const area = document.getElementById(`submission-area-${mid}`);
  if (lockNote) lockNote.style.display = "none";
  if (area) area.style.display = "block";
  if (cinemaActiveMid === mid) exitCinemaMode();
  showToast("Video complete — this step is now unlocked!", "success");
}

function renderSubmissionArea(m, status) {
  if (status === "PASSED") {
    const p = progress.find(p => p.milestone_id === m.milestone_id);
    return `<div style="background: var(--success-bg); border: 1px solid rgba(34,197,94,0.25); border-radius: 10px; padding: 1rem 1.25rem; font-size: 0.875rem; color: var(--success); display: flex; align-items: center; gap: 8px;">✅ Milestone completed${p?.score ? ` — Score: ${p.score}%` : ""}${p?.approved_at ? ` on ${fmtDate(p.approved_at)}` : ""}</div>`;
  }
  if (status === "SUBMITTED") return `<div style="background: var(--warning-bg); border: 1px solid rgba(245,158,11,0.25); border-radius: 10px; padding: 1rem 1.25rem; font-size: 0.875rem; color: var(--warning); display: flex; align-items: center; gap: 8px;">⏳ Your response is awaiting review by your leader. You'll be notified once verified.</div>`;
  if (status === "FAILED") return `<div style="margin-bottom:.75rem"><span class="badge badge--failed">❌ Not Passed — you may resubmit</span></div>${buildSubmissionForm(m)}`;
  if (status === "UNLOCKED") return buildSubmissionForm(m);
  return "";
}

function renderQuizQuestions(m) {
  const quiz = JSON.parse(m.quiz_json || "{}");
  return (quiz.questions || []).map((q, qi) => `<div id="qq-${m.milestone_id}-${q.id}" style="background: var(--bg-surface); border-radius: 10px; padding: 1.25rem; margin-bottom: 1rem;">
    <div style="font-weight: 500; font-size: 0.9rem; color: var(--text-main); margin-bottom: 0.875rem;">Q${qi+1}. ${q.text}</div>
    ${q.options.map((opt, oi) => `<label class="quiz-option" id="opt-${m.milestone_id}-${q.id}-${oi}" onclick="selectOpt('${m.milestone_id}','${q.id}',${oi})" style="display: flex; align-items: center; gap: 10px; padding: 0.6rem 0.875rem; border-radius: 8px; border: 1.5px solid var(--border-strong); cursor: pointer; margin-bottom: 6px; transition: all 0.15s; font-size: 0.875rem; color: var(--text-muted);"><input type="radio" name="${m.milestone_id}-${q.id}" value="${oi}" style="accent-color: var(--gold);"> ${opt}</label>`).join("")}
  </div>`).join("");
}

function buildSubmissionForm(m) {
  const type = m.submission_type;
  let html = `<div style="margin-top: 1.25rem;"><div style="font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--gold); margin-bottom: 1rem; font-weight: 500;">`;
  if (type === "CHECKBOX") {
    html += `Complete this milestone</div>
      <label id="chk-label-${m.milestone_id}" style="display: flex; align-items: flex-start; gap: 12px; background: var(--bg-surface); border-radius: 10px; padding: 1.25rem; cursor: pointer;">
        <input type="checkbox" id="chk-${m.milestone_id}" onchange="toggleCheckbox('${m.milestone_id}')" style="width: 18px; height: 18px; margin-top: 2px; accent-color: var(--gold); cursor: pointer; flex-shrink: 0;">
        <div style="font-size: 0.875rem; color: var(--text-muted); line-height: 1.6;"><strong style="color: var(--text-main);">I confirm</strong> that I have read and understood the content of this milestone and am ready to proceed.</div>
      </label><br>
      <button class="btn-action btn-primary" id="btn-${m.milestone_id}" disabled onclick="submitCheckbox('${m.milestone_id}', '${currentCourse.course_id}')">Mark Complete</button>`;
  } else if (type === "QUIZ") {
    html += `Quiz Assessment (pass mark: ${m.pass_score}%)</div><div id="quiz-${m.milestone_id}">${renderQuizQuestions(m)}</div><button class="btn-action btn-primary" id="btn-${m.milestone_id}" onclick="submitQuiz('${m.milestone_id}', '${currentCourse.course_id}')">Submit Quiz</button><div id="quiz-result-${m.milestone_id}" style="display:none"></div>`;
  } else if (type === "WRITTEN") {
    html += `Written Response (reviewed by leadership)</div>
      <textarea id="wr-${m.milestone_id}" placeholder="Write your response here..." rows="6" style="width: 100%; min-height: 140px; padding: 1rem; background: var(--bg-surface); border: 1.5px solid var(--border-strong); border-radius: 10px; color: var(--text-main); font-family: 'Inter', sans-serif; font-size: 0.875rem; line-height: 1.6; resize: vertical; outline: none; transition: border-color 0.2s;"></textarea><br>
      <button class="btn-action btn-primary" style="margin-top: 1rem;" id="btn-${m.milestone_id}" onclick="submitWritten('${m.milestone_id}', '${currentCourse.course_id}')">Submit Response</button>`;
  }
  html += `</div>`; return html;
}

function toggleCard(mid) {
  const body  = document.getElementById(`body-${mid}`); const chev  = document.getElementById(`chev-${mid}`);
  const isOpen = body.style.display === "block";
  document.querySelectorAll('[id^="body-"]').forEach(b => { if(b.id !== `body-${mid}`) b.style.display = "none"; });
  document.querySelectorAll('[id^="chev-"]').forEach(c => { if(c.id !== `chev-${mid}`) c.style.transform = "rotate(0deg)"; });
  if (!isOpen) { body.style.display = "block"; if(chev) chev.style.transform = "rotate(180deg)"; } 
  else { body.style.display = "none"; if(chev) chev.style.transform = "rotate(0deg)"; }
}

function toggleCheckbox(mid) { const checked = document.getElementById(`chk-${mid}`).checked; document.getElementById(`btn-${mid}`).disabled = !checked; }

function selectOpt(mid, qid, optIdx) {
  document.querySelectorAll(`[id^="opt-${mid}-${qid}-"]`).forEach(el => { el.style.borderColor = "var(--border-strong)"; el.style.background = "transparent"; el.style.color = "var(--text-muted)"; });
  const selectedEl = document.getElementById(`opt-${mid}-${qid}-${optIdx}`);
  selectedEl.style.borderColor = "var(--gold)"; selectedEl.style.background = "var(--gold-bg)"; selectedEl.style.color = "var(--gold-lt)";
}

async function submitCheckbox(mid, courseId) {
  const btn = document.getElementById(`btn-${mid}`); btn.disabled = true; btn.textContent = "Saving…";
  const res = await apiCall("submitCheckbox", { user_id: user.user_id, milestone_id: mid, course_id: courseId });
  if (res.success) { showToast("Milestone marked complete!", "success"); await refreshProgress(courseId); }
  else { showToast(res.error || "Error", "error"); btn.disabled = false; btn.textContent = "Mark Complete"; }
}

async function submitQuiz(mid, courseId) {
  const btn = document.getElementById(`btn-${mid}`); const quiz = milestones.find(m => m.milestone_id === mid); if (!quiz) return;
  const questions = JSON.parse(quiz.quiz_json || "{}").questions || [];
  const answers = {}; let allAnswered = true;
  questions.forEach(q => { const sel = document.querySelector(`input[name="${mid}-${q.id}"]:checked`); if (sel) answers[q.id] = parseInt(sel.value); else allAnswered = false; });
  if (!allAnswered) { showToast("Please answer all questions before submitting.", "error"); return; }
  btn.disabled = true; btn.textContent = "Submitting…";
  const res = await apiCall("submitQuiz", { user_id: user.user_id, milestone_id: mid, course_id: courseId, answers });
  if (res.success) {
    const qData = JSON.parse(quiz.quiz_json || "{}");
    qData.questions.forEach(q => {
      const userAns = answers[q.id], correct = parseInt(q.correct);
      for (let i = 0; i < q.options.length; i++) {
        const el = document.getElementById(`opt-${mid}-${q.id}-${i}`); if (!el) continue; el.style.pointerEvents = "none";
        if (i === correct) { el.style.borderColor = "var(--success)"; el.style.background = "var(--success-bg)"; el.style.color = "var(--success)"; } 
        else if (i === userAns && userAns !== correct) { el.style.borderColor = "var(--error)"; el.style.background = "var(--error-bg)"; el.style.color = "var(--error)"; }
      }
    });
    const scoreColor = res.passed ? "var(--success)" : "var(--error)";
    const resultEl = document.getElementById(`quiz-result-${mid}`);
    resultEl.style.display = "block";
    resultEl.innerHTML = `<div style="background: var(--bg-surface); border-radius: 12px; padding: 1.5rem; text-align: center; margin-top: 1rem;"><div style="font-family: 'DM Serif Display', serif; font-size: 3rem; line-height: 1; margin-bottom: 0.5rem; color:${scoreColor}">${res.score}%</div><div style="font-size: 0.875rem; color: var(--text-dim);">${res.correct} of ${res.total} correct · Pass mark: ${res.passScore}%</div><p style="margin-top:.75rem;font-size:.875rem;color:${scoreColor};font-weight:500">${res.passed ? '🎉 Passed! The next pathway has been unlocked.' : '❌ Not passed. Review the content and try again.'}</p></div>`;
    btn.style.display = "none";
    if (!res.passed) resultEl.innerHTML += `<button class="btn-action btn-secondary" style="margin-top: 0.75rem; padding: 0.625rem 1.25rem; font-size: 0.875rem;" onclick="retakeQuiz('${mid}')">Try Again</button>`;
    if (res.passed) { showToast(`Quiz passed with ${res.score}%! 🎉`, "success"); await refreshProgress(courseId); } 
    else { showToast(`Score: ${res.score}% — need ${res.passScore}% to pass.`, "error"); }
  } else { showToast(res.error || "Submission error", "error"); btn.disabled = false; btn.textContent = "Submit Quiz"; }
}

function retakeQuiz(mid) {
  const m = milestones.find(x => x.milestone_id === mid);
  if (!m) return;

  const quizEl = document.getElementById(`quiz-${mid}`);
  if (quizEl) quizEl.innerHTML = renderQuizQuestions(m);

  const resultEl = document.getElementById(`quiz-result-${mid}`);
  if (resultEl) { resultEl.style.display = "none"; resultEl.innerHTML = ""; }

  const btn = document.getElementById(`btn-${mid}`);
  if (btn) { btn.style.display = ""; btn.disabled = false; btn.textContent = "Submit Quiz"; }
}

async function submitWritten(mid, courseId) {
  const content = document.getElementById(`wr-${mid}`).value.trim();
  if (!content || content.length < 20) { showToast("Please write a more detailed response (at least 20 characters).", "error"); return; }
  const btn = document.getElementById(`btn-${mid}`); btn.disabled = true; btn.textContent = "Submitting…";
  const res = await apiCall("submitWritten", { user_id: user.user_id, milestone_id: mid, course_id: courseId, content });
  if (res.success) { showToast("Response submitted for review!", "success"); await refreshProgress(courseId); } 
  else { showToast(res.error || "Error", "error"); btn.disabled = false; btn.textContent = "Submit Response"; }
}

async function refreshProgress(courseId) {
  const pRes = await apiCall("getProgress", { user_id: user.user_id, course_id: courseId });
  progress = pRes.progress || []; renderTrack();
}

// ── MOBILE SIDEBAR ──
function toggleMobileSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const isOpen = sidebar.classList.toggle("open");
  const overlay = document.getElementById("sidebarOverlay");
  if(overlay) overlay.classList.toggle("active", isOpen);
  const btn = document.getElementById("mobileMenuBtn");
  if(btn) btn.textContent = isOpen ? "✕" : "☰";
}
function closeMobileSidebar() {
  const sidebar = document.querySelector(".sidebar"); if(sidebar) sidebar.classList.remove("open");
  const overlay = document.getElementById("sidebarOverlay"); if(overlay) overlay.classList.remove("active");
  const btn = document.getElementById("mobileMenuBtn"); if(btn) btn.textContent = "☰";
}