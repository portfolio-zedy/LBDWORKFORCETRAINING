// ============================================================
//  LIVING BY DESIGN NATION — Google Apps Script Backend
// ============================================================

const SHEET_USERS       = "Users";
const SHEET_COURSES     = "Courses";
const SHEET_MILESTONES  = "Milestones";
const SHEET_PROGRESS    = "Progress";
const SHEET_SUBMISSIONS = "Submissions";

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  function ensure(name, headers) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.appendRow(headers);
      sh.setFrozenRows(1);
    }
    return sh;
  }

  ensure(SHEET_USERS, [
    "user_id","username","password_hash","full_name","email",
    "role","enrolled_courses","tribe_id","hub_id","colony",
    "phone","start_date","created_at","is_active"
  ]);

  ensure(SHEET_COURSES, ["course_id","title","description","teacher_id","created_at","is_active"]);
  ensure(SHEET_MILESTONES, ["milestone_id","course_id","order_index","title","description","content_html","video_url","submission_type","quiz_json","pass_score","created_at","is_active"]);
  ensure(SHEET_PROGRESS, ["progress_id","user_id","course_id","milestone_id","status","score","approved_by","approved_at","enrolled_at"]);
  ensure(SHEET_SUBMISSIONS, ["sub_id","user_id","milestone_id","course_id","submission_type","content","score","submitted_at","reviewed_at","reviewer_id"]);

  return "Setup complete";
}

function migrateAddVideoUrlColumn() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MILESTONES);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf("video_url") !== -1) return "video_url column already exists — nothing to do.";

  const contentIdx = headers.indexOf("content_html"); 
  const insertAt = contentIdx === -1 ? headers.length : contentIdx + 1; 
  sh.insertColumnAfter(insertAt); 
  sh.getRange(1, insertAt + 1).setValue("video_url");
  return "video_url column added.";
}

function enrollUser_(userId, courseId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mSheet = ss.getSheetByName(SHEET_MILESTONES);
  const pSheet = ss.getSheetByName(SHEET_PROGRESS);
  const milestones = getRows_(mSheet).filter(r => r.course_id === courseId && r.is_active === "TRUE").sort((a,b) => parseInt(a.order_index)-parseInt(b.order_index));
  const existing = getRows_(pSheet).filter(r => r.user_id === userId && r.course_id === courseId);
  if (existing.length > 0) return;

  milestones.forEach((m, i) => {
    pSheet.appendRow([Utilities.getUuid(), userId, courseId, m.milestone_id, i === 0 ? "UNLOCKED" : "LOCKED", "", "", "", new Date().toISOString()]);
  });
}

