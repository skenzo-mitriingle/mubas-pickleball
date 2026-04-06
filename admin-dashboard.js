import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import { auth, db } from "./firebase-config.js";

const sectionOrder = ["announcements", "gallery", "videos", "fixtures"];

const collectionsBySection = {
  announcements: "announcements",
  gallery: "galleryItems",
  videos: "videoItems",
  fixtures: "fixtureItems"
};

const dashboardSections = {
  announcements: {
    kicker: "Current Section",
    title: "Announcements",
    actionHref: "manage-announcements.html"
  },
  gallery: {
    kicker: "Current Section",
    title: "Gallery",
    actionHref: "manage-gallery.html"
  },
  videos: {
    kicker: "Current Section",
    title: "Videos",
    actionHref: "manage-videos.html"
  },
  fixtures: {
    kicker: "Current Section",
    title: "Fixtures",
    actionHref: "manage-fixtures.html"
  }
};

const body = document.body;
const navButtons = Array.from(document.querySelectorAll(".sidebar-link"));
const adminIdentity = document.getElementById("admin-identity");
const sessionState = document.getElementById("session-state");
const summarySessionState = document.getElementById("summary-session-state");
const dashboardDate = document.getElementById("dashboard-date");
const dashboardTime = document.getElementById("dashboard-time");
const focusKicker = document.getElementById("focus-kicker");
const focusTitle = document.getElementById("focus-title");
const meterRing = document.getElementById("meter-ring");
const meterValue = document.getElementById("meter-value");
const meterLabel = document.getElementById("meter-label");

const countElements = {
  announcements: document.getElementById("count-announcements"),
  gallery: document.getElementById("count-gallery"),
  videos: document.getElementById("count-videos"),
  fixtures: document.getElementById("count-fixtures")
};

let activeSection = sectionOrder[0];
let hasLoadedCounts = false;

function setSessionSummary(label) {
  if (summarySessionState) {
    summarySessionState.textContent = label;
  }
}

function formatDashboardTime() {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());
}

function formatDashboardDate() {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date());
}

function renderDashboardClock() {
  if (dashboardTime) {
    dashboardTime.textContent = formatDashboardTime();
  }

  if (dashboardDate) {
    dashboardDate.textContent = formatDashboardDate();
  }
}

function renderMeter(sectionKey) {
  const sectionIndex = sectionOrder.indexOf(sectionKey);
  const totalSections = sectionOrder.length;
  const progress = Math.round(((sectionIndex + 1) / totalSections) * 100);

  if (meterRing) {
    meterRing.style.setProperty("--progress", progress);
  }

  if (meterValue) {
    meterValue.textContent = `${progress}%`;
  }

  if (meterLabel) {
    meterLabel.textContent = `${sectionIndex + 1} of ${totalSections}`;
  }
}

function setActiveSection(sectionKey) {
  const section = dashboardSections[sectionKey];

  if (!section) return;

  activeSection = sectionKey;

  navButtons.forEach((button) => {
    const isActiveButton = button.dataset.section === sectionKey;

    button.classList.toggle("is-active", isActiveButton);

    if (button.dataset.section !== "logout") {
      button.setAttribute("aria-pressed", String(isActiveButton));
    }
  });

  if (focusKicker) focusKicker.textContent = section.kicker;
  if (focusTitle) focusTitle.textContent = section.title;
  renderMeter(sectionKey);
}

function setCountValue(sectionKey, value) {
  const element = countElements[sectionKey];

  if (!element) return;

  element.textContent = String(value);
}

async function loadDashboardCounts() {
  if (hasLoadedCounts) return;

  hasLoadedCounts = true;

  const countPromises = sectionOrder.map(async (sectionKey) => {
    try {
      const snapshot = await getDocs(collection(db, collectionsBySection[sectionKey]));
      setCountValue(sectionKey, snapshot.size);
    } catch (error) {
      setCountValue(sectionKey, "--");
      console.error(`Could not load ${sectionKey} count.`, error);
    }
  });

  await Promise.all(countPromises);
}

async function handleLogout() {
  if (sessionState) {
    sessionState.textContent = "Signing out...";
  }

  setSessionSummary("Signing out...");

  try {
    await signOut(auth);
    window.location.href = "admin-login.html";
  } catch (error) {
    if (sessionState) {
      sessionState.textContent = "Signed in";
    }

    setSessionSummary("Signed in");
    console.error(error);
  }
}

function openSection(sectionKey) {
  const section = dashboardSections[sectionKey];

  if (!section?.actionHref) return;

  window.location.href = section.actionHref;
}

navButtons.forEach((button) => {
  const sectionKey = button.dataset.section;

  if (sectionKey === "logout") {
    button.addEventListener("click", () => {
      handleLogout();
    });

    return;
  }

  button.addEventListener("mouseenter", () => {
    setActiveSection(sectionKey);
  });

  button.addEventListener("focus", () => {
    setActiveSection(sectionKey);
  });

  button.addEventListener("click", () => {
    setActiveSection(sectionKey);
    openSection(sectionKey);
  });
});

renderDashboardClock();
window.setInterval(renderDashboardClock, 60000);
setSessionSummary("Checking...");
setActiveSection(activeSection);

onAuthStateChanged(
  auth,
  async (user) => {
    if (!user) {
      body.dataset.authState = "guest";

      if (adminIdentity) {
        adminIdentity.textContent = "No active admin session";
      }

      if (sessionState) {
        sessionState.textContent = "Redirecting...";
      }

      setSessionSummary("Redirecting...");

      window.setTimeout(() => {
        window.location.href = "admin-login.html";
      }, 700);

      return;
    }

    body.dataset.authState = "ready";

    if (adminIdentity) {
      adminIdentity.textContent = user.email || "Authenticated admin";
    }

    if (sessionState) {
      sessionState.textContent = "Signed in";
    }

    setSessionSummary("Signed in");
    setActiveSection(activeSection);
    await loadDashboardCounts();
  },
  (error) => {
    body.dataset.authState = "guest";

    if (adminIdentity) {
      adminIdentity.textContent = "Authentication error";
    }

    if (sessionState) {
      sessionState.textContent = "Access error";
    }

    setSessionSummary("Access error");
    console.error(error);

    window.setTimeout(() => {
      window.location.href = "admin-login.html";
    }, 900);
  }
);
