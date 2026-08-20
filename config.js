// ============================================================
//  WORKFORCE TRAINING PLATFORM — Shared Config & Utilities
//  Include this file in every HTML page via <script src="config.js">
// ============================================================

// ── !! PASTE YOUR GAS DEPLOYMENT URL HERE !! ──────────────────
const API_URL = "https://script.google.com/macros/s/AKfycby_9iOJuOAmTlRh_MdKFvYraBIEoyu7TydALdsNTJo-MXBjhndrt1cxbLMg1Eo8qSetcg/exec";
// Get this from: GAS Editor → Deploy → Manage Deployments → Copy Web App URL

// ── SHA-256 hashing (Web Crypto API) ─────────────────────────
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── API helper ────────────────────────────────────────────────
async function apiCall(action, payload = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain" }, // GAS requires text/plain for CORS
    body: JSON.stringify({ action, ...payload })
  });
  return await res.json();
}

// ── Session ───────────────────────────────────────────────────
function getSession() {
  try { return JSON.parse(sessionStorage.getItem("wtp_user")); } catch { return null; }
}
function setSession(user) {
  sessionStorage.setItem("wtp_user", JSON.stringify(user));
}
function clearSession() {
  sessionStorage.removeItem("wtp_user");
}
function requireAuth(allowedRoles) {
  const user = getSession();
  if (!user) { window.location.href = "index.html"; return null; }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    alert("Access denied.");
    window.location.href = "index.html";
    return null;
  }
  return user;
}

// ── Toast notifications ───────────────────────────────────────
function showToast(message, type = "info") {
  const existing = document.querySelector(".wtp-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `wtp-toast wtp-toast--${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("wtp-toast--visible"), 10);
  setTimeout(() => {
    toast.classList.remove("wtp-toast--visible");
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ── Status badge helper ───────────────────────────────────────
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

// ── Date formatter ────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {day:"2-digit",month:"short",year:"numeric"});
}