function enrollUserAndRecord_(userId, courseId) {
  enrollUser_(userId, courseId);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const rows = sh.getDataRange().getValues();
  const headers = rows[0];
  const uidIdx = headers.indexOf("user_id");
  const ecIdx  = headers.indexOf("enrolled_courses");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][uidIdx] === userId) {
      const current = String(rows[i][ecIdx] || "").split(",").map(s => s.trim()).filter(Boolean);
      if (!current.includes(courseId)) {
        current.push(courseId);
        sh.getRange(i + 1, ecIdx + 1).setValue(current.join(","));
      }
      return;
    }
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({status:"ok",message:"API running"})).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;

    switch(action) {
      case "login":             result = handleLogin(body); break;
      case "signup":            result = handleSignup(body); break;
      case "signupFacilitator": result = handleSignupFacilitator(body); break;
      case "getCourses":        result = handleGetCourses(body); break;
      case "getLearnerDashboard": result = handleGetLearnerDashboard(body); break;
      case "getMilestones":     result = handleGetMilestones(body); break;
      case "getProgress":       result = handleGetProgress(body); break;
      case "submitCheckbox":    result = handleCheckboxSubmit(body); break;
      case "submitQuiz":        result = handleQuizSubmit(body); break;
      case "submitWritten":     result = handleWrittenSubmit(body); break;
      case "approveMilestone":  result = handleApprove(body); break;
      case "rejectMilestone":   result = handleReject(body); break;
      case "getAllProgress":    result = handleGetAllProgress(body); break;
      case "getPendingReviews": result = handleGetPendingReviews(body); break;
      case "createUser":        result = handleCreateUser(body); break;
      case "getUsers":          result = handleGetUsers(body); break;
      case "getPendingFacilitators": result = handleGetPendingFacilitators(body); break;
      case "approveFacilitator":     result = handleApproveFacilitator(body); break;
      case "getActiveTeachers":      result = handleGetActiveTeachers(body); break;
      case "promoteToAdmin":         result = handlePromoteToAdmin(body); break;
      case "createCourse":      result = handleCreateCourse(body); break;
      case "createMilestone":   result = handleCreateMilestone(body); break;
      case "assignCourse":      result = handleAssignCourse(body); break;
      default: result = {error: "Unknown action: " + action};
    }

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({error: err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

// ── AUTH & REGISTRATION ──
function handleLogin({username, email, password_hash}) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const users = getRows_(sh);

  const user = users.find(u => {
    const matchEmail = email ? (u.email === email) : false;
    const matchUser = username ? (u.username === username) : false;
    return (matchEmail || matchUser) && (u.password_hash === password_hash);
  });

  if (!user) return {success: false, error: "Invalid credentials (email/username or password incorrect)"};

  const isActive = String(user.is_active || "").trim().toUpperCase();

  if (user.role === "TEACHER" && isActive !== "TRUE") {
    return {success: false, error: "Account pending approval. Please wait for activation."};
  }
  if (isActive === "FALSE") {
    return {success: false, error: "Account pending approval. Please wait for activation."};
  }

  return {
    success: true,
    user: { user_id: user.user_id, username: user.username, full_name: user.full_name, email: user.email, role: user.role, enrolled_courses: user.enrolled_courses }
  };
}

function handleSignup({fname, lname, username, email, password_hash, tribe_id, hub_id, colony, phone, start_date}) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (getRows_(sh).find(r => r.email === email)) return {error: "Email is already registered."};
  if (username && getRows_(sh).find(r => r.username === username)) return {error: "Username is already taken."};

  const uid = "usr_" + Utilities.getUuid().replace(/-/g,"").substring(0,8);
  const full_name = fname.trim() + " " + lname.trim();

  // "user_id","username","password_hash","full_name","email", "role" ...
  sh.appendRow([uid, username, password_hash, full_name, email, "LEARNER", "", tribe_id, hub_id, colony, phone, start_date, new Date().toISOString(), "TRUE"]);

  if (colony) {
    const courses = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_COURSES))
      .filter(c => c.is_active === "TRUE");
    const match = courses.find(c => c.title.trim().toUpperCase() === String(colony).trim().toUpperCase());
    if (match) enrollUserAndRecord_(uid, match.course_id);
  }

  return {success: true, message: "Account created successfully!"};
}

function handleSignupFacilitator({name, username, email, password_hash, created_at}) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (getRows_(sh).find(r => r.email === email)) return {error: "Email is already registered."};
  if (username && getRows_(sh).find(r => r.username === username)) return {error: "Username is already taken."};

  const uid = "fac_" + Utilities.getUuid().replace(/-/g,"").substring(0,8);
  // "user_id","username","password_hash","full_name","email", "role" ...
  sh.appendRow([uid, username, password_hash, name, email, "TEACHER", "", "", "", "", "", "", created_at, "FALSE"]);
  return {success: true, message: "Account created successfully! Awaiting activation."};
}

// ── ALL OTHER HANDLERS ──
function handleGetCourses({user_id, role}) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_COURSES);
  const rows = getRows_(sh).filter(r => r.is_active === "TRUE");
  if (role === "LEARNER") {
    const user = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS)).find(u => u.user_id === user_id);
    const enrolled = user ? (user.enrolled_courses || "").split(",").map(s=>s.trim()).filter(Boolean) : [];
    return {courses: rows.filter(c => enrolled.includes(c.course_id))};
  }
  return {courses: rows};
}

function handleGetMilestones({course_id}) {
  const rows = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MILESTONES)).filter(r => r.course_id === course_id && r.is_active === "TRUE").sort((a,b) => parseInt(a.order_index)-parseInt(b.order_index));
  return {milestones: rows.map(r => ({...r, quiz_json: r.quiz_json ? r.quiz_json : "", video_url: r.video_url ? r.video_url : ""}))};
}

function handleGetProgress({user_id, course_id}) {
  return {progress: getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PROGRESS)).filter(r => r.user_id === user_id && r.course_id === course_id)};
}

