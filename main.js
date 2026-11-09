// ============================================================
//  LIVING BY DESIGN NATION — MAIN JAVASCRIPT
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycby_9iOJuOAmTlRh_MdKFvYraBIEoyu7TydALdsNTJo-MXBjhndrt1cxbLMg1Eo8qSetcg/exec";

// Global Shared Variables
let user, allProgress = [], pendingReviews = [], allUsers = [], allCourses = [], milestones = [], progress = [];
let filteredProgress = [], lastGroupedMembers = [];
let currentCourse = null;
let userRoadmap = [];
let userBatch = null;
let adminBatches = [];
let learnerBatchFilter = "";   // active training batch { name, start_date, end_date, note }
let totalCurriculumMilestones = 0;

// Graduation Module (Learner Side)
let graduationStatus = null;   // { eligible, graduation } from getGraduationStatus
let currentView = 'dashboard'; // 'dashboard' | 'course' | 'graduation' — used to highlight the sidebar
let selectedServiceChoice = null;
const GRADUATION_SERVICE_OPTIONS = [
  { value: "ASSIGNMENT_BY_HOPE",    label: "Assignment By Hope",     desc: "Head of Operations, Projects and Execution" },
  { value: "ADMINISTRATIVE_TASKS",  label: "Administrative Tasks",   desc: "Support the day-to-day running of the Nation" },
  { value: "OTHERS",                label: "Others",                 desc: "Somewhere else you feel called to serve" }
];

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
// The backend now issues an opaque session token on login (see Code.gs).
// Every call automatically attaches it — the server resolves the real
// user_id/role from that token, so a client can no longer just claim
// requester_role:"ADMIN" to unlock privileged actions.
async function apiCall(action, payload = {}, opts = {}) {
  const session = getSession();
  const res = await fetch(API_URL, {
    method: "POST",
    mode: "cors",
    keepalive: !!opts.keepalive,   // lets a save finish while the page is closing
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, token: session ? session.token : undefined, ...payload })
  });
  const data = await res.json();
  if (data && data.sessionExpired) {
    clearSession();
    showToast("Your session expired — please sign in again.", "error");
    setTimeout(() => { window.location.href = "login.html"; }, 1200);
  }
  // Batch gate: the server says this learner's batch isn't running → full-screen lock.
  if (data && data.locked) showLockOverlay(data.lock);
  return data;
}

// PERSISTENT SESSION — the session now lives in localStorage (not
// sessionStorage), so it survives tab closes, app switches and phone
// restarts. The server keeps a durable Sessions record (30-day sliding
// window), so a returning learner lands straight back on their dashboard
// instead of being thrown to the login screen.
function getSession() {
  try { return JSON.parse(localStorage.getItem("wtp_user")); } catch { return null; }
}
function setSession(userObj) { localStorage.setItem("wtp_user", JSON.stringify(userObj)); }
function clearSession() { localStorage.removeItem("wtp_user"); }
async function logout() {
  if (typeof stopGraduationPolling === "function") stopGraduationPolling();
  const session = getSession();
  if (session && session.token) {
    try { await apiCall("logout", {}); } catch (e) { /* best effort — clear locally regardless */ }
  }
  clearSession();
  window.location.href = "index.html";
}