function handleGetAllProgress({course_id, requester_role}) {
  if (!["TEACHER","ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  
  // Filter active learners from users table to prevent ghost-users from showing up on the UI
  const users = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS))
                  .filter(u => String(u.is_active).trim().toUpperCase() === "TRUE" && String(u.role).trim().toUpperCase() === "LEARNER");
  const validUserIds = new Set(users.map(u => u.user_id));
  
  const milestones = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MILESTONES));
  const courses    = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_COURSES));
  const progress   = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PROGRESS))
                      .filter(r => (!course_id || r.course_id === course_id) && validUserIds.has(r.user_id));

  return {
    progress: progress.map(p => {
      const u = users.find(u => u.user_id === p.user_id);
      const m = milestones.find(m => m.milestone_id === p.milestone_id);
      const c = courses.find(c => c.course_id === p.course_id);
      return {
        ...p,
        full_name: u ? u.full_name : p.user_id,
        username: u ? u.username : "",
        milestone_title: m ? m.title : p.milestone_id,
        order_index: m ? parseInt(m.order_index) : 0,
        course_title: c ? c.title : p.course_id
      };
    })
  };
}

function handleGetPendingReviews({requester_role}) {
  if (!["TEACHER","ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  
  // Clean ghost-users 
  const users = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS))
                  .filter(u => String(u.is_active).trim().toUpperCase() === "TRUE" && String(u.role).trim().toUpperCase() === "LEARNER");
  const validUserIds = new Set(users.map(u => u.user_id));
  
  const milestones = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MILESTONES));
  const pending = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SUBMISSIONS))
    .filter(r => r.submission_type === "WRITTEN" && !r.reviewed_at && validUserIds.has(r.user_id))
    .map(r => {
      const u = users.find(u => u.user_id === r.user_id);
      const m = milestones.find(m => m.milestone_id === r.milestone_id);
      return {...r, full_name: u?u.full_name:"", milestone_title: m?m.title:""};
    });
  return {pending};
}

function handleCheckboxSubmit({user_id, milestone_id, course_id}) {
  setProgressStatus_(user_id, milestone_id, course_id, "PASSED", 100, "SYSTEM");
  unlockNext_(user_id, course_id, milestone_id);
  return {success: true, status: "PASSED"};
}

function handleQuizSubmit({user_id, milestone_id, course_id, answers}) {
  const milestone = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MILESTONES)).find(r => r.milestone_id === milestone_id);
  if (!milestone) return {error: "Milestone not found"};
  const quiz = JSON.parse(milestone.quiz_json);
  const passScore = parseInt(milestone.pass_score) || 70;
  let correct = 0;
  quiz.questions.forEach(q => { if (parseInt(answers[q.id]) === parseInt(q.correct)) correct++; });
  const score = Math.round((correct / quiz.questions.length) * 100);
  const passed = score >= passScore;
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SUBMISSIONS).appendRow([Utilities.getUuid(), user_id, milestone_id, course_id, "QUIZ", JSON.stringify(answers), score, new Date().toISOString(), new Date().toISOString(), "SYSTEM"]);
  setProgressStatus_(user_id, milestone_id, course_id, passed ? "PASSED" : "FAILED", score, "SYSTEM");
  if (passed) unlockNext_(user_id, course_id, milestone_id);
  return {success: true, status: passed ? "PASSED" : "FAILED", score, passed, passScore, correct, total: quiz.questions.length};
}

function handleWrittenSubmit({user_id, milestone_id, course_id, content}) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SUBMISSIONS).appendRow([Utilities.getUuid(), user_id, milestone_id, course_id, "WRITTEN", content, "", new Date().toISOString(), "", ""]);
  setProgressStatus_(user_id, milestone_id, course_id, "SUBMITTED", "", "");
  return {success: true, status: "SUBMITTED", message: "Response submitted."};
}