function requireAuth(allowedRoles) {
  const currentUser = getSession();
  if (!currentUser || !currentUser.token) { window.location.href = "login.html"; return null; }
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
  // escHtml here because some callers interpolate user-supplied names
  // (e.g. a new registrant's full_name) straight into the message string.
  toast.innerHTML = `<span class="wtp-toast-icon">${icons[type] || "ℹ"}</span><span>${escHtml(message)}</span>`;
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
  // Also escapes single quotes so values are safe inside single-quoted
  // HTML attributes and data-* attributes.
  return (str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
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

// ── DELEGATED EVENT DISPATCHER ──
// Dynamically-rendered content (tables, milestone cards, quiz options,
// buttons) never carries inline onclick="..." handlers built from data
// strings — one malformed name used to be enough to break a whole table.
// Instead every interactive element declares data-call="handlerName" plus
// data-* arguments, and these two listeners route events. Escape the data
// with escHtml() and the markup is injection-safe by construction.
const __dataArgs = el => {
  const args = {};
  for (const [k, v] of Object.entries(el.dataset)) { if (k !== "call" && k !== "change") args[k] = v; }
  return args;
};
document.addEventListener("click", e => {
  const el = e.target.closest("[data-call]");
  if (!el) return;
  const fn = window[el.getAttribute("data-call")];
  if (typeof fn !== "function") { console.warn("No handler for data-call:", el.getAttribute("data-call")); return; }
  if (el.tagName === "A") e.preventDefault();
  fn(__dataArgs(el), el);
});
document.addEventListener("change", e => {
  const el = e.target.closest("[data-change]");
  if (!el) return;
  const fn = window[el.getAttribute("data-change")];
  if (typeof fn !== "function") { console.warn("No handler for data-change:", el.getAttribute("data-change")); return; }
  fn(__dataArgs(el), el);
});

// Mirrors the server's password policy so users get instant feedback
// before a round-trip (the server re-validates — never trust the client).
function validatePasswordClient_(pw) {
  const issues = [];
  if (!pw || pw.length < 8) issues.push("at least 8 characters");
  if (!pw || !/[A-Za-z]/.test(pw)) issues.push("at least one letter");
  if (!pw || !/[0-9]/.test(pw)) issues.push("at least one number");
  return issues.length ? "Password needs " + issues.join(", ") + "." : null;
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
      setSession({ ...result.user, token: result.token });
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
  const pwIssue = validatePasswordClient_(password);
  if (pwIssue) { if (errEl) { errEl.textContent = pwIssue; errEl.style.display = "block"; } return; }
  if (btn) setBtnLoading(btn, "Creating account…");

  try {
    const result = await apiCall("signup", { fname, lname, username, email, password, tribe_id, hub_id, colony, phone, start_date });

    if (result.success) {
      showToast(result.emailSent ? "Account created! Your login details were emailed to you — check your inbox (or spam). You can now sign in." : "Account created successfully! You can now sign in.", "success");
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
  const facPwIssue = validatePasswordClient_(password);
  if (facPwIssue) { if (errEl) { errEl.textContent = facPwIssue; errEl.style.display = "block"; } return; }
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
  const views = ['login-view', 'signup-view', 'facilitator-signup-view', 'forgot-view'];
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

  // ── INIT: LANDING PAGE — offer a one-tap "continue" when a live session exists
  if (document.getElementById("portalCtaLink")) {
    const existing = getSession();
    if (existing && existing.token) {
      document.getElementById("portalCtaLink").innerHTML = '<span>→</span> CONTINUE TO PORTAL';
    }
  }

  // ── INIT: LOGIN PAGE ──
  if (document.getElementById("auth-container")) {
    // PERSISTENT SESSION: if a valid token is still stored, skip the form
    // entirely and drop the user straight into their portal. Logging out
    // from either dashboard clears the session, so "switch account" still
    // works through the Sign Out button.
    const existing = getSession();
    if (existing && existing.token) {
      window.location.replace(["TEACHER","ADMIN"].includes(existing.role) ? "admin.html" : "learner.html");
      return;
    }
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
      const batchCard = document.getElementById("batchCard"); if (batchCard) batchCard.style.display = "none";
      document.getElementById("addMemberBtn").style.display = "none";
      document.getElementById("usersViewSub").textContent = "View existing member accounts";
      const adminApprovalSection = document.getElementById("adminApprovalSection");
      if (adminApprovalSection) adminApprovalSection.style.display = "none";
    }

    try {
      // ONE aggregated call replaces the old 16–19 per-view requests.
      await loadAdminDashboard();
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
      startNotificationPolling(); // lightweight unread badge refresh
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

// Graduation Module (Admin/Facilitator Side)
let pendingGraduationsFacilitator = [];
let pendingGraduationsAdmin = [];
let graduatedMembers = [];

// Milestone counts per course + totals, served by the aggregated dashboard.
let milestoneCountsByCourse = {};
// Essay-project snapshot returned by getProjectAdminData.
let projectStats = null;
let currentProjectAdmin = null;
// Milestone list of the course currently open in the curriculum editor.
let courseMilestonesCache = [];
let editingMilestoneId = null;
// Learner-side notification feed cache.
let notifState = { items: [], unread: 0 };

// ── ONE CALL POWERS THE WHOLE ADMIN DASHBOARD ──
// getAdminDashboard returns users, progress, pending reviews, courses,
// milestone counts, both graduation queues, graduated members, project
// stats, facilitator lists (admin only) and the admin's own notification
// feed in a single round-trip — replacing the 16–19 calls per refresh.
async function loadAdminDashboard() {
  const res = await apiCall("getAdminDashboard", {});
  if (!res || res.error) throw new Error(res && res.error || "Failed to load dashboard");

  allUsers = res.users || [];
  adminBatches = res.batches || [];
  populateBatchFilter();
  allProgress = res.progress || [];
  pendingReviews = res.pendingReviews || [];
  allCourses = res.courses || [];
  milestoneCountsByCourse = res.milestoneCounts || {};
  totalCurriculumMilestones = (res.counts && res.counts.totalMilestones) || 0;
  pendingGraduationsFacilitator = res.gradFacilitator || [];
  pendingGraduationsAdmin = res.gradAdmin || [];
  graduatedMembers = res.graduated || [];
  if (res.pendingFacilitators) pendingFacilitators = res.pendingFacilitators;
  if (res.activeTeachers) activeTeachers = res.activeTeachers;
  projectStats = res.projectStats || null;

  detectNewRegistrations();
  detectNewGraduationRequests_();
  applyProgressFilters();
  renderLearnerCards();
  applyLearnerCardFilter();
  renderUsersTable();
  renderAdminCoursesTable();
  renderPendingTable();
  renderGradFacilitatorTable();
  renderGradAdminTable();
  renderGraduatedMembersTable();
  renderFacilitatorsTable();
  renderActiveTeachersTable();
  updatePendingBadge();
  updateGraduationBadge();
  updateFacilitatorBadge();
  renderProjectStats();
  updateAdminBell(res.notif);
}

function updateGraduationBadge() {
  const badge = document.getElementById("graduationBadge");
  if (!badge) return;
  const count = pendingGraduationsFacilitator.length + pendingGraduationsAdmin.length;
  if (count > 0) { badge.style.display = "inline"; badge.textContent = count; }
  else badge.style.display = "none";
}

function updateFacilitatorBadge() {
  const badge = document.getElementById("facilitatorBadge");
  if (!badge) return;
  if (pendingFacilitators.length > 0) { badge.style.display = "inline"; badge.textContent = pendingFacilitators.length; }
  else badge.style.display = "none";
}

async function pollUpdates() {
  if (isPolling) return;
  isPolling = true;
  const btn = document.getElementById("refreshBtn");
  if (btn) btn.classList.add("loading");
  try {
    await loadAdminDashboard();
    renderStats();
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

// Renders from the activeTeachers array filled by loadAdminDashboard().
function renderActiveTeachersTable() {
  const tbody = document.getElementById("activeTeachersBody");
  if(!tbody) return;
  if (!activeTeachers.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:2rem">No active facilitators yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = activeTeachers.map(t => `
    <tr id="teacher-row-${escHtml(t.user_id)}">
      <td data-label="Name">${escHtml(t.full_name)}</td>
      <td data-label="Username" style="font-family:'JetBrains Mono',monospace;font-size:.82rem;color:var(--text-muted)">${escHtml(t.username)}</td>
      <td data-label="Active Since" style="color:var(--text-dim);font-size:.8rem">${fmtDate(t.created_at)}</td>
      <td data-label="Action"><button class="chip-btn chip-btn--steel" data-call="promoteToAdmin" data-user_id="${escHtml(t.user_id)}" data-name="${escHtml(t.full_name)}">⬆ Promote to Admin</button></td>
    </tr>`).join("");
}

async function promoteToAdmin(args) {
  const userId = args.user_id, name = args.name;
  if (!confirm(`Promote ${name} to Admin? They will gain full platform access.`)) return;
  const row = document.getElementById(`teacher-row-${userId}`);
  if (row) row.style.opacity = "0.5";
  const res = await apiCall("promoteToAdmin", { user_id: userId });
  if (res.success) {
    showToast(`${name} promoted to Admin.`, "success");
    activeTeachers = activeTeachers.filter(t => t.user_id !== userId);
    renderActiveTeachersTable();
  } else {
    showToast(res.error || "Error", "error");
    if (row) row.style.opacity = "1";
  }
}

// Renders from the pendingFacilitators array filled by loadAdminDashboard().
function renderFacilitatorsTable() {
  const tbody = document.getElementById("facilitatorsBody");
  if(!tbody) return;
  if (!pendingFacilitators.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:2rem">No pending requests. 🎉</td></tr>`;
    return;
  }
  tbody.innerHTML = pendingFacilitators.map(f => `
    <tr id="fac-row-${escHtml(f.user_id)}">
      <td data-label="Name">${escHtml(f.full_name)}</td>
      <td data-label="Username" style="font-family:'JetBrains Mono',monospace;font-size:.82rem;color:var(--text-muted)">${escHtml(f.username)}</td>
      <td data-label="Requested" style="color:var(--text-dim);font-size:.8rem">${fmtDate(f.created_at)}</td>
      <td data-label="Action"><button class="chip-btn chip-btn--success" data-call="approveFacilitator" data-user_id="${escHtml(f.user_id)}">✓ Approve</button></td>
    </tr>`).join("");
}

async function approveFacilitator(args) {
  const userId = args.user_id;
  const row = document.getElementById(`fac-row-${userId}`);
  if (row) row.style.opacity = "0.5";
  const res = await apiCall("approveFacilitator", { user_id: userId });
  if (res.success) {
    showToast("Facilitator approved — they can now sign in.", "success");
    pendingFacilitators = pendingFacilitators.filter(f => f.user_id !== userId);
    renderFacilitatorsTable();
    updateFacilitatorBadge();
  } else {
    showToast(res.error || "Error", "error");
    if (row) row.style.opacity = "1";
  }
}

// ==========================================
// GRADUATION MODULE (ADMIN/FACILITATOR SIDE)
// ==========================================
function graduationChoiceLabel(value) {
  const o = GRADUATION_SERVICE_OPTIONS.find(o => o.value === value);
  return o ? o.label : (value || "—");
}

// Both graduation queues arrive pre-filled from loadAdminDashboard();
// detectNewGraduationRequests_() runs there too.
function renderGradTables() {
  renderGradFacilitatorTable();
  renderGradAdminTable();
}

// Same pattern as detectNewRegistrations() below — toasts once per newly-seen
// grad_id so a facilitator/admin sitting on the dashboard notices a fresh
// submission without having to keep switching tabs to check.
let knownGradIds = null;
function detectNewGraduationRequests_() {
  const seen = new Map();
  pendingGraduationsFacilitator.forEach(g => seen.set(g.grad_id, g));
  pendingGraduationsAdmin.forEach(g => seen.set(g.grad_id, g));
  const currentIds = new Set(seen.keys());

  if (knownGradIds === null) { knownGradIds = currentIds; return; }
  const newOnes = Array.from(currentIds).filter(id => !knownGradIds.has(id)).map(id => seen.get(id));
  knownGradIds = currentIds;
  if (!newOnes.length) return;

  if (newOnes.length === 1) showToast(`New graduation request: ${newOnes[0].full_name}`, "success");
  else showToast(`${newOnes.length} new graduation requests`, "success");
}

function renderGradFacilitatorTable() {
  const tbody = document.getElementById("gradFacilitatorBody");
  if (!tbody) return;
  if (!pendingGraduationsFacilitator.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:2rem">No graduation requests awaiting facilitator approval. 🎉</td></tr>`;
    return;
  }
  tbody.innerHTML = pendingGraduationsFacilitator.map(g => `
    <tr id="grad-facil-row-${escHtml(g.grad_id)}">
      <td data-label="Member">${escHtml(g.full_name)}</td>
      <td data-label="Username" style="font-family:'JetBrains Mono',monospace;font-size:.82rem;color:var(--text-muted)">${escHtml(g.username)}</td>
      <td data-label="Service Choice" style="color:var(--text-main);font-size:.85rem">${escHtml(graduationChoiceLabel(g.service_choice))}</td>
      <td data-label="Requested" style="color:var(--text-dim);font-size:.8rem">${fmtDate(g.created_at)}</td>
      <td data-label="Action"><button class="chip-btn chip-btn--success" data-call="approveGraduationFacilitator" data-grad_id="${escHtml(g.grad_id)}" data-name="${escHtml(g.full_name)}">✓ Approve</button></td>
    </tr>`).join("");
}

function renderGradAdminTable() {
  const tbody = document.getElementById("gradAdminBody");
  if (!tbody) return;
  if (user.role !== "ADMIN") { tbody.innerHTML = ""; return; }
  if (!pendingGraduationsAdmin.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:2rem">No graduation requests awaiting admin approval. 🎉</td></tr>`;
    return;
  }
  tbody.innerHTML = pendingGraduationsAdmin.map(g => `
    <tr id="grad-admin-row-${escHtml(g.grad_id)}">
      <td data-label="Member">${escHtml(g.full_name)}</td>
      <td data-label="Username" style="font-family:'JetBrains Mono',monospace;font-size:.82rem;color:var(--text-muted)">${escHtml(g.username)}</td>
      <td data-label="Service Choice" style="color:var(--text-main);font-size:.85rem">${escHtml(graduationChoiceLabel(g.service_choice))}</td>
      <td data-label="Requested" style="color:var(--text-dim);font-size:.8rem">${fmtDate(g.created_at)}</td>
      <td data-label="Action"><button class="chip-btn chip-btn--success" data-call="approveGraduationAdmin" data-grad_id="${escHtml(g.grad_id)}" data-name="${escHtml(g.full_name)}">✓ Approve</button></td>
    </tr>`).join("");
}

async function approveGraduationFacilitator(args) {
  const gradId = args.grad_id, name = args.name;
  if (!confirm(`Approve ${name}'s graduation request as facilitator?`)) return;
  const row = document.getElementById(`grad-facil-row-${gradId}`);
  if (row) row.style.opacity = "0.5";
  const res = await apiCall("approveGraduationFacilitator", { grad_id: gradId });
  if (res.success) {
    showToast(`Facilitator approval recorded for ${name}.`, "success");
    pendingGraduationsFacilitator = pendingGraduationsFacilitator.filter(g => g.grad_id !== gradId);
    renderGradFacilitatorTable();
    await Promise.all([loadPendingGraduations(), loadGraduatedMembers()]);
  } else {
    showToast(res.error || "Error", "error");
    if (row) row.style.opacity = "1";
  }
}

async function approveGraduationAdmin(args) {
  const gradId = args.grad_id, name = args.name;
  if (!confirm(`Approve ${name}'s graduation request as admin? If facilitator sign-off is already in, this will finalize their graduation.`)) return;
  const row = document.getElementById(`grad-admin-row-${gradId}`);
  if (row) row.style.opacity = "0.5";
  const res = await apiCall("approveGraduationAdmin", { grad_id: gradId });
  if (res.success) {
    showToast(`Admin approval recorded for ${name}.`, "success");
    pendingGraduationsAdmin = pendingGraduationsAdmin.filter(g => g.grad_id !== gradId);
    renderGradAdminTable();
    await Promise.all([loadPendingGraduations(), loadGraduatedMembers()]);
  } else {
    showToast(res.error || "Error", "error");
    if (row) row.style.opacity = "1";
  }
}

// Renders from the graduatedMembers array filled by loadAdminDashboard().
function renderGraduatedMembersTable() {
  const tbody = document.getElementById("completedBody");
  if (!tbody) return;
  if (!graduatedMembers.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:2rem">No members have graduated yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = graduatedMembers
    .slice()
    .sort((a, b) => new Date(b.approved_at) - new Date(a.approved_at))
    .map(g => `
    <tr>
      <td data-label="Name">${escHtml(g.full_name)}</td>
      <td data-label="Username" style="font-family:'JetBrains Mono',monospace;font-size:.82rem;color:var(--text-muted)">${escHtml(g.username)}</td>
      <td data-label="Service Assignment" style="color:var(--text-main);font-size:.85rem">${escHtml(graduationChoiceLabel(g.service_choice))}</td>
      <td data-label="Graduated" style="color:var(--text-dim);font-size:.8rem">${fmtDate(g.approved_at)}</td>
    </tr>`).join("");
}

// Renders from the allCourses array filled by loadAdminDashboard(); the
// nf-course select used to be filled by a separate getCourses call.
function renderAdminCoursesTable() {
  const sel = document.getElementById("nf-course");
  if (sel) {
    sel.innerHTML = '<option value="">— Select course —</option>';
    allCourses.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.course_id; opt.textContent = c.title;
      sel.appendChild(opt);
    });
  }
  // The broadcast composer's course picker shares the same option list.
  const bcSel = document.getElementById("bc-course");
  if (bcSel) {
    bcSel.innerHTML = '<option value="">— Select course —</option>';
    allCourses.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.course_id; opt.textContent = c.title;
      bcSel.appendChild(opt);
    });
  }
  const tbody = document.getElementById("adminCoursesBody");
  if(!tbody) return;
  if(!allCourses.length) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:2rem">No courses found.</td></tr>`; return; }
  tbody.innerHTML = allCourses.map(c => `
    <tr>
      <td data-label="Course Title" style="font-weight:500;color:var(--text-main)">${escHtml(c.title)}</td>
      <td data-label="Description" style="color:var(--text-muted);font-size:0.85rem">${escHtml(c.description)}</td>
      <td data-label="Course ID" style="color:var(--text-dim);font-size:0.85rem;font-family:'JetBrains Mono',monospace;">${escHtml(c.course_id)}</td>
      <td data-label="Milestones" style="font-family:'JetBrains Mono',monospace;font-size:.85rem;color:var(--gold-lt)">${milestoneCountsByCourse[c.course_id] || 0}</td>
      <td data-label="Action">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="chip-btn chip-btn--gold" data-call="openMilestoneModal" data-course_id="${escHtml(c.course_id)}" data-course_title="${escHtml(c.title)}">➕ Add Milestone</button>
          <button class="chip-btn chip-btn--steel" data-call="openMilestoneList" data-course_id="${escHtml(c.course_id)}" data-course_title="${escHtml(c.title)}">✏️ Milestones</button>
        </div>
      </td>
    </tr>`).join("");
}

// Renders from the allUsers array filled by loadAdminDashboard().
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
  const res = await apiCall("getPendingReviews", {});
  pendingReviews = res.pending || [];
  updatePendingBadge();
  renderPendingTable();
}

let activeStatCard = "";

function activeBatchObj() { return (adminBatches || []).find(b => b.is_active) || null; }

// Rows for each tappable stat card — the same lists the counts are made from.
function statCardRows(key) {
  const grouped = groupProgressByMember(allProgress);
  const gById = {}; grouped.forEach(m => { gById[m.user_id] = m; });
  const uById = {}; allUsers.forEach(u => { uById[u.user_id] = u; });
  const prog = id => { const m = gById[id]; return m && m.total > 0 ? `${m.passed}/${m.total} passed (${m.rate}%)` : "Not started"; };
  const row = (id, extra) => {
    const u = uById[id] || {}, m = gById[id] || {};
    return { name: u.full_name || m.full_name || id, username: u.username || m.username || "", email: u.email || "", phone: u.phone || "",
             batch: batchNameOf(u.batch_id), extra: extra };
  };
  if (key === "members")  return { head: "Progress", rows: allUsers.map(u => row(u.user_id, prog(u.user_id))) };
  if (key === "enrolled") return { head: "Progress", rows: grouped.filter(m => m.total > 0).map(m => row(m.user_id, prog(m.user_id))) };
  if (key === "completed") {
    const done = totalCurriculumMilestones > 0 ? grouped.filter(m => m.passed >= totalCurriculumMilestones) : [];
    return { head: "Progress", rows: done.map(m => row(m.user_id, prog(m.user_id))) };
  }
  if (key === "pending") {
    const by = {};
    pendingReviews.forEach(p => { (by[p.user_id] = by[p.user_id] || { name: p.full_name, titles: [] }).titles.push(p.milestone_title || p.milestone_id); });
    return { head: "Waiting on", rows: Object.keys(by).map(id => { const r = row(id, by[id].titles.join(", ")); if (!uById[id]) r.name = by[id].name || id; return r; }) };
  }
  if (key === "batch") {
    const b = activeBatchObj();
    return { head: "Progress", rows: b ? allUsers.filter(u => u.batch_id === b.batch_id).map(u => row(u.user_id, prog(u.user_id))) : [] };
  }
  return { head: "", rows: [] };
}

function renderStats() {
  const el = document.getElementById("statGrid");
  if(!el) return;

  const totalMembers = allUsers.length;
  const grouped = groupProgressByMember(allProgress);

  // "Enrolled" = has at least one Progress row, i.e. is actually enrolled in
  // a course (auto-enrollment happens the first time their dashboard loads).
  const enrolledMembers = grouped.filter(m => m.total > 0).length;
  const pending = pendingReviews.length;

  // "Completed" = passed every milestone across the full active curriculum.
  const completedMembers = totalCurriculumMilestones > 0
    ? grouped.filter(m => m.passed >= totalCurriculumMilestones).length
    : 0;

  const ab = activeBatchObj();
  const batchCount = ab ? allUsers.filter(u => u.batch_id === ab.batch_id).length : null;
  const batchSub = ab ? `${ab.name} · ${fmtBatchDate(ab.start_date)} → ${fmtBatchDate(ab.end_date)}` : "No active batch";

  const card = (key, icon, cls, num, label, sub) => `
    <button type="button" class="kpi-card kpi-card--btn ${activeStatCard === key ? "active" : ""}" data-call="toggleStatCard" data-key="${key}" aria-pressed="${activeStatCard === key}">
      <div class="kpi-icon ${cls}">${icon}</div>
      <div class="kpi-body"><div class="kpi-num">${num}</div><div class="kpi-label">${label}</div>${sub ? `<div class="kpi-sub">${escHtml(sub)}</div>` : ""}</div>
    </button>`;

  el.innerHTML =
    card("members",   "👥", "kpi-icon--steel",   totalMembers,      "Members") +
    card("enrolled",  "📘", "kpi-icon--gold",    enrolledMembers,   "Enrolled Members") +
    card("pending",   "⏳", "kpi-icon--warning", pending,           "Awaiting Review") +
    card("completed", "🏆", "kpi-icon--success", completedMembers,  "Members Completed") +
    card("batch",     "🗓", "kpi-icon--steel",   batchCount === null ? "—" : batchCount, "Current Batch", batchSub);

  renderStatDetail();
  if (typeof renderBatchSections === "function") renderBatchSections();
}

function toggleStatCard(args) {
  activeStatCard = (activeStatCard === args.key) ? "" : args.key;
  renderStats();
  if (activeStatCard) {
    const p = document.getElementById("statDetail");
    if (p && p.scrollIntoView) p.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}
function closeStatDetail() { activeStatCard = ""; renderStats(); }

function renderStatDetail() {
  const panel = document.getElementById("statDetail");
  if (!panel) return;
  if (!activeStatCard) { panel.style.display = "none"; return; }
  const titles = { members: "Members in the database", enrolled: "Enrolled members", pending: "Members awaiting review", completed: "Members completed", batch: "Current batch" };
  const { head, rows } = statCardRows(activeStatCard);
  const ab = activeBatchObj();
  document.getElementById("statDetailTitle").textContent = titles[activeStatCard] + " (" + rows.length + ")";
  let sub = { members: "Every learner account", enrolled: "Learners with at least one course enrolment",
              pending: "Written submissions waiting for approval", completed: "Learners who passed every milestone" }[activeStatCard];
  if (activeStatCard === "batch") sub = ab ? `${ab.name} · ${fmtBatchDate(ab.start_date)} → ${fmtBatchDate(ab.end_date)} · ${batchStatus(ab).label}` : "No batch is open. Set one under Projects & Broadcasts.";
  document.getElementById("statDetailSub").textContent = sub || "";
  document.getElementById("statDetailExtraHead").textContent = head || "Details";
  const tbody = document.getElementById("statDetailBody");
  tbody.innerHTML = rows.length
    ? rows.map(r => `
        <tr>
          <td data-label="Member">${escHtml(r.name)}</td>
          <td data-label="Username" style="font-family:'JetBrains Mono',monospace;font-size:.82rem;color:var(--text-muted)">${escHtml(r.username) || "—"}</td>
          <td data-label="Email" style="color:var(--text-dim);word-break:break-all">${escHtml(r.email) || "—"}</td>
          <td data-label="Phone" style="color:var(--text-dim);font-size:.82rem">${escHtml(r.phone) || "—"}</td>
          <td data-label="Batch" style="color:var(--text-dim);font-size:.82rem">${escHtml(r.batch)}</td>
          <td data-label="${escHtml(head || "Details")}" style="color:var(--text-muted);font-size:.82rem">${escHtml(r.extra) || "—"}</td>
        </tr>`).join("")
    : `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:2rem">Nobody in this category yet.</td></tr>`;
  panel.style.display = "block";
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
    const name = escHtml(m.full_name || m.user_id);
    const initials = String(name).trim().split(/\s+/).map(w => w[0]).join("").substring(0, 2).toUpperCase();
    return `
    <tr>
      <td>
        <button class="member-cell" data-call="openMemberDetail" data-user_id="${escHtml(m.user_id)}">
          <span class="avatar-chip">${initials}</span>
          <span class="member-name">${name}</span>
        </button>
      </td>
      <td style="color:var(--text-muted);font-size:.82rem">${escHtml(m.courses) || "—"}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:.85rem">${m.passed}/${m.total} passed</td>
      <td>
        <div class="mini-progress-wrap">
          <div class="mini-progress"><div class="mini-progress-fill" style="width:${m.rate}%"></div></div>
          <span class="mini-progress-label">${m.rate}%</span>
        </div>
      </td>
      <td style="color:var(--text-dim);font-size:.8rem">${m.upNext ? "🔓 " + escHtml(m.upNext.milestone_title || m.upNext.milestone_id) : (m.total > 0 && m.rate === 100 ? "✅ All complete" : "—")}</td>
    </tr>`;
  }).join("");
}

function openMemberDetail(args) {
  const userId = args.user_id;
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
            ${escHtml(ms.milestone_title || ms.milestone_id)}
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
    <tr id="sub-row-${escHtml(sub.sub_id)}">
      <td data-label="Member">${escHtml(sub.full_name || sub.user_id)}</td>
      <td data-label="Milestone" style="color:var(--text-muted)">${escHtml(sub.milestone_title || sub.milestone_id)}</td>
      <td data-label="Submitted" style="color:var(--text-dim);font-size:.8rem">${fmtDate(sub.submitted_at)}</td>
      <td data-label="Response"><div style="background:var(--bg-main);border-radius:8px;padding:1rem;font-size:0.85rem;color:var(--text-muted);line-height:1.7;max-height:120px;overflow-y:auto;border:1px solid var(--border-subtle);font-style:italic;">${escHtml(sub.content)}</div></td>
      <td data-label="Action"><div style="display:flex;gap:6px;">
          <button class="chip-btn chip-btn--success" data-call="approve" data-user_id="${escHtml(sub.user_id)}" data-milestone_id="${escHtml(sub.milestone_id)}" data-course_id="${escHtml(sub.course_id)}" data-sub_id="${escHtml(sub.sub_id)}">✓ Approve</button>
          <button class="chip-btn chip-btn--danger" data-call="reject" data-user_id="${escHtml(sub.user_id)}" data-milestone_id="${escHtml(sub.milestone_id)}" data-course_id="${escHtml(sub.course_id)}" data-sub_id="${escHtml(sub.sub_id)}">✕ Reject</button>
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
    const ub = ((allUsers.find(x => x.user_id === uid) || {}).batch_id || "");
    return `
      <div class="learner-card" data-name="${escHtml((data.name||"").toLowerCase())}" data-batch="${escHtml(ub)}" style="${learnerBatchHidden(ub) ? "display:none" : ""}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;">
          <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--steel),var(--bg-surface));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;color:var(--text-main);flex-shrink:0;">${initials}</div>
          <div>
            <div style="font-weight:600;font-size:0.9rem;color:var(--text-main);">${escHtml(data.name) || uid}</div>
            <div style="font-size:0.75rem;color:var(--text-dim);">${escHtml(data.username)} · ${passed}/${total} milestones passed</div>
          </div>
        </div>
        <div>
          ${data.milestones.sort((a,b)=>(a.order_index||0)-(b.order_index||0)).map(m => {
            let dotColor = "var(--bg-surface)";
            if(m.status === "UNLOCKED") dotColor = "var(--steel)";
            if(m.status === "SUBMITTED") dotColor = "var(--warning)";
            if(m.status === "PASSED") dotColor = "var(--success)";
            if(m.status === "FAILED") dotColor = "var(--error)";
            return `<div style="display:flex;align-items:center;gap:8px;padding:0.4rem 0;border-bottom:1px solid var(--border-subtle);font-size:0.82rem;"><div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${dotColor}"></div><div style="color:var(--text-muted);flex:1;">${escHtml(m.milestone_title || m.milestone_id)}</div><div style="font-size:0.75rem;color:var(--text-dim);">${m.status}</div></div>`}).join("")}
        </div>
      </div>`;
  }).join("");
}

function renderUsersTable() {
  const tbody = document.getElementById("usersBody");
  if(!tbody) return;
  if (!allUsers.length) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:2rem">No members found.</td></tr>`; return; }
  tbody.innerHTML = allUsers.map(u => `
    <tr>
      <td data-label="Name">${escHtml(u.full_name)}<div style="font-size:.72rem;color:var(--text-dim);margin-top:2px;">🗓 ${escHtml(batchNameOf(u.batch_id))}</div></td>
      <td data-label="Username" style="font-family:'JetBrains Mono',monospace;font-size:.82rem;color:var(--text-muted)">${escHtml(u.username)}</td>
      <td data-label="Email" style="color:var(--text-dim);word-break:break-all">${escHtml(u.email)}</td>
      <td data-label="Phone" style="color:var(--text-dim);font-size:.82rem">${escHtml(u.phone) || "—"}</td>
      <td data-label="Enrolled In" style="color:var(--text-dim);font-size:.82rem;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(u.enrolled_courses) || "—"}">${escHtml(u.enrolled_courses) || "—"}</td>
      <td data-label="Action">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="chip-btn chip-btn--steel" data-call="openAssignModal" data-user_id="${escHtml(u.user_id)}" data-name="${escHtml(u.full_name)}">➕ Assign Course</button>
          ${user.role === "ADMIN" ? `<button class="chip-btn chip-btn--gold" data-call="assignBatchToUser" data-user_id="${escHtml(u.user_id)}" data-name="${escHtml(u.full_name)}">🗓 Move to current batch</button>` : ""}
          ${user.role === "ADMIN" ? `<button class="chip-btn chip-btn--danger" data-call="adminSetPasswordPrompt" data-user_id="${escHtml(u.user_id)}" data-name="${escHtml(u.full_name)}">🔑 Password</button>` : ""}
        </div>
      </td>
    </tr>`).join("");
}

// Admin-only: set a member's password directly (for accounts with no
// reachable email on file). The server also signs their old sessions out.
async function adminSetPasswordPrompt(args) {
  if (user.role !== "ADMIN") return;
  const pw = prompt(`New password for ${args.name}:\n(min 8 chars, at least one letter and one number)`);
  if (pw === null) return;
  const res = await apiCall("adminSetPassword", { user_id: args.user_id, new_password: pw });
  if (res.success) showToast(res.message || "Password updated.", "success");
  else showToast(res.error || "Error", "error");
}

async function approve(args) {
  const userId = args.user_id, milestoneId = args.milestone_id, courseId = args.course_id, subId = args.sub_id;
  const row = document.getElementById(`sub-row-${subId}`);
  if (row) row.style.opacity = "0.5";
  const res = await apiCall("approveMilestone", { user_id: userId, milestone_id: milestoneId, course_id: courseId });
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

async function reject(args) {
  const userId = args.user_id, milestoneId = args.milestone_id, courseId = args.course_id, subId = args.sub_id;
  const row = document.getElementById(`sub-row-${subId}`);
  if (row) row.style.opacity = "0.5";
  const res = await apiCall("rejectMilestone", { user_id: userId, milestone_id: milestoneId, course_id: courseId });
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
function learnerBatchHidden(batchId) {
  if (!learnerBatchFilter) return false;
  return learnerBatchFilter === "__none" ? !!batchId : batchId !== learnerBatchFilter;
}
function applyLearnerCardFilter() {
  document.querySelectorAll(".learner-card").forEach(card => {
    const okName = card.dataset.name.includes(currentLearnerSearch);
    card.style.display = (okName && !learnerBatchHidden(card.dataset.batch || "")) ? "" : "none";
  });
}
function setLearnerBatchFilter(v) { learnerBatchFilter = v || ""; applyLearnerCardFilter(); }
function batchNameOf(id) {
  if (!id) return "No batch";
  const b = (adminBatches || []).find(x => x.batch_id === id);
  return b ? b.name : "Unknown batch";
}
function populateBatchFilter() {
  const sel = document.getElementById("learnerBatchFilter");
  if (!sel) return;
  const cur = learnerBatchFilter;
  sel.innerHTML = `<option value="">All batches</option>` +
    (adminBatches || []).map(b => `<option value="${escHtml(b.batch_id)}">${escHtml(b.name)}${b.is_active ? " (active)" : ""}</option>`).join("") +
    `<option value="__none">No batch</option>`;
  sel.value = cur;
}

// Admin: move one learner into the active batch
async function assignBatchToUser(args) {
  if (!user || user.role !== "ADMIN") return;
  if (!confirm(`Move ${args.name} into the current batch? They will get portal access while that batch is running.`)) return;
  const res = await apiCall("assignBatchToUser", { user_id: args.user_id });
  if (res.success) { showToast(res.message || "Learner moved.", "success"); await loadAdminDashboard(); }
  else showToast(res.error || "Error", "error");
}

function switchView(args, el) {
  const name = args.view;
  document.querySelectorAll(".view").forEach(v => {
    if(v.id === `view-${name}`) v.style.display = "block";
    else v.style.display = "none";
  });
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  if (el && el.classList) el.classList.add("active");
  const viewTitles = {
    overview: ["Overview", "Platform at a glance"],
    pending:  ["Pending Reviews", "Written submissions awaiting your approval"],
    graduations: ["Graduation Approvals", "Sign off on members' final service assignment"],
    learners: ["Member Progress", "Per-member milestone tracking"],
    courses:  ["Manage Courses", "Create and structure learning pathways"],
    users:    ["Manage Members", "Add and view member accounts"],
    completed: ["Members Completed", "Fully graduated members"],
    facilitators: ["Facilitator Requests", "Approve leadership clearance requests"],
    projects: ["Projects & Broadcasts", "Essay assignments, training batch, defence date and announcements"]
  };
  const [title, sub] = viewTitles[name] || ["", ""];
  if(document.getElementById("topbarTitle")) document.getElementById("topbarTitle").textContent = title;
  if(document.getElementById("topbarSub")) document.getElementById("topbarSub").textContent = sub;
  closeMobileSidebar();
  if (name === "users" && document.getElementById("newUsersBadge")) {
    newUsersCount = 0; document.getElementById("newUsersBadge").style.display = "none";
  }
  // Lazy-load the essay-project workspace the first time it's opened.
  if (name === "projects") {
    if (!currentProjectAdmin) loadProjectAdmin();
    if (user && user.role === "ADMIN") loadBatchAdmin();
  }
}

function openAddUserModal() { document.getElementById("addUserModal").classList.add("active"); }
function closeAddUserModal() { document.getElementById("addUserModal").classList.remove("active"); }
function openCourseModal() { document.getElementById("courseModal").classList.add("active"); }
function closeCourseModal() { document.getElementById("courseModal").classList.remove("active"); }

function openMilestoneModal(args, el) {
  // args = {course_id, course_title} — or called from the curriculum editor
  // with a milestone to edit via openMilestoneEditor() below.
  activeCourseForMilestone = args.course_id;
  editingMilestoneId = null;
  document.getElementById("nm-course-title").textContent = args.course_title || "";
  document.getElementById("milestoneModalTitle").textContent = "Add Milestone";
  document.getElementById("nm-edit-extra").style.display = "none";
  document.getElementById("nm-videos-field").style.display = "block";
  const submitBtn = document.getElementById("btn-submit-milestone");
  if (submitBtn) submitBtn.textContent = "Add Milestone";
  document.getElementById("milestoneModal").classList.add("active");
}
function closeMilestoneModal() { document.getElementById("milestoneModal").classList.remove("active"); }
function handleSubTypeChange() {
  const type = document.getElementById("nm-type").value;
  document.getElementById("nm-quiz-wrap").style.display = type === "QUIZ" ? "block" : "none";
}

// ── CURRICULUM EDITOR (view + edit existing milestones) ──
// Opens the per-course milestone list. Editing is safe for learners who are
// mid-course: progress rows are keyed by milestone_id, which never changes.
async function openMilestoneList(args) {
  activeCourseForMilestone = args.course_id;
  document.getElementById("mlm-course-title").textContent = args.course_title || args.course_id;
  document.getElementById("milestoneListModal").classList.add("active");
  const body = document.getElementById("milestoneListBody");
  body.innerHTML = `<div class="skeleton" style="height:56px;margin-bottom:8px;border-radius:10px;"></div><div class="skeleton" style="height:56px;margin-bottom:8px;border-radius:10px;"></div><div class="skeleton" style="height:56px;border-radius:10px;"></div>`;
  // Admin variant — includes soft-hidden milestones so they can be edited
  // and re-shown. (getMilestones filters to active-only for learners.)
  const res = await apiCall("getMilestonesAdmin", { course_id: args.course_id });
  if (res.error) { body.innerHTML = `<p style="color:var(--error);padding:1rem">${escHtml(res.error)}</p>`; return; }
  courseMilestonesCache = res.milestones || [];
  renderMilestoneList();
}

function closeMilestoneListModal() { document.getElementById("milestoneListModal").classList.remove("active"); }

function renderMilestoneList() {
  const body = document.getElementById("milestoneListBody");
  if (!body) return;
  if (!courseMilestonesCache.length) {
    body.innerHTML = `<p style="color:var(--text-dim);padding:1rem;text-align:center">No milestones in this course yet — add the first one.</p>`;
    return;
  }
  const typeLabel = { CHECKBOX: "Read & confirm", WRITTEN: "Written", QUIZ: "Quiz" };
  body.innerHTML = courseMilestonesCache.map(m => `
    <div style="display:flex;align-items:center;gap:.75rem;padding:.75rem 0;border-bottom:1px solid var(--border-subtle);">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--bg-surface);display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:.8rem;color:var(--gold-lt);flex-shrink:0;">${escHtml(m.order_index)}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:500;font-size:.9rem;color:var(--text-main);">${escHtml(m.title)}</div>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:2px;">${escHtml(typeLabel[m.submission_type] || m.submission_type)}${String(m.is_active).toUpperCase() === "TRUE" ? "" : " · <span style='color:var(--warning)'>hidden</span>"}</div>
      </div>
      <button class="chip-btn chip-btn--steel" data-call="openMilestoneEditor" data-milestone_id="${escHtml(m.milestone_id)}">✏️ Edit</button>
      <button class="chip-btn ${String(m.is_active).toUpperCase() === "TRUE" ? "chip-btn--danger" : "chip-btn--success"}" data-call="toggleMilestoneActive" data-milestone_id="${escHtml(m.milestone_id)}" data-make_active="${String(m.is_active).toUpperCase() === "TRUE" ? "FALSE" : "TRUE"}" data-title="${escHtml(m.title)}">${String(m.is_active).toUpperCase() === "TRUE" ? "🙈 Hide" : "👁 Show"}</button>
    </div>`).join("");
}

function openMilestoneCreate() {
  closeMilestoneListModal();
  const course = allCourses.find(c => c.course_id === activeCourseForMilestone);
  openMilestoneModal({ course_id: activeCourseForMilestone, course_title: course ? course.title : "" });
}

function openMilestoneEditor(args) {
  const m = courseMilestonesCache.find(x => x.milestone_id === args.milestone_id);
  if (!m) return;
  editingMilestoneId = m.milestone_id;
  activeCourseForMilestone = m.course_id;
  document.getElementById("nm-course-title").textContent = (allCourses.find(c => c.course_id === m.course_id) || {}).title || m.course_id;
  document.getElementById("milestoneModalTitle").textContent = "Edit Milestone";
  document.getElementById("nm-title").value = m.title || "";
  document.getElementById("nm-desc").value = m.description || "";
  document.getElementById("nm-content").value = m.content_html || "";
  document.getElementById("nm-video").value = m.video_url || "";
  let vids = [];
  if (m.video_list) { try { vids = JSON.parse(m.video_list); } catch (e) {} }
  document.getElementById("nm-videos").value = (vids || []).map(v => v.url || "").filter(Boolean).join("\n");
  document.getElementById("nm-type").value = m.submission_type || "CHECKBOX";
  handleSubTypeChange();
  document.getElementById("nm-pass").value = (m.pass_score !== "" && m.pass_score !== undefined && m.pass_score !== null) ? m.pass_score : "";
  document.getElementById("nm-quiz").value = m.quiz_json || "";
  document.getElementById("nm-order").value = m.order_index || "";
  document.getElementById("nm-active").checked = String(m.is_active).toUpperCase() === "TRUE";
  document.getElementById("nm-edit-extra").style.display = "block";
  document.getElementById("nm-videos-field").style.display = "block";
  const submitBtn = document.getElementById("btn-submit-milestone");
  if (submitBtn) submitBtn.textContent = "Save Changes";
  closeMilestoneListModal();
  document.getElementById("milestoneModal").classList.add("active");
}

// Hide/show a milestone without deleting it — submissions and review history
// reference the milestone_id, so rows are never removed.
async function toggleMilestoneActive(args) {
  const res = await apiCall("updateMilestone", { milestone_id: args.milestone_id, is_active: args.make_active });
  if (res.success) {
    showToast(args.make_active === "TRUE" ? `"${args.title}" is visible to learners again.` : `"${args.title}" hidden — history and progress are kept.`, "success");
    const m = courseMilestonesCache.find(x => x.milestone_id === args.milestone_id);
    if (m) m.is_active = args.make_active;
    renderMilestoneList();
    pollUpdates(); // refresh the per-course milestone counts on the courses table
  } else {
    showToast(res.error || "Error", "error");
  }
}

function openAssignModal(args) {
  const uid = args.user_id, name = args.name;
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
  const res = await apiCall("createUser", { full_name: name, username, password, email, role: "LEARNER", course_id: course });
  if (res.success) {
    showToast(`Account created for ${name}!`, "success"); closeAddUserModal();
    ["nf-name","nf-username","nf-email","nf-password"].forEach(id => document.getElementById(id).value = "");
    await loadAdminDashboard();
  } else { showToast(res.error || "Error creating user", "error"); }
}

async function submitNewCourse() {
  const title = document.getElementById("nc-title").value.trim();
  const desc = document.getElementById("nc-desc").value.trim();
  if(!title || !desc) return showToast("Please fill all fields", "error");
  const btn = document.getElementById("btn-submit-course");
  btn.disabled = true; btn.textContent = "Saving...";
  const res = await apiCall("createCourse", {title, description: desc});
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
  const videosRaw = document.getElementById("nm-videos").value;
  const type = document.getElementById("nm-type").value;
  let passScore = "", quizJson = "";
  if(!title || !desc || !content) return showToast("Fill title, description, and content", "error");
  if(type === "QUIZ") {
    passScore = document.getElementById("nm-pass").value;
    const rawQuiz = document.getElementById("nm-quiz").value.trim();
    try { JSON.parse(rawQuiz); quizJson = rawQuiz; } catch(e) { return showToast("Invalid JSON in Quiz Data", "error"); }
  }
  // Playlist: one URL per line → [{title,url}] objects. "Part 1", "Part 2"…
  // titles are auto-generated; the learner sees them as chapter chips.
  const videoLines = videosRaw.split("\n").map(s => s.trim()).filter(Boolean);
  const videoList = videoLines.map((url, i) => ({ title: "Part " + (i + 1), url }));
  const btn = document.getElementById("btn-submit-milestone");
  btn.disabled = true; btn.textContent = "Saving...";
  let res;
  if (editingMilestoneId) {
    const payload = {
      milestone_id: editingMilestoneId,
      title, description: desc, content_html: content,
      video_url: videoList.length ? videoList[0].url : video,
      video_list: videoList,
      submission_type: type, pass_score: passScore, quiz_json: quizJson,
      order_index: document.getElementById("nm-order").value,
      is_active: document.getElementById("nm-active").checked ? "TRUE" : "FALSE"
    };
    res = await apiCall("updateMilestone", payload);
  } else {
    res = await apiCall("createMilestone", {
      course_id: activeCourseForMilestone, title, description: desc, content_html: content,
      video_url: videoList.length ? videoList[0].url : video,
      video_list: videoList,
      submission_type: type, pass_score: passScore, quiz_json: quizJson
    });
  }
  if(res.success) {
    showToast(editingMilestoneId ? "Milestone updated!" : "Milestone created!", "success");
    closeMilestoneModal();
    ["nm-title","nm-desc","nm-content","nm-video","nm-videos","nm-quiz"].forEach(id => document.getElementById(id).value = "");
    editingMilestoneId = null;
    await loadAdminDashboard();
  } else { showToast(res.error || "Error", "error"); }
  btn.disabled = false; btn.textContent = editingMilestoneId ? "Save Changes" : "Add Milestone";
}

async function submitAssignCourse() {
  const cid = document.getElementById("assign-course-select").value;
  if(!cid) return showToast("Please select a course", "error");
  const btn = document.getElementById("btn-submit-assign");
  btn.disabled = true; btn.textContent = "Assigning...";
  const res = await apiCall("assignCourse", {target_user_id: userToAssign, course_id: cid});
  if(res.success) { showToast("Course assigned successfully", "success"); closeAssignModal(); await loadAdminDashboard(); } 
  else { showToast(res.error || "Error", "error"); }
  btn.disabled = false; btn.textContent = "Assign Course";
}


// ==========================================
// LEARNER ROADMAP & PROGRESSION
// ==========================================
async function loadCoursesLearner() {
  const tc = document.getElementById("trackContainer");
  if(tc) tc.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--text-dim);">Syncing your roadmap...</div>`;
  
  const [res, gRes] = await Promise.all([
    apiCall("getLearnerDashboard", {}),
    apiCall("getGraduationStatus", {})
  ]);
  if (res.success) {
    userRoadmap = res.roadmap || [];
    userBatch = res.batch || null;
    graduationStatus = (gRes && gRes.success) ? gRes : { eligible: false, graduation: null };
    renderWelcomeDashboard();
    renderCourseList(); // Syncs the sidebar
  } else {
    if(tc) tc.innerHTML = `<div style="color:var(--error);padding:2rem;">Failed to load curriculum.</div>`;
  }
}

function isGraduationEligible() {
  return !!(graduationStatus && graduationStatus.eligible);
}

function renderCourseList() {
  const el = document.getElementById("courseList");
  if(!el) return;
  
  if (!userRoadmap.length) { 
    el.innerHTML = `<p style="font-size:.8rem;color:var(--text-dim);padding:.5rem 0">No paths available.</p>`; 
    return; 
  }
  
  let html = userRoadmap.map((c) => {
    const isCompleted = c.progress_pct === 100;
    const icon = isCompleted ? '✅' : (c.is_unlocked ? '📖' : '🔒');
    const lockedStyle = c.is_unlocked ? '' : 'opacity: 0.6; cursor: not-allowed;';
    const attrs = c.is_unlocked ? `data-call="openCourse" data-course_id="${escHtml(c.course_id)}"` : '';
    
    return `<button class="course-btn ${currentView === 'course' && currentCourse?.course_id === c.course_id ? 'active' : ''}" style="${lockedStyle}" ${attrs}>
      <span style="font-size: 14px;">${icon}</span> ${escHtml(c.title)}
    </button>`;
  }).join("");

  if (isGraduationEligible()) {
    const grad = graduationStatus.graduation;
    const gIcon = grad ? (grad.overall_status === "APPROVED" ? '🎓' : '⏳') : '🌟';
    html += `<button class="course-btn ${currentView === 'graduation' ? 'active' : ''}" style="border-color: var(--gold);" data-call="openGraduation">
      <span style="font-size: 14px;">${gIcon}</span> Graduation
    </button>`;
  }

  el.innerHTML = html;
}

function renderWelcomeDashboard() {
  closeMobileSidebar();
  stopGraduationPolling();
  if(document.getElementById("topbarTitle")) document.getElementById("topbarTitle").textContent = "Your Journey";
  if(document.getElementById("topbarSub")) document.getElementById("topbarSub").textContent = "Complete milestones sequentially to unlock new pathways.";
  if(document.getElementById("progressSummary")) document.getElementById("progressSummary").style.display = "none";
  currentCourse = null; // Reset active course state when on the dashboard
  currentView = 'dashboard';
  renderCourseList(); // Update sidebar active state
  
  const tc = document.getElementById("trackContainer");
  if(!tc) return;

  let html = `
    <div class="welcome-dashboard-wrap">
      <div class="welcome-dashboard-content">
        <div style="margin-bottom: 2rem;">
          <h2 style="font-family: 'DM Serif Display', serif; font-size: 2rem; color: var(--text-main); margin-bottom: 0.4rem;">Welcome Leader, ${escHtml(user.full_name.split(' ')[0])}</h2>
          <p style="font-size: 0.95rem; color: var(--text-dim);">Pick up where you left off or begin your next module.</p>
        </div>
        ${batchBannerHtml()}
        <div class="roadmap-grid">`;

  userRoadmap.forEach((c) => {
    const isCompleted = c.progress_pct === 100;
    const cardClass = c.is_unlocked ? (isCompleted ? 'unlocked completed' : 'unlocked') : 'locked';
    const icon = c.is_unlocked ? (isCompleted ? '✅' : '📖') : '🔒';
    const statusText = c.is_unlocked ? (isCompleted ? 'Completed' : 'In Progress') : 'Locked';

    html += `
      <div class="roadmap-card ${cardClass}" ${c.is_unlocked ? `data-call="openCourse" data-course_id="${escHtml(c.course_id)}"` : ''}>
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

  if (isGraduationEligible()) {
    const grad = graduationStatus.graduation;
    const approvedCount = grad ? [grad.facil_status, grad.admin_status].filter(s => s === "APPROVED").length : 0;
    const isDone = grad && grad.overall_status === "APPROVED";
    const icon = isDone ? '🎓' : (grad ? '⏳' : '🌟');
    const statusText = isDone ? 'Graduated!' : (grad ? 'Awaiting approval' : 'Ready to begin');
    const metaLeft = isDone ? 'Both approved' : (grad ? `${approvedCount} of 2 approvals received` : 'Final step');
    const barPct = isDone ? 100 : (grad ? 50 : 0);

    html += `
      <div class="roadmap-card unlocked ${isDone ? 'completed' : ''}" data-call="openGraduation" style="border-color: var(--gold);">
        <div class="roadmap-icon">${icon}</div>
        <div class="roadmap-title">Graduation</div>
        <div class="roadmap-desc">Your final step — choose where you'd like to serve and get approved.</div>
        <div class="roadmap-progress-wrap">
          <div class="roadmap-progress-bar">
            <div class="roadmap-progress-fill" style="width: ${barPct}%; ${isDone ? 'background: var(--success);' : ''}"></div>
          </div>
          <div class="roadmap-meta">
            <span>${metaLeft}</span>
            <span style="${isDone ? 'color: var(--success);' : 'color: var(--gold);'}">${statusText}</span>
          </div>
        </div>
      </div>`;
  }

  html += `
        </div>
      </div>
    </div>`;
    
  tc.innerHTML = html;
}

async function openCourse(args) {
  const courseId = args.course_id;
  const courseData = userRoadmap.find(c => c.course_id === courseId);
  if (!courseData) return;
  currentCourse = courseData;
  currentView = 'course';
  stopGraduationPolling();
  renderCourseList(); // Refreshes sidebar to highlight the active course
  
  if(document.getElementById("topbarTitle")) document.getElementById("topbarTitle").textContent = currentCourse.title;
  if(document.getElementById("topbarSub")) document.getElementById("topbarSub").textContent = currentCourse.description;
  
  const tc = document.getElementById("trackContainer");
  tc.innerHTML = `<div class="skeleton" style="height:70px;margin-bottom:1rem;border-radius:12px;"></div><div class="skeleton" style="height:80px;margin-bottom:1rem;border-radius:14px;"></div><div class="skeleton" style="height:80px;border-radius:14px;"></div>`;
  
  const [mRes, pRes] = await Promise.all([ 
    apiCall("getMilestones", { course_id: courseId }), 
    apiCall("getProgress", { course_id: courseId }) 
  ]);
  
  milestones = mRes.milestones || [];
  progress   = pRes.progress  || [];
  try { await syncWatchProgress(milestones); } catch (e) { /* offline or backend not updated: fall back to this device */ }
  renderTrack();
}

function getStatus(milestone_id) {
  const p = progress.find(p => p.milestone_id === milestone_id); return p ? p.status : "LOCKED";
}

// ==========================================
// GRADUATION MODULE (LEARNER SIDE)
// ==========================================
function openGraduation() {
  if (!isGraduationEligible()) return;
  currentCourse = null;
  currentView = 'graduation';
  renderCourseList();
  closeMobileSidebar();

  if(document.getElementById("topbarTitle")) document.getElementById("topbarTitle").textContent = "Graduation";
  if(document.getElementById("topbarSub")) document.getElementById("topbarSub").textContent = "Your final step in the Workforce Academy.";
  if(document.getElementById("progressSummary")) document.getElementById("progressSummary").style.display = "none";

  const tc = document.getElementById("trackContainer");
  if (!tc) return;

  const grad = graduationStatus ? graduationStatus.graduation : null;
  tc.innerHTML = grad ? renderGraduationStatusView(grad) : renderGraduationForm();

  // While waiting on approval, poll quietly in the background so the learner
  // sees a status change without needing to navigate away and back. Stops
  // itself once approved, or the moment they leave this view.
  if (grad && grad.overall_status !== "APPROVED") startGraduationPolling();
  else stopGraduationPolling();
}

let graduationPollInterval = null;
const GRADUATION_POLL_MS = 20000;

function stopGraduationPolling() {
  if (graduationPollInterval) { clearInterval(graduationPollInterval); graduationPollInterval = null; }
}

function startGraduationPolling() {
  stopGraduationPolling();
  graduationPollInterval = setInterval(async () => {
    if (currentView !== 'graduation') { stopGraduationPolling(); return; }
    const gRes = await apiCall("getGraduationStatus", {});
    if (!gRes || !gRes.success) return;

    const prevGrad = graduationStatus ? graduationStatus.graduation : null;
    graduationStatus = gRes;
    const g = graduationStatus.graduation;
    if (!g) return;

    const changed = !prevGrad
      || g.overall_status !== prevGrad.overall_status
      || g.facil_status !== prevGrad.facil_status
      || g.admin_status !== prevGrad.admin_status;
    if (!changed) return;

    renderCourseList();
    const tc = document.getElementById("trackContainer");
    if (tc) tc.innerHTML = renderGraduationStatusView(g);

    if (g.overall_status === "APPROVED") {
      showToast("🎉 You've been fully approved for graduation!", "success");
      stopGraduationPolling();
    } else {
      showToast("Your graduation status was updated.", "info");
    }
  }, GRADUATION_POLL_MS);
}

function renderGraduationForm() {
  selectedServiceChoice = null;
  return `
    <div style="max-width: 640px;">
      <div style="text-align:center; padding: 1.5rem 0 2rem;">
        <div style="font-size: 3rem; margin-bottom: .5rem;">🎓</div>
        <h2 style="font-family:'DM Serif Display', serif; font-size: 1.6rem; color: var(--text-main); margin-bottom:.5rem;">Congratulations — you've completed the curriculum!</h2>
        <p style="font-size: .9rem; color: var(--text-dim);">One last step before graduation: tell us where you'd love to serve.</p>
      </div>
      <div id="serviceOptions" style="display:flex; flex-direction:column; gap:.75rem; margin-bottom:1.5rem;">
        ${GRADUATION_SERVICE_OPTIONS.map(o => `
          <label id="svc-${o.value}" data-call="selectServiceChoice" data-value="${escHtml(o.value)}" style="display:flex; flex-direction:column; gap:2px; padding:1rem 1.25rem; border-radius:12px; border:1.5px solid var(--border-strong); cursor:pointer; transition: all .15s; background: transparent;">
            <span style="font-weight:600; font-size:.9rem; color: var(--text-main);">${escHtml(o.label)}</span>
            <span style="font-size:.8rem; color: var(--text-dim);">${escHtml(o.desc)}</span>
          </label>`).join("")}
      </div>
      <button class="btn-action btn-primary" id="btnSubmitGraduation" disabled data-call="submitGraduationRequest" style="width:100%; justify-content:center;">Submit Graduation Request</button>
    </div>`;
}

function selectServiceChoice(args) {
  const value = args.value;
  selectedServiceChoice = value;
  GRADUATION_SERVICE_OPTIONS.forEach(o => {
    const el = document.getElementById(`svc-${o.value}`);
    if (!el) return;
    if (o.value === value) { el.style.borderColor = "var(--gold)"; el.style.background = "var(--gold-bg)"; }
    else { el.style.borderColor = "var(--border-strong)"; el.style.background = "transparent"; }
  });
  const btn = document.getElementById("btnSubmitGraduation");
  if (btn) btn.disabled = false;
}

async function submitGraduationRequest() {
  if (!selectedServiceChoice) { showToast("Please select where you'd like to serve.", "error"); return; }
  const btn = document.getElementById("btnSubmitGraduation");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="btn-spinner"></span>Submitting…`; }

  const res = await apiCall("submitGraduation", { service_choice: selectedServiceChoice });
  if (res.success) {
    showToast("Graduation request submitted!", "success");
    const gRes = await apiCall("getGraduationStatus", {});
    graduationStatus = (gRes && gRes.success) ? gRes : graduationStatus;
    renderCourseList();
    openGraduation();
  } else {
    showToast(res.error || "Error submitting request", "error");
    if (btn) { btn.disabled = false; btn.textContent = "Submit Graduation Request"; }
  }
}

function renderGraduationStatusView(grad) {
  const isDone = grad.overall_status === "APPROVED";
  const facilDone = grad.facil_status === "APPROVED";
  const adminDone = grad.admin_status === "APPROVED";
  const choiceLabel = (GRADUATION_SERVICE_OPTIONS.find(o => o.value === grad.service_choice) || {}).label || grad.service_choice;

  if (isDone) {
    return `
      <div style="max-width:560px; text-align:center; padding: 2.5rem 1rem;">
        <div style="font-size:3.5rem; margin-bottom:1rem;">🎓</div>
        <h2 style="font-family:'DM Serif Display', serif; font-size:1.8rem; color: var(--text-main); margin-bottom:.5rem;">You're a graduate!</h2>
        <p style="font-size:.9rem; color: var(--text-dim); margin-bottom:1.5rem;">Both your facilitator and admin have approved your assignment to <strong style="color:var(--gold-lt)">${escHtml(choiceLabel)}</strong>. Welcome to the next chapter of service.</p>
        <div style="font-size:.8rem; color: var(--text-dim);">Approved ${fmtDate(grad.approved_at)}</div>
      </div>`;
  }

  return `
    <div style="max-width:560px;">
      <div style="text-align:center; padding: 1.5rem 0 2rem;">
        <div style="font-size:3rem; margin-bottom:.5rem;">⏳</div>
        <h2 style="font-family:'DM Serif Display', serif; font-size:1.5rem; color: var(--text-main); margin-bottom:.5rem;">Your request is under review</h2>
        <p style="font-size:.875rem; color: var(--text-dim);">You asked to serve with <strong style="color:var(--gold-lt)">${escHtml(choiceLabel)}</strong>. It needs sign-off from both your facilitator and admin — either can approve first.</p>
      </div>
      <div style="display:flex; flex-direction:column; gap:.75rem;">
        ${graduationApprovalRow_("Facilitator Review", facilDone)}
        ${graduationApprovalRow_("Admin Review", adminDone)}
      </div>
    </div>`;
}

function graduationApprovalRow_(label, done) {
  const color = done ? "var(--success)" : "var(--warning)";
  const bg = done ? "var(--success-bg)" : "var(--warning-bg)";
  const icon = done ? "✅" : "⏳";
  const text = done ? "Approved" : "Pending";
  return `<div style="display:flex; align-items:center; justify-content:space-between; background:${bg}; border-radius:10px; padding:1rem 1.25rem;">
    <span style="font-size:.9rem; font-weight:500; color: var(--text-main);">${escHtml(label)}</span>
    <span style="font-size:.85rem; font-weight:600; color:${color};">${icon} ${text}</span>
  </div>`;
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
        <button data-call="loadCoursesLearner" style="background: none; border: none; color: var(--gold); font-size: 0.85rem; font-weight: 500; cursor: pointer; padding: 0; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 4px;">← Back to Roadmap</button>
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
}

function renderMilestoneCard(m, idx) {
  const status = getStatus(m.milestone_id);
  const locked = status === "LOCKED";
  migrateLegacyWatchFlag(m);
  let statusStyle = "";
  if(status === "LOCKED") statusStyle = "background: var(--bg-surface); color: var(--text-dim); border: 2px solid var(--border-strong);";
  if(status === "UNLOCKED") statusStyle = "background: var(--steel-bg); color: var(--steel); border: 2px solid var(--steel);";
  if(status === "SUBMITTED") statusStyle = "background: var(--warning-bg); color: var(--warning); border: 2px solid var(--warning);";
  if(status === "PASSED") statusStyle = "background: var(--success-bg); color: var(--success); border: 2px solid var(--success);";
  if(status === "FAILED") statusStyle = "background: var(--error-bg); color: var(--error); border: 2px solid var(--error);";
  let borderStyle = status === 'UNLOCKED' ? "border-color: var(--gold);" : "border-color: var(--border-subtle);";
  const gate = needsVideoGate(m);
  const { videos, remaining } = playlistGateInfo(m);
  const lockNote = gate
    ? `<div id="video-lock-note-${escHtml(m.milestone_id)}" style="display:flex;align-items:center;gap:8px;margin:1rem 0;padding:.75rem 1rem;background:var(--warning-bg);color:var(--warning);border-radius:8px;font-size:.82rem;">🔒 Watch every video part above to unlock this step${videos.length > 1 ? ` — ${remaining} left` : ""}.</div>`
    : "";

  return `
    <div class="milestone-card" id="card-${escHtml(m.milestone_id)}" style="background: var(--bg-panel); border: 1px solid; ${borderStyle} border-radius: 14px; margin-bottom: 1rem; overflow: hidden; transition: border-color 0.2s; ${locked ? 'opacity: 0.55;' : ''}">
      <div style="padding: 1.25rem 1.5rem; display: flex; align-items: center; gap: 1rem; ${locked ? 'cursor: default;' : 'cursor: pointer;'}" ${!locked ? `data-call="toggleCard" data-mid="${escHtml(m.milestone_id)}"` : ""}>
        <div style="width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; font-weight: 500; ${statusStyle}">${idx+1}</div>
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-main); margin-bottom: 3px;">${escHtml(m.title)}</div>
          <div style="font-size: 0.8rem; color: var(--text-dim);">${escHtml(m.description)}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0;">${statusBadge(status)} ${!locked ? `<span id="chev-${escHtml(m.milestone_id)}" style="color: var(--text-dim); transition: transform 0.25s; font-size: 0.9rem;">▾</span>` : ''}</div>
      </div>
      <div id="body-${escHtml(m.milestone_id)}" style="display: none; padding: 0 1.5rem 1.5rem; border-top: 1px solid var(--border-subtle);">
        ${videos.length ? renderPlaylistShell(m, gate) : ""}
        <div style="background: var(--bg-surface); border-radius: 10px; padding: 1.25rem 1.5rem; margin: 1rem 0; font-size: 0.875rem; line-height: 1.75; color: var(--text-muted);">${sanitizeContentHtml(m.content_html)}</div>
        ${lockNote}
        <div id="submission-area-${escHtml(m.milestone_id)}" style="display:${gate ? 'none' : 'block'};">${renderSubmissionArea(m, status)}</div>
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

// ── MULTI-VIDEO PLAYLIST ENGINE ──
// A milestone may hold ONE video (video_url, legacy) or an ordered playlist
// (video_list = JSON [{title,url},…], edited one-URL-per-line in the admin
// milestone modal). Parts play back-to-back; a part counts as "watched"
// when it fires its ended event. While a milestone is UNLOCKED the
// submission form stays hidden until every trackable part (YouTube / Vimeo
// / native file) has ended — Google Drive previews and plain links can't
// report playback, so they don't count toward the gate.

const PLAYLIST_STATE = {};   // mid -> { videos, idx, gate, pollTimer }
// (ytPlayers / vimeoPlayers are declared in the globals block at the top)

const TRACKABLE_TYPES = ["youtube", "vimeo", "file"];

function milestoneVideos(m) {
  let list = [];
  if (m.video_list) {
    try {
      const arr = JSON.parse(m.video_list);
      if (Array.isArray(arr)) list = arr.filter(v => v && String(v.url || "").trim())
        .map(v => ({ title: String(v.title || "").trim(), url: String(v.url).trim() }));
    } catch (e) {}
  }
  if (!list.length && m.video_url && String(m.video_url).trim()) {
    list = [{ title: "", url: String(m.video_url).trim() }];
  }
  return list.map(v => ({ ...v, title: v.title || "Part", info: getVideoInfo(v.url) }));
}

// Watch flags are PER VIDEO and live in localStorage — unlike the old
// sessionStorage key they survive phone restarts and app switches.
function videoWatchKey(uid, mid, url) { return `vw_${uid}_${mid}_${encodeURIComponent(url)}`; }

function isVideoWatched(mid, url) {
  return localStorage.getItem(videoWatchKey(user.user_id, mid, url)) === "1";
}

// One-time migration: the pre-playlist build stored a single per-milestone
// flag in sessionStorage. Promote it so nobody has to re-watch anything.
function migrateLegacyWatchFlag(m) {
  try {
    const old = sessionStorage.getItem(`video_watched_${user.user_id}_${m.milestone_id}`);
    if (old === "1") {
      milestoneVideos(m).forEach(v => {
        if (TRACKABLE_TYPES.includes(v.info.type)) localStorage.setItem(videoWatchKey(user.user_id, m.milestone_id, v.url), "1");
      });
      sessionStorage.removeItem(`video_watched_${user.user_id}_${m.milestone_id}`);
    }
  } catch (e) {}
}

// ==========================================
// WATCH PROGRESS — saved to the SERVER, so it follows the learner to any
// phone/browser. The device keeps a local copy too (works offline) and queues
// saves until the connection returns.
// ==========================================
const vimeoLastTime = {};
let watchFlushing = false;
const WATCH_QUEUE_KEY = () => `wtp_wq_${user.user_id}`;
const WATCH_POS_KEY = (mid, url) => `vp_${user.user_id}_${mid}_${encodeURIComponent(url)}`;

function getSavedPosition(mid, url) {
  if (isVideoWatched(mid, url)) return 0;               // finished parts replay from the start
  const n = parseFloat(localStorage.getItem(WATCH_POS_KEY(mid, url)));
  return isFinite(n) && n > 0 ? n : 0;
}
function rememberPosition(mid, url, sec) {
  if (!isFinite(sec) || sec < 1) return false;
  try {
    const prev = parseFloat(localStorage.getItem(WATCH_POS_KEY(mid, url))) || 0;
    if (sec <= prev) return false;
    localStorage.setItem(WATCH_POS_KEY(mid, url), String(Math.floor(sec)));
    return true;
  } catch (e) { return false; }
}
function readWatchQueue() { try { return JSON.parse(localStorage.getItem(WATCH_QUEUE_KEY())) || {}; } catch (e) { return {}; } }
function writeWatchQueue(q) { try { localStorage.setItem(WATCH_QUEUE_KEY(), JSON.stringify(q)); } catch (e) {} }

function queueWatchSave(mid, url, info) {
  if (typeof user === "undefined" || !user) return;
  info = info || {};
  const q = readWatchQueue(), k = mid + "|" + url;
  const e = q[k] || { mid, url, position: 0, done: false };
  if (info.position > e.position) e.position = Math.floor(info.position);
  if (info.done) e.done = true;
  q[k] = e;
  writeWatchQueue(q);
}

async function flushWatchQueue(keepalive) {
  if (typeof user === "undefined" || !user || !getSession()) return;
  const q = readWatchQueue();
  const keys = Object.keys(q);
  if (!keys.length) return;
  if (keepalive) {            // page is closing: fire everything at once, don't wait
    keys.forEach(k => { const e = q[k]; apiCall("saveWatchProgress", { milestone_id: e.mid, url: e.url, position: e.position, done: e.done }, { keepalive: true }).catch(() => {}); });
    return;                   // stays queued; re-sending next visit is harmless (saves are idempotent)
  }
  if (watchFlushing) return;
  watchFlushing = true;
  try {
    for (const k of keys) {
      const e = q[k];
      let res;
      try { res = await apiCall("saveWatchProgress", { milestone_id: e.mid, url: e.url, position: e.position, done: e.done }); }
      catch (err) { break; }                         // offline: keep the queue, try again later
      if (!res || !res.success) break;               // server said no: keep it, try again later
      const cur = readWatchQueue(), c = cur[k];
      if (c && c.position <= e.position && (!c.done || e.done)) { delete cur[k]; writeWatchQueue(cur); }
    }
  } finally { watchFlushing = false; }
}

// Pull what the server knows (another phone, cleared browser...) into this
// device, and push up anything this device watched that the server doesn't
// have yet (this is how existing learners keep the credit they already earned).
async function syncWatchProgress(ms) {
  if (typeof user === "undefined" || !user) return;
  ms.forEach(m => migrateLegacyWatchFlag(m));
  let res;
  try { res = await apiCall("getWatchProgress", {}); } catch (e) { return; }
  if (!res || !res.success) return;                  // backend not updated yet: just use the device copy
  const serverDone = new Set();
  (res.items || []).forEach(it => {
    (it.done || []).forEach(url => {
      serverDone.add(it.milestone_id + "|" + url);
      try { localStorage.setItem(videoWatchKey(user.user_id, it.milestone_id, url), "1"); } catch (e) {}
    });
    Object.keys(it.pos || {}).forEach(url => rememberPosition(it.milestone_id, url, Number(it.pos[url])));
  });
  ms.forEach(m => milestoneVideos(m).forEach(v => {
    if (TRACKABLE_TYPES.includes(v.info.type) && isVideoWatched(m.milestone_id, v.url) && !serverDone.has(m.milestone_id + "|" + v.url)) {
      queueWatchSave(m.milestone_id, v.url, { done: true });
    }
  }));
  flushWatchQueue();
}

function currentPartUrl(mid) {
  const st = PLAYLIST_STATE[mid];
  return st && st.videos[st.idx] ? st.videos[st.idx].url : null;
}
// Where to restart a part (a few seconds before where they stopped).
function resumePointFor(mid, gate) {
  if (!gate) return 0;
  const url = currentPartUrl(mid);
  if (!url) return 0;
  const p = getSavedPosition(mid, url);
  return p > 8 ? p - 3 : 0;
}
function readPlayerTime(mid) {
  const st = PLAYLIST_STATE[mid];
  const v = st && st.videos[st.idx];
  if (!v) return 0;
  if (v.info.type === "youtube") { const p = ytPlayers[mid]; return p && typeof p.getCurrentTime === "function" ? p.getCurrentTime() : 0; }
  if (v.info.type === "file") { const el = document.getElementById(`native-video-${mid}`); return el ? el.currentTime : 0; }
  if (v.info.type === "vimeo") return vimeoLastTime[mid] || 0;
  return 0;
}
function savePositionNow(mid) {
  const url = currentPartUrl(mid), st = PLAYLIST_STATE[mid];
  if (!url || !st || !st.gate || isVideoWatched(mid, url)) return;
  const t = readPlayerTime(mid);
  if (rememberPosition(mid, url, t)) queueWatchSave(mid, url, { position: t });
}
function startPositionTracker(mid) {
  const st = PLAYLIST_STATE[mid];
  if (!st) return;
  let tick = 0;
  st.posTimer = setInterval(() => {
    tick++;
    savePositionNow(mid);
    if (tick % 6 === 0) flushWatchQueue();            // about every 30 seconds
  }, 5000);
}
// Phone switched apps / locked / closed the tab: save right now.
function saveAllPositionsNow() {
  try {
    Object.keys(PLAYLIST_STATE).forEach(mid => savePositionNow(mid));
    flushWatchQueue(true);
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveAllPositionsNow(); });
window.addEventListener("pagehide", saveAllPositionsNow);
window.addEventListener("online", () => flushWatchQueue());

function playlistGateInfo(m) {
  const videos = milestoneVideos(m);
  const trackable = videos.filter(v => TRACKABLE_TYPES.includes(v.info.type));
  const unwatched = trackable.filter(v => !isVideoWatched(m.milestone_id, v.url));
  return { videos, trackableCount: trackable.length, remaining: unwatched.length };
}

function needsVideoGate(m) {
  if (getStatus(m.milestone_id) !== "UNLOCKED") return false;
  const g = playlistGateInfo(m);
  return g.trackableCount > 0 && g.remaining > 0;
}

function fmtTime(sec) { sec = Math.max(0, Math.floor(sec || 0)); const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${s.toString().padStart(2, "0")}`; }

function updateVideoUI(mid, current, duration, isPlaying) {
  const fill = document.getElementById(`vc-progress-${mid}`);
  const time = document.getElementById(`vc-time-${mid}`);
  const btn = document.getElementById(`vc-playbtn-${mid}`);
  if (fill && duration > 0) fill.style.width = Math.min(100, (current / duration) * 100) + "%";
  if (time) time.textContent = `${fmtTime(current)} / ${fmtTime(duration)}`;
  if (btn) btn.textContent = isPlaying ? "⏸" : "▶";
}

function toggleVideoPlay(args) {
  const mid = args.mid;
  if (ytPlayers[mid]) { const state = ytPlayers[mid].getPlayerState(); if (state === 1) ytPlayers[mid].pauseVideo(); else ytPlayers[mid].playVideo(); return; }
  if (vimeoPlayers[mid]) { vimeoPlayers[mid].getPaused().then(paused => { paused ? vimeoPlayers[mid].play() : vimeoPlayers[mid].pause(); }).catch(() => {}); return; }
  const el = document.getElementById(`native-video-${mid}`);
  if (el) { el.paused ? el.play() : el.pause(); }
}

// Renders the player shell: one 16:9 stage that gets re-mounted per part,
// custom gated controls when the milestone still needs watching, and part
// chips below for playlists.
function renderPlaylistShell(m, gate) {
  const mid = m.milestone_id;
  const { videos } = playlistGateInfo(m);
  const chips = videos.length > 1
    ? `<div class="playlist-chips" id="chips-${escHtml(mid)}">${videos.map((v, i) => playlistChipHtml(m, v, i)).join("")}</div>`
    : "";
  return `
    <div class="video-wrap" id="video-wrap-${escHtml(mid)}" style="position:relative;padding-top:56.25%;border-radius:10px;overflow:hidden;margin-top:1rem;background:#000;">
      <div id="pl-frame-${escHtml(mid)}" style="position:absolute;top:0;left:0;width:100%;height:100%;"></div>
      ${gate ? `<div class="video-controls"><button class="vc-play-btn" data-call="toggleVideoPlay" data-mid="${escHtml(mid)}" id="vc-playbtn-${escHtml(mid)}">▶</button><div class="vc-progress-track"><div class="vc-progress-fill" id="vc-progress-${escHtml(mid)}"></div></div><span class="vc-time" id="vc-time-${escHtml(mid)}">0:00 / 0:00</span></div>` : ""}
      <button class="cinema-toggle-btn" data-call="enterCinemaMode" data-mid="${escHtml(mid)}" title="Expand" style="position:absolute;top:8px;right:8px;width:34px;height:34px;border-radius:8px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.25);color:#fff;font-size:16px;cursor:pointer;z-index:5;display:flex;align-items:center;justify-content:center;">⛶</button>
    </div>
    ${chips}`;
}

function playlistChipHtml(m, v, i) {
  const mid = m.milestone_id;
  const trackable = TRACKABLE_TYPES.includes(v.info.type);
  const watched = trackable && isVideoWatched(mid, v.url);
  const icon = watched ? "✓" : (trackable ? "▶" : "↗");
  return `<button class="playlist-chip ${watched ? "is-done" : ""}" id="pl-chip-${escHtml(mid)}-${i}" data-call="playlistSelectPart" data-mid="${escHtml(mid)}" data-idx="${i}">${icon} ${escHtml(v.title || ("Part " + (i + 1)))}</button>`;
}

function updatePlaylistChips(mid) {
  const m = milestones.find(x => x.milestone_id === mid);
  const chips = document.getElementById(`chips-${mid}`);
  if (!m || !chips) return;
  const { videos } = playlistGateInfo(m);
  chips.innerHTML = videos.map((v, i) => playlistChipHtml(m, v, i)).join("");
}

function teardownPlayer(mid) {
  const st = PLAYLIST_STATE[mid];
  if (st) { savePositionNow(mid); if (st.posTimer) clearInterval(st.posTimer); }
  if (st && st.pollTimer) { clearInterval(st.pollTimer); }
  if (ytPlayers[mid]) { try { ytPlayers[mid].destroy(); } catch (e) {} ytPlayers[mid] = null; }
  if (vimeoPlayers[mid]) { try { vimeoPlayers[mid].destroy(); } catch (e) {} vimeoPlayers[mid] = null; }
}

// Mounts part `idx` of the milestone's playlist into the stage. The player
// is rebuilt per part so switching works across YouTube/Vimeo/native in any
// mix; autoplay is attempted for the back-to-back chain (falls back to a
// tap hint if the browser blocks it).
function mountPlaylistPlayer(mid, idx, autoplay) {
  const m = milestones.find(x => x.milestone_id === mid);
  if (!m) return;
  const { videos } = playlistGateInfo(m);
  if (!videos.length) return;
  idx = Math.max(0, Math.min(idx, videos.length - 1));
  const gate = needsVideoGate(m);
  teardownPlayer(mid);
  PLAYLIST_STATE[mid] = { videos, idx, gate, pollTimer: null, posTimer: null };
  if (gate) startPositionTracker(mid);
  updatePlaylistChips(mid);
  const frame = document.getElementById(`pl-frame-${mid}`);
  if (!frame) return;
  const v = videos[idx];

  if (v.info.type === "youtube") {
    frame.innerHTML = `<div id="yt-embed-${escHtml(mid)}" style="position:absolute;top:0;left:0;width:100%;height:100%;"></div>`;
    ensureYouTubeApi(() => createYTPlayer(mid, v.info.id, gate, autoplay));
  } else if (v.info.type === "vimeo") {
    frame.innerHTML = `<div id="vimeo-embed-${escHtml(mid)}" style="position:absolute;top:0;left:0;width:100%;height:100%;"></div>`;
    ensureVimeoApi(() => createVimeoPlayer(mid, v.info.id, gate, autoplay));
  } else if (v.info.type === "file") {
    frame.innerHTML = `<video id="native-video-${escHtml(mid)}" playsinline ${gate ? "" : "controls"} style="position:absolute;top:0;left:0;width:100%;height:100%;background:#000;"><source src="${escHtml(v.url)}">Your browser doesn't support embedded video.</video>`;
    createNativePlayer(mid, gate, autoplay);
  } else if (v.info.type === "drive") {
    frame.innerHTML = `<iframe src="https://drive.google.com/file/d/${escHtml(v.info.id)}/preview" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
  } else {
    frame.innerHTML = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:1rem;text-align:center;"><p style="color:var(--text-muted);font-size:.85rem;">This video opens in a new tab.</p><a href="${escHtml(v.url)}" target="_blank" rel="noopener" class="btn-action btn-secondary" style="padding:.6rem 1rem;font-size:.85rem;">▶ Open video</a></div>`;
  }
}

function playlistSelectPart(args) {
  mountPlaylistPlayer(args.mid, parseInt(args.idx, 10) || 0, false);
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

function enterCinemaMode(args) {
  const mid = args.mid;
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

// Player factories — one per provider, all wired to handlePartEnded so the
// playlist chains and the watch-gate behave identically across types.
function createYTPlayer(mid, videoId, gate, autoplay) {
  const el = document.getElementById(`yt-embed-${mid}`);
  if (!el) return;
  let maxTime = 0;
  maxTime = resumePointFor(mid, gate);
  if (maxTime > 0) showToast(`Resuming from ${fmtTime(maxTime)}`, "info");
  const origin = encodeURIComponent(window.location.origin);
  const player = new YT.Player(el, {
    videoId: videoId,
    playerVars: gate ? { enablejsapi: 1, origin: origin, rel: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, start: Math.floor(maxTime) } : { rel: 0 },
    events: {
      onReady: () => {
        ytPlayers[mid] = player;
        if (autoplay) { try { player.playVideo(); } catch (err) {} }
        const st = PLAYLIST_STATE[mid];
        st.pollTimer = setInterval(() => {
          const p = ytPlayers[mid];
          if (!p || typeof p.getCurrentTime !== "function") return;
          const t = p.getCurrentTime(); const dur = p.getDuration ? p.getDuration() : 0;
          if (gate) {
            if (t > maxTime + 1.5) p.seekTo(maxTime, true); else if (t > maxTime) maxTime = t;
          }
          updateVideoUI(mid, maxTime, dur, p.getPlayerState && p.getPlayerState() === 1);
        }, 500);
      },
      onStateChange: e => { if (e.data === YT.PlayerState.ENDED) handlePartEnded(mid); }
    }
  });
}

function createVimeoPlayer(mid, videoId, gate, autoplay) {
  const el = document.getElementById(`vimeo-embed-${mid}`);
  if (!el) return;
  const player = new Vimeo.Player(el, { id: videoId, controls: gate ? false : true });
  vimeoPlayers[mid] = player;
  let maxTime = resumePointFor(mid, gate), duration = 0;
  if (maxTime > 0) { player.ready().then(() => player.setCurrentTime(maxTime)).catch(() => {}); showToast(`Resuming from ${fmtTime(maxTime)}`, "info"); }
  player.getDuration().then(d => { duration = d; }).catch(() => {});
  player.on("timeupdate", data => {
    vimeoLastTime[mid] = data.seconds;
    if (gate) {
      if (data.seconds > maxTime + 1.5) player.setCurrentTime(maxTime).catch(() => {});
      else if (data.seconds > maxTime) maxTime = data.seconds;
    } else if (data.seconds > maxTime) maxTime = data.seconds;
    updateVideoUI(mid, maxTime, duration || data.duration, true);
  });
  player.on("play", () => updateVideoUI(mid, maxTime, duration, true));
  player.on("pause", () => updateVideoUI(mid, maxTime, duration, false));
  player.on("ended", () => handlePartEnded(mid));
  if (autoplay) player.play().catch(() => showToast("Tap the part chip to continue.", "info"));
}

function createNativePlayer(mid, gate, autoplay) {
  const el = document.getElementById(`native-video-${mid}`);
  if (!el) return;
  let maxTime = resumePointFor(mid, gate);
  if (maxTime > 0) { el.addEventListener("loadedmetadata", () => { el.currentTime = maxTime; }, { once: true }); showToast(`Resuming from ${fmtTime(maxTime)}`, "info"); }
  el.addEventListener("timeupdate", () => {
    if (gate) {
      if (el.currentTime > maxTime + 1.5) el.currentTime = maxTime;
      else if (el.currentTime > maxTime) maxTime = el.currentTime;
    } else if (el.currentTime > maxTime) maxTime = el.currentTime;
    updateVideoUI(mid, maxTime, el.duration, !el.paused);
  });
  el.addEventListener("play", () => updateVideoUI(mid, maxTime, el.duration, true));
  el.addEventListener("pause", () => updateVideoUI(mid, maxTime, el.duration, false));
  el.addEventListener("ended", () => handlePartEnded(mid));
  if (autoplay) el.play().catch(() => showToast("Tap ▶ to play the next part.", "info"));
}

// Fired by every provider's "ended" event: records the part as watched,
// updates its chip, unlocks the submission area once nothing is left, and
// auto-advances to the next part while the gate is still active.
function handlePartEnded(mid) {
  const st = PLAYLIST_STATE[mid];
  const m = milestones.find(x => x.milestone_id === mid);
  if (!st || !m) return;
  const v = st.videos[st.idx];
  if (v && TRACKABLE_TYPES.includes(v.info.type) && !isVideoWatched(mid, v.url)) {
    localStorage.setItem(videoWatchKey(user.user_id, mid, v.url), "1");
    queueWatchSave(mid, v.url, { done: true });
    flushWatchQueue();
  }
  updatePlaylistChips(mid);
  const g = playlistGateInfo(m);
  if (g.remaining === 0) {
    openSubmissionArea(mid);
    if (cinemaActiveMid === mid) exitCinemaMode();
    showToast("All video parts complete — this step is unlocked!", "success");
    return;
  }
  showToast(`${escHtml(v.title || "Part " + (st.idx + 1))} complete — ${g.remaining} part${g.remaining > 1 ? "s" : ""} to go.`, "info");
  if (st.gate && st.idx < st.videos.length - 1) {
    mountPlaylistPlayer(mid, st.idx + 1, true);
  }
}

function openSubmissionArea(mid) {
  const lockNote = document.getElementById(`video-lock-note-${mid}`);
  const area = document.getElementById(`submission-area-${mid}`);
  if (lockNote) lockNote.style.display = "none";
  if (area) area.style.display = "block";
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
    <div style="font-weight: 500; font-size: 0.9rem; color: var(--text-main); margin-bottom: 0.875rem;">Q${qi+1}. ${escHtml(q.text)}</div>
    ${q.options.map((opt, oi) => `<label class="quiz-option" id="opt-${m.milestone_id}-${q.id}-${oi}" data-call="selectOpt" data-mid="${escHtml(m.milestone_id)}" data-qid="${escHtml(q.id)}" data-oi="${oi}" style="display: flex; align-items: center; gap: 10px; padding: 0.6rem 0.875rem; border-radius: 8px; border: 1.5px solid var(--border-strong); cursor: pointer; margin-bottom: 6px; transition: all 0.15s; font-size: 0.875rem; color: var(--text-muted);"><input type="radio" name="${m.milestone_id}-${q.id}" value="${oi}" style="accent-color: var(--gold); width:18px; height:18px; flex-shrink:0;"> ${escHtml(opt)}</label>`).join("")}
  </div>`).join("");
}

function buildSubmissionForm(m) {
  const type = m.submission_type;
  let html = `<div style="margin-top: 1.25rem;"><div style="font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--gold); margin-bottom: 1rem; font-weight: 500;">`;
  if (type === "CHECKBOX") {
    html += `Complete this milestone</div>
      <label id="chk-label-${m.milestone_id}" style="display: flex; align-items: flex-start; gap: 12px; background: var(--bg-surface); border-radius: 10px; padding: 1.25rem; cursor: pointer;">
        <input type="checkbox" id="chk-${m.milestone_id}" data-change="toggleCheckbox" data-mid="${escHtml(m.milestone_id)}" style="width: 18px; height: 18px; margin-top: 2px; accent-color: var(--gold); cursor: pointer; flex-shrink: 0;">
        <div style="font-size: 0.875rem; color: var(--text-muted); line-height: 1.6;"><strong style="color: var(--text-main);">I confirm</strong> that I have read and understood the content of this milestone and am ready to proceed.</div>
      </label><br>
      <button class="btn-action btn-primary" id="btn-${m.milestone_id}" disabled data-call="submitCheckbox" data-mid="${escHtml(m.milestone_id)}" data-course_id="${escHtml(currentCourse.course_id)}">Mark Complete</button>`;
  } else if (type === "QUIZ") {
    html += `Quiz Assessment (pass mark: ${m.pass_score}%)</div><div id="quiz-${m.milestone_id}">${renderQuizQuestions(m)}</div><button class="btn-action btn-primary" id="btn-${m.milestone_id}" data-call="submitQuiz" data-mid="${escHtml(m.milestone_id)}" data-course_id="${escHtml(currentCourse.course_id)}">Submit Quiz</button><div id="quiz-result-${m.milestone_id}" style="display:none"></div>`;
  } else if (type === "WRITTEN") {
    html += `Written Response (reviewed by leadership)</div>
      <textarea id="wr-${m.milestone_id}" placeholder="Write your response here..." rows="6" style="width: 100%; min-height: 140px; padding: 1rem; background: var(--bg-surface); border: 1.5px solid var(--border-strong); border-radius: 10px; color: var(--text-main); font-family: 'Inter', sans-serif; font-size: 0.875rem; line-height: 1.6; resize: vertical; outline: none; transition: border-color 0.2s;"></textarea><br>
      <button class="btn-action btn-primary" style="margin-top: 1rem;" id="btn-${m.milestone_id}" data-call="submitWritten" data-mid="${escHtml(m.milestone_id)}" data-course_id="${escHtml(currentCourse.course_id)}">Submit Response</button>`;
  }
  html += `</div>`; return html;
}

function toggleCard(args) {
  const mid = args.mid;
  const body  = document.getElementById(`body-${mid}`); const chev  = document.getElementById(`chev-${mid}`);
  const isOpen = body.style.display === "block";
  document.querySelectorAll('[id^="body-"]').forEach(b => { if(b.id !== `body-${mid}`) b.style.display = "none"; });
  document.querySelectorAll('[id^="chev-"]').forEach(c => { if(c.id !== `chev-${mid}`) c.style.transform = "rotate(0deg)"; });
  if (!isOpen) {
    body.style.display = "block"; if(chev) chev.style.transform = "rotate(180deg)";
    // Lazy-mount the player the first time the card opens (one live player
    // at a time keeps phones fast) — start at the first unwatched part.
    const m = milestones.find(x => x.milestone_id === mid);
    if (m && milestoneVideos(m).length) {
      let startIdx = 0;
      if (needsVideoGate(m)) {
        const { videos } = playlistGateInfo(m);
        const fu = videos.findIndex(v => TRACKABLE_TYPES.includes(v.info.type) && !isVideoWatched(mid, v.url));
        if (fu > -1) startIdx = fu;
      }
      mountPlaylistPlayer(mid, startIdx, false);
    }
  }
  else {
    body.style.display = "none"; if(chev) chev.style.transform = "rotate(0deg)";
    teardownPlayer(mid); // stop playback when the card closes
  }
}

function toggleCheckbox(args) { const checked = document.getElementById(`chk-${args.mid}`).checked; document.getElementById(`btn-${args.mid}`).disabled = !checked; }

function selectOpt(args) {
  const mid = args.mid, qid = args.qid, optIdx = parseInt(args.oi, 10);
  document.querySelectorAll(`[id^="opt-${mid}-${qid}-"]`).forEach(el => { el.style.borderColor = "var(--border-strong)"; el.style.background = "transparent"; el.style.color = "var(--text-muted)"; });
  const selectedEl = document.getElementById(`opt-${mid}-${qid}-${optIdx}`);
  selectedEl.style.borderColor = "var(--gold)"; selectedEl.style.background = "var(--gold-bg)"; selectedEl.style.color = "var(--gold-lt)";
}

async function submitCheckbox(args) {
  const mid = args.mid, courseId = args.course_id;
  const btn = document.getElementById(`btn-${mid}`); btn.disabled = true; btn.textContent = "Saving…";
  const res = await apiCall("submitCheckbox", { milestone_id: mid, course_id: courseId });
  if (res.success) { showToast("Milestone marked complete!", "success"); await refreshProgress(courseId); }
  else { showToast(res.error || "Error", "error"); btn.disabled = false; btn.textContent = "Mark Complete"; }
}

async function submitQuiz(args) {
  const mid = args.mid, courseId = args.course_id;
  const btn = document.getElementById(`btn-${mid}`); const quiz = milestones.find(m => m.milestone_id === mid); if (!quiz) return;
  const questions = JSON.parse(quiz.quiz_json || "{}").questions || [];
  const answers = {}; let allAnswered = true;
  questions.forEach(q => { const sel = document.querySelector(`input[name="${mid}-${q.id}"]:checked`); if (sel) answers[q.id] = parseInt(sel.value); else allAnswered = false; });
  if (!allAnswered) { showToast("Please answer all questions before submitting.", "error"); return; }
  btn.disabled = true; btn.textContent = "Submitting…";
  const res = await apiCall("submitQuiz", { milestone_id: mid, course_id: courseId, answers });
  if (res.success) {
    // SERVER-SIDE GRADING: per-question results come back in the response —
    // the answer key is never shipped to the browser, so a learner with
    // devtools can't look up the correct options before submitting.
    const qData = JSON.parse(quiz.quiz_json || "{}");
    const resultMap = {};
    (res.results || []).forEach(r => { resultMap[r.qid] = r; });
    qData.questions.forEach(q => {
      const r = resultMap[q.id];
      if (!r) return;
      const userAns = r.user, correct = r.correct;
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
    if (!res.passed) resultEl.innerHTML += `<button class="btn-action btn-secondary" style="margin-top: 0.75rem; padding: 0.625rem 1.25rem; font-size: 0.875rem;" data-call="retakeQuiz" data-mid="${escHtml(mid)}">Try Again</button>`;
    if (res.passed) { showToast(`Quiz passed with ${res.score}%! 🎉`, "success"); await refreshProgress(courseId); }
    else { showToast(`Score: ${res.score}% — need ${res.passScore}% to pass.`, "error"); }
  } else { showToast(res.error || "Submission error", "error"); btn.disabled = false; btn.textContent = "Submit Quiz"; }
}

function retakeQuiz(args) {
  const mid = args.mid;
  const m = milestones.find(x => x.milestone_id === mid);
  if (!m) return;

  const quizEl = document.getElementById(`quiz-${mid}`);
  if (quizEl) quizEl.innerHTML = renderQuizQuestions(m);

  const resultEl = document.getElementById(`quiz-result-${mid}`);
  if (resultEl) { resultEl.style.display = "none"; resultEl.innerHTML = ""; }

  const btn = document.getElementById(`btn-${mid}`);
  if (btn) { btn.style.display = ""; btn.disabled = false; btn.textContent = "Submit Quiz"; }
}

async function submitWritten(args) {
  const mid = args.mid, courseId = args.course_id;
  const content = document.getElementById(`wr-${mid}`).value.trim();
  if (!content || content.length < 20) { showToast("Please write a more detailed response (at least 20 characters).", "error"); return; }
  const btn = document.getElementById(`btn-${mid}`); btn.disabled = true; btn.textContent = "Submitting…";
  const res = await apiCall("submitWritten", { milestone_id: mid, course_id: courseId, content });
  if (res.success) { showToast("Response submitted for review!", "success"); await refreshProgress(courseId); } 
  else { showToast(res.error || "Error", "error"); btn.disabled = false; btn.textContent = "Submit Response"; }
}

async function refreshProgress(courseId) {
  const pRes = await apiCall("getProgress", { course_id: courseId });
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

// ==========================================
// FORGOT PASSWORD (self-service, email code)
// ==========================================
function showForgotMsg(msg, type) {
  const el = document.getElementById("fp-msg");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
  el.style.background = type === "error" ? "var(--error-bg)" : "var(--success-bg)";
  el.style.color = type === "error" ? "var(--error)" : "var(--success)";
}

async function doForgotRequest() {
  const identifier = document.getElementById("fp-identifier").value.trim();
  if (!identifier) return showForgotMsg("Enter the email or username on your account.", "error");
  const btn = document.getElementById("fp-btn-request");
  setBtnLoading(btn, "Sending…");
  try {
    const res = await apiCall("requestPasswordReset", { identifier });
    if (res.success) {
      showForgotMsg(res.message || "Reset code sent — check your email.", "success");
      const step2 = document.getElementById("fp-step2");
      if (step2) step2.style.display = "block";
      if (btn) btn.style.display = "none";
    } else showForgotMsg(res.error || "Something went wrong.", "error");
  } catch (err) {
    showForgotMsg("Connection error. Check API setup.", "error");
  }
  resetBtn(btn);
}

async function doForgotReset() {
  const identifier = document.getElementById("fp-identifier").value.trim();
  const code = document.getElementById("fp-code").value.trim();
  const new_password = document.getElementById("fp-new").value;
  if (!code) return showForgotMsg("Enter the 6-digit code from your email.", "error");
  const pwIssue = validatePasswordClient_(new_password);
  if (pwIssue) return showForgotMsg(pwIssue, "error");
  const btn = document.getElementById("fp-btn-reset");
  setBtnLoading(btn, "Updating…");
  try {
    const res = await apiCall("resetPassword", { identifier, code, new_password });
    if (res.success) {
      showForgotMsg("Password updated! Return to sign in.", "success");
      setTimeout(() => toggleAuthView("login"), 1500);
    } else showForgotMsg(res.error || "Something went wrong.", "error");
  } catch (err) {
    showForgotMsg("Connection error. Check API setup.", "error");
  }
  resetBtn(btn);
}

// ==========================================
// ADMIN — ESSAY PROJECTS, DEFENCE & BROADCASTS
// ==========================================

// Small stats strip fed by the aggregated dashboard (projectStats) so the
// Projects view shows live counts even before its own data loads.
function renderProjectStats() {
  const el = document.getElementById("projStatsRow");
  if (!el || !projectStats) return;
  el.innerHTML = `
    <div class="proj-stat"><span class="proj-stat-num">${projectStats.assigned || 0}</span><span class="proj-stat-label">Assigned</span></div>
    <div class="proj-stat"><span class="proj-stat-num">${projectStats.submitted || 0}</span><span class="proj-stat-label">Awaiting grade</span></div>
    <div class="proj-stat"><span class="proj-stat-num">${projectStats.graded || 0}</span><span class="proj-stat-label">Graded</span></div>`;
}

async function loadProjectAdmin() {
  const res = await apiCall("getProjectAdminData", {});
  if (res.error) { showToast(res.error, "error"); return; }
  currentProjectAdmin = res;
  renderProjectAdmin();
}

function renderProjectAdmin() {
  if (!currentProjectAdmin) return;
  const d = currentProjectAdmin;

  // Question bank
  const qWrap = document.getElementById("pqList");
  if (qWrap) {
    qWrap.innerHTML = (d.questions || []).length
      ? d.questions.map(q => `
          <div style="display:flex;align-items:flex-start;gap:.6rem;padding:.6rem 0;border-bottom:1px solid var(--border-subtle);">
            <div style="flex:1;font-size:.85rem;color:var(--text-main);line-height:1.5;">${escHtml(q.question_text)}</div>
            <button class="chip-btn chip-btn--steel" data-call="editProjectQuestion" data-project_id="${escHtml(q.project_id)}">✏️</button>
            <button class="chip-btn chip-btn--danger" data-call="deleteProjectQuestion" data-project_id="${escHtml(q.project_id)}">🗑</button>
          </div>`).join("")
      : `<p style="color:var(--text-dim);font-size:.85rem;padding:.5rem 0">No questions yet — add your essay prompts below.</p>`;
  }

  // Defence form prefill
  const pdDate = document.getElementById("pd-date");
  if (pdDate) {
    if (d.defence) {
      const dt = new Date(d.defence.defence_date);
      pdDate.value = isNaN(dt.getTime()) ? "" : dt.toISOString().substring(0, 10);
      const pdVenue = document.getElementById("pd-venue"); if (pdVenue) pdVenue.value = d.defence.venue || "";
      const pdMsg = document.getElementById("pd-msg"); if (pdMsg) pdMsg.value = d.defence.message || "";
      const pdStatus = document.getElementById("pd-status");
      if (pdStatus) pdStatus.textContent = "Active defence: " + fmtDateTime(d.defence.defence_date) + (d.defence.venue ? " · " + d.defence.venue : "");
    } else {
      const pdStatus = document.getElementById("pd-status");
      if (pdStatus) pdStatus.textContent = "No defence date set yet.";
    }
  }

  // Submissions table
  const tbody = document.getElementById("projectSubsBody");
  if (tbody) {
    const subs = (d.assignments || []).filter(a => a.status !== "ASSIGNED");
    if (!subs.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--text-dim)">No essays submitted yet.</td></tr>`;
    } else {
      tbody.innerHTML = subs.map(a => `
        <tr>
          <td data-label="Member">${escHtml(a.full_name || a.user_id)}</td>
          <td data-label="Question" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font-size:.82rem;" title="${escHtml(a.question_text)}">${escHtml(a.question_text)}</td>
          <td data-label="Status">${projectStatusBadge(a.status)}</td>
          <td data-label="Submitted" style="color:var(--text-dim);font-size:.8rem">${a.submitted_at ? fmtDateTime(a.submitted_at) : "—"}</td>
          <td data-label="Score" style="font-family:'JetBrains Mono',monospace;font-size:.85rem">${a.score !== "" && a.score !== undefined ? a.score + "%" : "—"}</td>
          <td data-label="Action">${a.status === "SUBMITTED" ? `<button class="chip-btn chip-btn--gold" data-call="openProjectReview" data-assign_id="${escHtml(a.assign_id)}">📝 Grade</button>` : `<span style="color:var(--text-dim);font-size:.8rem">Done</span>`}</td>
        </tr>`).join("");
    }
    const countEl = document.getElementById("projSubCount");
    if (countEl) {
      const total = d.assignments.length || 0;
      countEl.textContent = `${subs.length} of ${total} assigned member(s) have submitted.` + (d.learnersWithoutProject ? ` ${d.learnersWithoutProject} learner(s) have no project yet — press Assign.` : "");
    }
  }
}

function projectStatusBadge(status) {
  const map = { ASSIGNED: "badge badge--locked", SUBMITTED: "badge badge--submitted", GRADED: "badge badge--passed" };
  const label = { ASSIGNED: "Assigned", SUBMITTED: "Submitted", GRADED: "Graded" };
  return `<span class="${map[status] || "badge badge--locked"}">${label[status] || status}</span>`;
}

async function addProjectQuestion() {
  const input = document.getElementById("pq-input");
  const text = (input ? input.value : "").trim();
  if (text.length < 10) return showToast("Write a full essay prompt (at least 10 characters).", "error");
  const res = await apiCall("saveProjectQuestion", { question_text: text });
  if (res.success) {
    showToast("Question added to the bank.", "success");
    if (input) input.value = "";
    await loadProjectAdmin();
  } else showToast(res.error || "Error", "error");
}

function editProjectQuestion(args) {
  const q = (currentProjectAdmin && currentProjectAdmin.questions || []).find(x => x.project_id === args.project_id);
  if (!q) return;
  const updated = prompt("Edit essay question:", q.question_text);
  if (updated === null || updated.trim().length < 10) { if (updated !== null) showToast("Question is too short.", "error"); return; }
  apiCall("saveProjectQuestion", { project_id: args.project_id, question_text: updated.trim() })
    .then(res => { if (res.success) { showToast("Question updated.", "success"); loadProjectAdmin(); } else showToast(res.error || "Error", "error"); });
}

async function deleteProjectQuestion(args) {
  if (!confirm("Remove this question from the bank? Learners already assigned keep their copy.")) return;
  const res = await apiCall("deleteProjectQuestion", { project_id: args.project_id });
  if (res.success) { showToast("Question removed.", "success"); await loadProjectAdmin(); }
  else showToast(res.error || "Error", "error");
}

// Deals one question per learner, round-robin over a shuffled deck. Learners
// who already have one are skipped, so this is safe to press repeatedly
// (e.g. after a new intake joins).
async function assignProjects() {
  if (!confirm("Assign one essay question to every learner who doesn't have one yet?")) return;
  const btn = document.getElementById("btn-assign-projects");
  if (btn) setBtnLoading(btn, "Dealing…");
  const res = await apiCall("assignProjects", {});
  if (res.success) {
    showToast(res.message || "Projects assigned.", "success");
    await loadProjectAdmin();
  } else showToast(res.error || "Error", "error");
  if (btn) resetBtn(btn);
}

// Saves the defence date AND broadcasts it to every learner's portal —
// this is the notification requirement, handled server-side in one action.
async function saveDefenceDate() {
  const dateVal = document.getElementById("pd-date").value;
  const venue = document.getElementById("pd-venue").value.trim();
  const message = document.getElementById("pd-msg").value.trim();
  if (!dateVal) return showToast("Pick a defence date first.", "error");
  const when = new Date(dateVal);
  if (isNaN(when.getTime())) return showToast("That date doesn't look valid.", "error");
  const btn = document.getElementById("btn-save-defence");
  if (btn) setBtnLoading(btn, "Saving…");
  const res = await apiCall("setDefenceDate", { defence_date: when.toISOString(), venue, message });
  if (btn) resetBtn(btn);
  if (res.success) {
    showToast(res.message || "Defence date set and learners notified.", "success");
    await loadProjectAdmin();
  } else showToast(res.error || "Error", "error");
}

async function broadcastNotice() {
  const audience = document.getElementById("bc-audience").value;
  const course_id = document.getElementById("bc-course").value;
  const title = document.getElementById("bc-title").value.trim();
  const body = document.getElementById("bc-body").value.trim();
  if (!title || !body) return showToast("Give the broadcast a title and a message.", "error");
  if (audience === "COURSE" && !course_id) return showToast("Pick the course this broadcast targets.", "error");
  const btn = document.getElementById("btn-send-broadcast");
  if (btn) setBtnLoading(btn, "Sending…");
  const res = await apiCall("broadcastNotification", { audience, course_id, title, body });
  if (btn) resetBtn(btn);
  if (res.success) {
    showToast(res.message || "Broadcast sent.", "success");
    ["bc-title", "bc-body"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  } else showToast(res.error || "Error", "error");
}

function toggleBroadcastCourseRow() {
  const audience = document.getElementById("bc-audience").value;
  const row = document.getElementById("bc-course-row");
  if (row) row.style.display = audience === "COURSE" ? "block" : "none";
}

// ── Grade modal ──
let gradingAssignId = null;
function openProjectReview(args) {
  const a = (currentProjectAdmin && currentProjectAdmin.assignments || []).find(x => x.assign_id === args.assign_id);
  if (!a) return;
  gradingAssignId = a.assign_id;
  document.getElementById("pr-name").textContent = a.full_name || a.user_id;
  document.getElementById("pr-question").textContent = a.question_text || "";
  document.getElementById("pr-essay").textContent = a.submission_text || "";
  const linkRow = document.getElementById("pr-link-row");
  if (linkRow) {
    if (a.doc_link) {
      linkRow.style.display = "block";
      const la = document.getElementById("pr-link");
      if (la) { la.href = a.doc_link; la.textContent = a.doc_link; }
    } else linkRow.style.display = "none";
  }
  document.getElementById("pr-score").value = "";
  document.getElementById("pr-feedback").value = "";
  document.getElementById("projectReviewModal").classList.add("active");
}

function closeProjectReviewModal() { document.getElementById("projectReviewModal").classList.remove("active"); }

async function submitProjectGrade() {
  if (!gradingAssignId) return;
  const score = document.getElementById("pr-score").value;
  const feedback = document.getElementById("pr-feedback").value.trim();
  const parsed = parseInt(score);
  if (isNaN(parsed) || parsed < 0 || parsed > 100) return showToast("Score must be between 0 and 100.", "error");
  const btn = document.getElementById("btn-grade-submit");
  if (btn) setBtnLoading(btn, "Saving…");
  const res = await apiCall("gradeProject", { assign_id: gradingAssignId, score: parsed, feedback });
  if (btn) resetBtn(btn);
  if (res.success) {
    showToast("Graded — the learner has been notified.", "success");
    closeProjectReviewModal();
    gradingAssignId = null;
    await loadProjectAdmin();
    await loadAdminDashboard();
  } else showToast(res.error || "Error", "error");
}

// ==========================================
// LEARNER — FINAL PROJECT
// ==========================================
let projectViewData = null;
const PROJECT_DRAFT_KEY = () => `proj_draft_${user.user_id}`;

async function openProject() {
  currentCourse = null;
  currentView = 'project';
  renderCourseList();
  closeMobileSidebar();
  stopGraduationPolling();
  setLearnerTopbar("Final Project", "Your assigned essay question and submission.");
  const tc = document.getElementById("trackContainer");
  if (!tc) return;
  tc.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--text-dim);">Loading your project…</div>`;
  const res = await apiCall("getMyProject", {});
  if (res.error) { tc.innerHTML = `<div style="color:var(--error);padding:2rem;">${escHtml(res.error)}</div>`; return; }
  projectViewData = res;
  renderProjectView();
}

function projectDeadlineInfo() {
  const d = projectViewData;
  if (!d || !d.defence || !d.defence.defence_date) return null;
  const when = new Date(d.defence.defence_date);
  if (isNaN(when.getTime())) return null;
  const msLeft = when.getTime() - Date.now();
  return {
    when,
    label: fmtDateTime(d.defence.defence_date),
    passed: msLeft <= 0,
    daysLeft: Math.max(0, Math.floor(msLeft / 86400000)),
    hoursLeft: Math.max(0, Math.floor(msLeft / 3600000))
  };
}

function renderProjectView() {
  const tc = document.getElementById("trackContainer");
  if (!tc || !projectViewData) return;
  const d = projectViewData;
  const a = d.assignment;
  const dl = projectDeadlineInfo();
  const venue = d.defence && d.defence.venue ? ` · ${escHtml(d.defence.venue)}` : "";
  const extraMsg = d.defence && d.defence.message ? `<p style="margin-top:.5rem;color:var(--text-muted);font-size:.85rem;">${escHtml(d.defence.message)}</p>` : "";

  const defenceBanner = dl ? `
    <div style="background: var(--steel-bg); border: 1px solid var(--steel); border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:.75rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.07em;">Project Defence</div>
          <div style="font-weight:600;color:var(--text-main);font-size:.95rem;">${dl.label}${venue}</div>
          ${extraMsg}
        </div>
        <div style="text-align:right;">
          ${dl.passed
            ? `<span style="color:var(--error);font-weight:600;font-size:.9rem;">Deadline passed</span>`
            : `<span style="color:var(--gold-lt);font-weight:600;font-size:.9rem;">${dl.daysLeft} day${dl.daysLeft === 1 ? "" : "s"} left</span>
               <div style="font-size:.72rem;color:var(--text-dim);">${dl.hoursLeft}h remaining</div>`}
        </div>
      </div>
    </div>` : "";

  if (!a) {
    tc.innerHTML = `
      <div style="max-width:640px;">
        ${defenceBanner}
        <div style="text-align:center;padding:2.5rem 1rem;">
          <div style="font-size:3rem;margin-bottom:1rem;">📝</div>
          <h2 style="font-family:'DM Serif Display',serif;font-size:1.5rem;color:var(--text-main);margin-bottom:.5rem;">No project assigned yet</h2>
          <p style="font-size:.9rem;color:var(--text-dim);line-height:1.7;">Your essay question will appear here as soon as leadership assigns the final projects. You'll also get a notification the moment it lands.</p>
        </div>
      </div>`;
    return;
  }

  const steps = ["ASSIGNED", "SUBMITTED", "GRADED"];
  const currentStep = steps.indexOf(a.status);
  const timeline = `<div style="display:flex;gap:.5rem;margin-bottom:1.5rem;">
    ${steps.map((s, i) => `
      <div style="flex:1;text-align:center;">
        <div style="height:6px;border-radius:3px;background:${i <= currentStep ? "linear-gradient(90deg,var(--gold),var(--gold-lt))" : "var(--border-subtle)"};margin-bottom:6px;"></div>
        <div style="font-size:.7rem;color:${i <= currentStep ? "var(--gold-lt)" : "var(--text-dim)"};font-weight:500;text-transform:uppercase;letter-spacing:.05em;">${s.charAt(0) + s.slice(1).toLowerCase()}</div>
      </div>`).join("")}
  </div>`;

  const questionBlock = `
    <div style="background: var(--bg-surface); border-left: 3px solid var(--gold); border-radius: 10px; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem;">
      <div style="font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.5rem;">Your essay question</div>
      <p style="font-size:.95rem;color:var(--text-main);line-height:1.7;">${escHtml(a.question_text)}</p>
    </div>`;

  if (a.status === "GRADED") {
    tc.innerHTML = `
      <div style="max-width:640px;">
        ${defenceBanner}
        ${timeline}
        ${questionBlock}
        <div style="background: var(--success-bg); border: 1px solid rgba(34,197,94,0.25); border-radius: 12px; padding: 1.5rem; text-align:center; margin-bottom: 1.5rem;">
          <div style="font-family:'DM Serif Display',serif;font-size:3rem;line-height:1;color:var(--success);margin-bottom:.5rem;">${a.score !== "" && a.score !== undefined ? a.score + "%" : "—"}</div>
          <div style="font-size:.875rem;color:var(--success);font-weight:500;">Your project has been graded.</div>
        </div>
        ${a.feedback ? `<div style="background: var(--bg-surface); border-radius: 10px; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem;"><div style="font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.5rem;">Feedback from your leader</div><p style="font-size:.9rem;color:var(--text-main);line-height:1.7;">${escHtml(a.feedback)}</p></div>` : ""}
        <details style="background:var(--bg-panel);border:1px solid var(--border-subtle);border-radius:10px;padding:1rem 1.25rem;">
          <summary style="cursor:pointer;font-size:.85rem;color:var(--gold);font-weight:500;">View your submitted essay</summary>
          <p style="margin-top:1rem;font-size:.875rem;color:var(--text-muted);line-height:1.7;white-space:pre-wrap;">${escHtml(a.submission_text || "")}</p>
          ${a.doc_link ? `<p style="margin-top:.75rem;"><a href="${escHtml(a.doc_link)}" target="_blank" rel="noopener" style="color:var(--gold-lt);font-size:.85rem;">Attached document ↗</a></p>` : ""}
        </details>
      </div>`;
    return;
  }

  const deadlineClosed = dl && dl.passed;
  const editor = deadlineClosed ? `
      <div style="background: var(--error-bg); border: 1px solid rgba(239,68,68,0.2); border-radius: 10px; padding: 1.25rem 1.5rem; font-size: .875rem; color: var(--error);">
        The defence date has arrived, so submissions are closed. If you haven't submitted yet, please contact your admin as soon as possible.
      </div>` : `
      <div>
        <label style="display:block;font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.4rem;">Your essay ${a.status === "SUBMITTED" ? "(resubmit any time before the deadline)" : ""}</label>
        <textarea id="proj-essay" rows="12" placeholder="Write your full essay here…" style="width:100%;min-height:240px;padding:1rem;background:var(--bg-surface);border:1.5px solid var(--border-strong);border-radius:10px;color:var(--text-main);font-family:'Inter',sans-serif;font-size:16px;line-height:1.7;resize:vertical;outline:none;transition:border-color .2s;">${escHtml(a.submission_text || "")}</textarea>
        <div style="display:flex;justify-content:space-between;font-size:.75rem;color:var(--text-dim);margin-top:.35rem;">
          <span id="proj-charcount">0 characters · minimum ${d.minChars}</span>
          <span>Your writing is saved on this device as you type.</span>
        </div>
        <div style="margin-top:1rem;">
          <label style="display:block;font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.4rem;">Document link (optional — Google Doc / Drive)</label>
          <input type="url" id="proj-link" value="${escHtml(a.doc_link || "")}" placeholder="https://docs.google.com/…" style="width:100%;padding:.75rem 1rem;background:var(--bg-surface);border:1.5px solid var(--border-strong);border-radius:10px;color:var(--text-main);font-size:16px;outline:none;">
        </div>
        <button class="btn-action btn-primary" id="btn-submit-project" data-call="submitProjectEssay" style="width:100%;justify-content:center;margin-top:1.25rem;">${a.status === "SUBMITTED" ? "Update Submission" : "Submit Essay"}</button>
      </div>`;

  tc.innerHTML = `
    <div style="max-width:640px;">
      ${defenceBanner}
      ${timeline}
      ${questionBlock}
      ${a.feedback ? `<div style="background: var(--warning-bg); border: 1px solid rgba(245,158,11,0.25); border-radius: 10px; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem;"><div style="font-size:.72rem;color:var(--warning);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.5rem;">Note from your leader</div><p style="font-size:.9rem;color:var(--text-main);line-height:1.7;">${escHtml(a.feedback)}</p></div>` : ""}
      ${a.submitted_at ? `<p style="font-size:.8rem;color:var(--text-dim);margin-bottom:1.25rem;">Last submitted ${fmtDateTime(a.submitted_at)}.</p>` : ""}
      ${editor}
    </div>`;

  bindProjectEditor();
}

function bindProjectEditor() {
  const ta = document.getElementById("proj-essay");
  if (!ta) return;
  const counter = document.getElementById("proj-charcount");
  const minChars = (projectViewData && projectViewData.minChars) || 250;
  const update = () => {
    if (counter) counter.textContent = `${ta.value.length} characters · minimum ${minChars}`;
    // Draft autosave — survives a closed tab or dead battery mid-essay.
    try { localStorage.setItem(PROJECT_DRAFT_KEY(), ta.value); } catch (e) {}
  };
  ta.addEventListener("input", update);
  update();
  // Prefer the saved draft if it's longer than what the server has.
  try {
    const draft = localStorage.getItem(PROJECT_DRAFT_KEY());
    if (draft && draft.length > ta.value.length) { ta.value = draft; update(); }
  } catch (e) {}
}

async function submitProjectEssay() {
  const ta = document.getElementById("proj-essay");
  const linkEl = document.getElementById("proj-link");
  const essay_text = ta ? ta.value.trim() : "";
  const doc_link = linkEl ? linkEl.value.trim() : "";
  const minChars = (projectViewData && projectViewData.minChars) || 250;
  if (essay_text.length < minChars) {
    return showToast(`Your essay is too short — write at least ${minChars} characters (${essay_text.length} so far).`, "error");
  }
  const dl = projectDeadlineInfo();
  if (dl && dl.passed) return showToast("The deadline has passed — please contact your admin.", "error");
  const a = projectViewData && projectViewData.assignment;
  if (a && a.status === "SUBMITTED" && !confirm("Update your submission? Your leaders will see the newest version.")) return;
  const btn = document.getElementById("btn-submit-project");
  if (btn) setBtnLoading(btn, "Submitting…");
  const res = await apiCall("submitProject", { essay_text, doc_link });
  if (btn) resetBtn(btn);
  if (res.success) {
    try { localStorage.removeItem(PROJECT_DRAFT_KEY()); } catch (e) {}
    showToast(res.message || "Essay submitted!", "success");
    await openProject();
  } else showToast(res.error || "Error", "error");
}

// ==========================================
// NOTIFICATIONS (learner bell + bottom nav badge; admin bell)
// ==========================================
function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

async function refreshNotifications() {
  const res = await apiCall("getNotifications", {});
  if (res && res.success) {
    notifState = { items: res.notifications || [], unread: res.unread || 0 };
    updateNotifBadges();
  }
}

function updateNotifBadges() {
  ["bellBadge", "bnBadge"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (notifState.unread > 0) {
      el.style.display = "flex";
      el.textContent = notifState.unread > 9 ? "9+" : String(notifState.unread);
    } else el.style.display = "none";
  });
}

// Admin variant — the aggregated dashboard carries the admin's own feed
// along in the same response (res.notif).
function updateAdminBell(feed) {
  if (!feed) return;
  notifState = { items: feed.notifications || [], unread: feed.unread || 0 };
  const el = document.getElementById("adminBellBadge");
  if (!el) return;
  if (notifState.unread > 0) {
    el.style.display = "flex";
    el.textContent = notifState.unread > 9 ? "9+" : String(notifState.unread);
  } else el.style.display = "none";
}

// Admin bell → opens a lightweight modal listing their notifications and
// marks them read (admin sessions may receive project/grading fan-outs).
async function openAdminNotifications() {
  const list = document.getElementById("adminNotifList");
  if (list) {
    list.innerHTML = notifState.items.length
      ? notifState.items.slice(0, 20).map(n => `
          <div class="notif-item ${n.read_at ? "" : "is-unread"}" style="padding:.75rem 0;border-bottom:1px solid var(--border-subtle);">
            <div class="notif-item-head">
              <strong style="font-size:.9rem;color:var(--text-main);">${escHtml(n.title)}</strong>
              <span style="font-size:.72rem;color:var(--text-dim);white-space:nowrap;">${fmtDateTime(n.created_at)}</span>
            </div>
            <p style="font-size:.82rem;color:var(--text-muted);line-height:1.6;margin-top:.3rem;">${escHtml(n.body)}</p>
          </div>`).join("")
      : `<p style="color:var(--text-dim);font-size:.85rem;text-align:center;padding:1rem;">No notifications yet.</p>`;
  }
  document.getElementById("adminNotifModal").classList.add("active");
  if (notifState.unread > 0) {
    const res = await apiCall("markNotificationsRead", {});
    if (res && res.success) {
      notifState.unread = 0;
      updateAdminBell(notifState);
    }
  }
}

function closeAdminNotifModal() { document.getElementById("adminNotifModal").classList.remove("active"); }

function setLearnerTopbar(title, sub) {
  const t = document.getElementById("topbarTitle"); if (t) t.textContent = title;
  const s = document.getElementById("topbarSub"); if (s) s.textContent = sub;
  const ps = document.getElementById("progressSummary"); if (ps) ps.style.display = "none";
}

async function openNotifications() {
  currentCourse = null;
  currentView = 'notifications';
  renderCourseList();
  closeMobileSidebar();
  stopGraduationPolling();
  setLearnerTopbar("Notifications", "Announcements from leadership.");
  renderNotifications();
  await refreshNotifications();
  renderNotifications();
  if (notifState.unread > 0) {
    const res = await apiCall("markNotificationsRead", {});
    if (res && res.success) { notifState.unread = 0; updateNotifBadges(); }
  }
}

function renderNotifications() {
  const tc = document.getElementById("trackContainer");
  if (!tc) return;
  if (!notifState.items.length) {
    tc.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;">
        <div style="font-size:3rem;margin-bottom:1rem;opacity:.4;">🔔</div>
        <h3 style="font-family:'DM Serif Display',serif;font-size:1.3rem;color:var(--text-main);margin-bottom:.5rem;">No notifications yet</h3>
        <p style="color:var(--text-dim);font-size:.875rem;">Announcements from leadership and project updates will appear here.</p>
      </div>`;
    return;
  }
  tc.innerHTML = `<div style="max-width:640px;display:flex;flex-direction:column;gap:.75rem;">
    ${notifState.items.map(n => `
      <div class="notif-item ${n.read_at ? "" : "is-unread"}">
        <div class="notif-item-head">
          <strong style="font-size:.92rem;color:var(--text-main);">${escHtml(n.title)}</strong>
          <span style="font-size:.72rem;color:var(--text-dim);white-space:nowrap;">${fmtDateTime(n.created_at)}</span>
        </div>
        <p style="font-size:.85rem;color:var(--text-muted);line-height:1.65;margin-top:.35rem;">${escHtml(n.body)}</p>
      </div>`).join("")}
  </div>`;
}

// Lightweight unread-count refresh every 60s — one small call.
function startNotificationPolling() {
  refreshNotifications();
  if (window.__notifPoll) clearInterval(window.__notifPoll);
  window.__notifPoll = setInterval(() => {
    if (!getSession()) { clearInterval(window.__notifPoll); return; }
    refreshNotifications();
  }, 60000);
}

// ==========================================
// BOTTOM NAV (learner, mobile)
// ==========================================
function navHome() {
  renderWelcomeDashboard();
}

async function openGraduationNav() {
  if (!isGraduationEligible()) {
    showToast("Graduation opens once every milestone is passed.", "info");
    return;
  }
  openGraduation();
}


// ==========================================
// TRAINING BATCH TIMEFRAME
// ==========================================
function fmtBatchDate(ymd) {
  if (!ymd) return "—";
  const d = new Date(ymd + "T00:00:00");
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function batchStatus(b) {
  const DAY = 86400000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const s = new Date(b.start_date + "T00:00:00"), e = new Date(b.end_date + "T00:00:00");
  const totalDays = Math.round((e - s) / DAY) + 1;
  if (today < s) return { state: "upcoming", label: "Starts in " + Math.round((s - today) / DAY) + " day(s)", pct: 0, totalDays };
  if (today > e) return { state: "ended", label: "Batch ended", pct: 100, totalDays };
  const dayNum = Math.round((today - s) / DAY) + 1;
  const left = Math.round((e - today) / DAY);
  return { state: "active", label: "Day " + dayNum + " of " + totalDays + " · " + (left === 0 ? "last day" : left + " day(s) left"), pct: Math.min(100, Math.round((dayNum / totalDays) * 100)), totalDays };
}

// Learner home-screen banner
function batchBannerHtml() {
  const b = (typeof userBatch !== "undefined") ? userBatch : null;
  if (!b || !b.start_date || !b.end_date) return "";
  const st = batchStatus(b);
  return `
    <div class="batch-banner batch-banner--${st.state}">
      <div class="batch-banner-top">
        <div>
          <div class="batch-banner-kicker">Training Batch</div>
          <div class="batch-banner-name">${escHtml(b.name)}</div>
        </div>
        <span class="batch-banner-pill">${escHtml(st.label)}</span>
      </div>
      <div class="batch-banner-dates">🗓 ${escHtml(fmtBatchDate(b.start_date))} <span>→</span> ${escHtml(fmtBatchDate(b.end_date))}</div>
      <div class="batch-banner-bar"><div style="width:${st.pct}%"></div></div>
      ${b.note ? `<div class="batch-banner-note">${escHtml(b.note)}</div>` : ""}
    </div>`;
}

// Admin: load / render / save
let currentBatchAdmin = null;

async function loadBatchAdmin() {
  const res = await apiCall("getBatch", {});
  if (res.error) { showToast(res.error, "error"); return; }
  currentBatchAdmin = res;
  renderBatchAdmin();
}

function renderBatchAdmin() {
  const d = currentBatchAdmin || {};
  const b = d.batch;
  const status = document.getElementById("batch-status");
  if (b) {
    const st = batchStatus(b);
    document.getElementById("batch-name").value = b.name || "";
    document.getElementById("batch-start").value = b.start_date || "";
    document.getElementById("batch-end").value = b.end_date || "";
    document.getElementById("batch-note").value = b.note || "";
    if (status) status.textContent = "Active: " + b.name + " · " + fmtBatchDate(b.start_date) + " → " + fmtBatchDate(b.end_date) + " (" + st.label + ")";
  } else if (status) {
    status.textContent = "No batch set yet.";
  }
  renderBatchSections();
}

// Each previous batch becomes its own collapsible section with its learners.
function renderBatchSections() {
  const host = document.getElementById("batchHistory");
  if (!host) return;
  const gById = {};
  groupProgressByMember(allProgress).forEach(m => { gById[m.user_id] = m; });
  const prog = id => { const m = gById[id]; return m && m.total > 0 ? `${m.passed}/${m.total} passed (${m.rate}%)` : "Not started"; };
  const isDone = id => { const m = gById[id]; return !!(m && totalCurriculumMilestones > 0 && m.passed >= totalCurriculumMilestones); };

  const section = (id, title, sub, pill, members) => {
    const done = members.filter(u => isDone(u.user_id)).length;
    const list = members.length
      ? members.map(u => `
          <div class="batch-sec-row">
            <span class="batch-sec-name">${escHtml(u.full_name)}<small>@${escHtml(u.username || "")}</small></span>
            <span class="batch-sec-prog">${escHtml(prog(u.user_id))}</span>
          </div>`).join("")
      : `<p style="color:var(--text-dim);font-size:.82rem;padding:.5rem 0">No learners in this section.</p>`;
    return `
      <details class="batch-sec">
        <summary>
          <span class="batch-sec-title"><strong>${escHtml(title)}</strong><small>${escHtml(sub)}</small></span>
          <span class="batch-sec-meta">
            ${pill ? `<span class="batch-sec-pill">${escHtml(pill)}</span>` : ""}
            <span>${members.length} learner${members.length === 1 ? "" : "s"} · ${done} completed</span>
          </span>
        </summary>
        <div class="batch-sec-body">
          ${list}
          ${members.length ? `<button class="chip-btn chip-btn--steel" style="margin-top:.75rem" data-call="openBatchInProgress" data-batch_id="${escHtml(id || "__none")}">Open in Member Progress →</button>` : ""}
        </div>
      </details>`;
  };

  const previous = (adminBatches || []).filter(b => !b.is_active)
    .sort((x, y) => String(y.start_date).localeCompare(String(x.start_date)));
  let html = previous.map(b => section(
    b.batch_id, b.name, `${fmtBatchDate(b.start_date)} → ${fmtBatchDate(b.end_date)}`, "Closed",
    allUsers.filter(u => u.batch_id === b.batch_id))).join("");

  const known = new Set((adminBatches || []).map(b => b.batch_id));
  const loose = allUsers.filter(u => !u.batch_id || !known.has(u.batch_id));
  if (loose.length) html += section("", "No batch assigned", "Registered but not yet in any batch", "", loose);

  host.innerHTML = html || `<p style="color:var(--text-dim);font-size:.85rem">No previous batches yet. Once you open a new batch, the old one is kept here as its own section.</p>`;
}

// Jump to Member Progress already filtered to one batch.
function openBatchInProgress(args) {
  learnerBatchFilter = args.batch_id || "";
  populateBatchFilter();
  if (typeof renderLearnerCards === "function") renderLearnerCards();
  const navBtn = document.querySelector('.nav-item[data-view="learners"]');
  switchView({ view: "learners" }, navBtn);
}

async function saveBatch(mode) {
  mode = mode === "new" ? "new" : "update";
  const name = document.getElementById("batch-name").value.trim();
  const start_date = document.getElementById("batch-start").value;
  const end_date = document.getElementById("batch-end").value;
  const note = document.getElementById("batch-note").value.trim();
  const notify = document.getElementById("batch-notify").checked;
  const carry_over = document.getElementById("batch-carry").checked;
  if (!name) return showToast("Give the batch a name.", "error");
  if (!start_date || !end_date) return showToast("Pick both a start and an end date.", "error");
  if (end_date <= start_date) return showToast("The end date must be after the start date.", "error");
  const active = currentBatchAdmin && currentBatchAdmin.batch;
  if (mode === "new" && active && !confirm(
      `Open a NEW batch?\n\n"${active.name}" will be closed and its learners will be locked out` +
      (carry_over ? ", except that you chose to carry them over to the new batch." : " unless you move them into the new batch.") + "\n\nTo just fix details of the running batch, use \"Save changes\" instead.")) return;
  const btn = document.getElementById(mode === "new" ? "btn-new-batch" : "btn-save-batch");
  if (btn) setBtnLoading(btn, "Saving…");
  const res = await apiCall("setBatch", { name, start_date, end_date, note, notify, carry_over, mode });
  if (btn) resetBtn(btn);
  if (res.success) {
    showToast(res.message || "Batch saved.", "success");
    await loadBatchAdmin();
    if (typeof loadAdminDashboard === "function") loadAdminDashboard();
  } else showToast(res.error || "Error", "error");
}

// Learner: full-screen lock shown when the server reports the batch gate is closed.
function showLockOverlay(lock) {
  lock = lock || {};
  let ov = document.getElementById("lockOverlay");
  if (!ov) { ov = document.createElement("div"); ov.id = "lockOverlay"; ov.className = "lock-overlay"; document.body.appendChild(ov); }
  const b = lock.batch;
  ov.innerHTML = `
    <div class="lock-card">
      <div class="lock-icon">🔒</div>
      <h2>${escHtml(lock.title || "Portal closed")}</h2>
      <p>${escHtml(lock.message || "")}</p>
      ${b ? `<div class="lock-batch"><strong>${escHtml(b.name)}</strong><span>${escHtml(fmtBatchDate(b.start_date))} → ${escHtml(fmtBatchDate(b.end_date))}</span></div>` : ""}
      <div class="lock-actions">
        <button class="btn-action btn-primary" onclick="location.reload()">Check again</button>
        <button class="btn-action btn-secondary" onclick="logout()">Sign out</button>
      </div>
    </div>`;
  if (typeof hidePageLoader === "function") hidePageLoader();
}