function handleApprove({user_id, milestone_id, course_id, reviewer_id, requester_role}) {
  if (!["TEACHER","ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  const subSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SUBMISSIONS);
  const subs = getRows_(subSh);
  const subIdx = subs.findIndex(r => r.user_id===user_id && r.milestone_id===milestone_id && !r.reviewed_at);
  if (subIdx >= 0) {
    subSh.getRange(subIdx+2, 9).setValue(new Date().toISOString());
    subSh.getRange(subIdx+2, 10).setValue(reviewer_id);
  }
  setProgressStatus_(user_id, milestone_id, course_id, "PASSED", 100, reviewer_id);
  unlockNext_(user_id, course_id, milestone_id);
  return {success: true, message: "Milestone approved."};
}

function handleReject({user_id, milestone_id, course_id, reviewer_id, requester_role}) {
  if (!["TEACHER","ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  setProgressStatus_(user_id, milestone_id, course_id, "FAILED", 0, reviewer_id);
  return {success: true, message: "Milestone rejected."};
}

function handleCreateUser({full_name,username,password_hash,email,role,course_id,requester_role}) {
  if (!["ADMIN"].includes(requester_role)) return {error:"Only admins can create users"};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (getRows_(sh).find(r => r.email === email)) return {error: "Email already exists"};
  if (username && getRows_(sh).find(r => r.username === username)) return {error: "Username already exists"};
  const uid = "usr_" + Utilities.getUuid().replace(/-/g,"").substring(0,8);
  sh.appendRow([uid,username,password_hash,full_name,email,role,course_id||"", "", "", "", "", "", new Date().toISOString(),"TRUE"]);
  if (role === "LEARNER" && course_id) enrollUser_(uid, course_id);
  return {success: true, user_id: uid};
}

function handleGetUsers({requester_role}) {
  if (!["TEACHER","ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const users = getRows_(sh)
    .filter(r => String(r.is_active).trim().toUpperCase() === "TRUE" && String(r.role).trim().toUpperCase() === "LEARNER")
    .map(({user_id, username, full_name, email, phone, enrolled_courses}) => ({user_id, username, full_name, email, phone, enrolled_courses}));
  return {users};
}

function handleGetPendingFacilitators({requester_role}) {
  if (!["ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  return {
    pending: getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS))
      .filter(r => r.role === "TEACHER" && String(r.is_active).toUpperCase() !== "TRUE")
      .map(({user_id, username, full_name, created_at}) => ({user_id, username, full_name, created_at}))
  };
}

function handleApproveFacilitator({user_id, requester_role}) {
  if (!["ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const rows = sh.getDataRange().getValues();
  const headers = rows[0];
  const uidIdx = headers.indexOf("user_id"), activeIdx = headers.indexOf("is_active");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][uidIdx] === user_id) {
      sh.getRange(i + 1, activeIdx + 1).setValue("TRUE");
      return {success: true, message: "Facilitator approved."};
    }
  }
  return {error: "User not found"};
}

function handleGetActiveTeachers({requester_role}) {
  if (!["ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  return {
    teachers: getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS))
      .filter(r => r.role === "TEACHER" && String(r.is_active).toUpperCase() === "TRUE")
      .map(({user_id, username, full_name, created_at}) => ({user_id, username, full_name, created_at}))
  };
}

function handlePromoteToAdmin({user_id, requester_role}) {
  if (!["ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  const rows = sh.getDataRange().getValues();
  const headers = rows[0];
  const uidIdx = headers.indexOf("user_id"), roleIdx = headers.indexOf("role");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][uidIdx] === user_id) {
      if (rows[i][roleIdx] !== "TEACHER") return {error: "Only active facilitators (TEACHER role) can be promoted."};
      sh.getRange(i + 1, roleIdx + 1).setValue("ADMIN");
      return {success: true, message: "Promoted to Admin."};
    }
  }
  return {error: "User not found"};
}

function setProgressStatus_(user_id, milestone_id, course_id, status, score, approved_by) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PROGRESS);
  const rows = sh.getDataRange().getValues();
  const headers = rows[0];
  const uidIdx = headers.indexOf("user_id"), msIdx = headers.indexOf("milestone_id"), statIdx = headers.indexOf("status"), scoreIdx = headers.indexOf("score"), apprIdx = headers.indexOf("approved_by"), apprAtIdx= headers.indexOf("approved_at");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][uidIdx] === user_id && rows[i][msIdx] === milestone_id) {
      sh.getRange(i+1, statIdx+1).setValue(status);
      if (score !== "") sh.getRange(i+1, scoreIdx+1).setValue(score);
      if (approved_by) sh.getRange(i+1, apprIdx+1).setValue(approved_by);
      if (["PASSED","FAILED"].includes(status)) sh.getRange(i+1, apprAtIdx+1).setValue(new Date().toISOString());
      return;
    }
  }
}

function unlockNext_(user_id, course_id, current_milestone_id) {
  const pSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PROGRESS);
  const milestones = getRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MILESTONES)).filter(r => r.course_id === course_id && r.is_active === "TRUE").sort((a,b) => parseInt(a.order_index)-parseInt(b.order_index));
  const currentIdx = milestones.findIndex(m => m.milestone_id === current_milestone_id);
  if (currentIdx === -1 || currentIdx >= milestones.length - 1) return;
  const next = milestones[currentIdx + 1];
  const rows = pSh.getDataRange().getValues(), headers = rows[0], uidIdx = headers.indexOf("user_id"), msIdx = headers.indexOf("milestone_id"), statIdx= headers.indexOf("status");
  let found = false;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][uidIdx] === user_id && rows[i][msIdx] === next.milestone_id) {
      if (rows[i][statIdx] === "LOCKED") pSh.getRange(i+1, statIdx+1).setValue("UNLOCKED");
      found = true;
      break;
    }
  }
  // If milestone was added late and user row is missing, dynamically generate it.
  if (!found) {
    pSh.appendRow([Utilities.getUuid(), user_id, course_id, next.milestone_id, "UNLOCKED", "", "", "", new Date().toISOString()]);
  }
}

function handleGetLearnerDashboard({user_id}) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const courses = getRows_(ss.getSheetByName(SHEET_COURSES)).filter(c => c.is_active === "TRUE");
  const milestones = getRows_(ss.getSheetByName(SHEET_MILESTONES)).filter(m => m.is_active === "TRUE");
  const progress = getRows_(ss.getSheetByName(SHEET_PROGRESS)).filter(p => p.user_id === user_id);

  let isNextUnlocked = true; 
  
  const roadmap = courses.map((c) => {
    const courseMilestones = milestones.filter(m => m.course_id === c.course_id);
    const courseProgress = progress.filter(p => p.course_id === c.course_id);
    
    const total = courseMilestones.length;
    const passed = courseProgress.filter(p => p.status === "PASSED").length;
    const pct = total === 0 ? 0 : Math.round((passed / total) * 100);
    
    const unlocked = isNextUnlocked;
    
    if (unlocked && courseProgress.length === 0 && total > 0) {
       enrollUser_(user_id, c.course_id);
    }
    if (total === 0 || passed < total) {
      isNextUnlocked = false; 
    }
    
    return {
       course_id: c.course_id,
       title: c.title,
       description: c.description,
       total_milestones: total,
       passed_milestones: passed,
       progress_pct: pct,
       is_unlocked: unlocked
    };
  });
  return { success: true, roadmap: roadmap };
}

function getRows_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];

  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      if (typeof val === "boolean") val = val ? "TRUE" : "FALSE";
      obj[h] = String(val !== undefined && val !== null ? val : "");
    });
    return obj;
  });
}

function doOptions(e) { return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT); }

function runCreateAdmin() {
  const result = createAdminAccount( "ZEDY", "NOTORE", "MASTER LIFE", "admin@livingbydesign.nation" );
  Logger.log(result);
}

function createAdminAccount(username, plainPassword, fullName, email) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  if (getRows_(sh).find(r => r.username === username)) return "Username already taken.";
  const password_hash = sha256Hex_(plainPassword);
  const uid = "adm_" + Utilities.getUuid().replace(/-/g,"").substring(0,8);
  sh.appendRow([uid, username, password_hash, fullName, email || "", "ADMIN", "", "", "", "", "", "", new Date().toISOString(), "TRUE"]);
  return "Admin account created: " + username;
}

function sha256Hex_(input) {
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  return rawHash.map(b => {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

function handleCreateCourse({title, description, teacher_id, requester_role}) {
  if (!["TEACHER","ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_COURSES);
  const cid = "crs_" + Utilities.getUuid().replace(/-/g,"").substring(0,8);
  sh.appendRow([cid, title, description, teacher_id, new Date().toISOString(), "TRUE"]);
  return {success: true, course_id: cid};
}

function handleCreateMilestone({course_id, title, description, content_html, video_url, submission_type, pass_score, quiz_json, requester_role}) {
  if (!["TEACHER","ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MILESTONES);
  const mid = "ms_" + Utilities.getUuid().replace(/-/g,"").substring(0,8);
  const existing = getRows_(sh).filter(r => r.course_id === course_id);
  const order = existing.length + 1;
  sh.appendRow([mid, course_id, order, title, description, content_html, video_url || "", submission_type, quiz_json || "", pass_score || "", new Date().toISOString(), "TRUE"]);
  return {success: true, milestone_id: mid};
}

function handleAssignCourse({target_user_id, course_id, requester_role}) {
  if (!["TEACHER","ADMIN"].includes(requester_role)) return {error:"Unauthorized"};
  enrollUserAndRecord_(target_user_id, course_id);
  return {success: true, message: "Course assigned successfully."};
}
