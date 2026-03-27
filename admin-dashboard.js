import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebase-config.js";

const dashboardSections = {
  announcements: {
    kicker: "Selected Section",
    title: "Announcements",
    description: "Publish the latest club notices, reminders, and updates.",
    tags: ["Notices", "Deadlines", "Club Alerts"],
    detailTitle: "Announcements workspace",
    detailCopy: "Use this area to keep players and members informed with short, clear, timely communication.",
    checklist: [
      "Post urgent news first so visitors see the most important message immediately.",
      "Add dates, deadlines, or venue changes so every announcement is actionable.",
      "Keep the tone brief and direct for easy reading on phones and desktop."
    ],
    feedback: "Announcements selected. Open the manager page to create, edit, or delete Firestore announcements.",
    actionLabel: "Open announcements manager",
    actionHref: "manage-announcements.html"
  },
  gallery: {
    kicker: "Selected Section",
    title: "Gallery",
    description: "Prepare photo updates, featured images, and moments from the court.",
    tags: ["Photos", "Captions", "Highlights"],
    detailTitle: "Gallery workspace",
    detailCopy: "Use the gallery area to organize the visual story of training sessions, tournaments, and community moments.",
    checklist: [
      "Choose strong cover images that show action, energy, and team spirit.",
      "Write short captions that explain the event, match, or special moment.",
      "Keep the newest and clearest photos near the top for fresh presentation."
    ],
    feedback: "Gallery selected. Open the manager page to upload images to Firebase Storage and manage Firestore gallery items.",
    actionLabel: "Open gallery manager",
    actionHref: "manage-gallery.html"
  },
  videos: {
    kicker: "Selected Section",
    title: "Videos",
    description: "Organize highlights, training clips, and match recap video content.",
    tags: ["Highlights", "Recaps", "Training Clips"],
    detailTitle: "Videos workspace",
    detailCopy: "Use this area to manage playable highlights and keep video content organized around the club's biggest moments.",
    checklist: [
      "Feature the most recent or most exciting clip first to set the tone.",
      "Add short descriptions so visitors know what they are about to watch.",
      "Keep titles consistent so highlights, recaps, and training clips feel organized."
    ],
    feedback: "Videos selected. Open the manager page to create, edit, or delete Firestore video items.",
    actionLabel: "Open videos manager",
    actionHref: "manage-videos.html"
  },
  fixtures: {
    kicker: "Selected Section",
    title: "Fixtures",
    description: "Track upcoming matches, opponents, dates, venues, and results.",
    tags: ["Matches", "Schedules", "Results"],
    detailTitle: "Fixtures workspace",
    detailCopy: "Use the fixtures panel to keep the calendar accurate and make sure supporters can follow upcoming games and final scores.",
    checklist: [
      "Include the opponent, match date, and venue for every upcoming fixture.",
      "Update results quickly after each match so the page stays reliable.",
      "Keep formatting consistent so visitors can scan schedules at a glance."
    ],
    feedback: "Fixtures selected. Open the manager page to create, edit, delete, and mark fixtures as upcoming or completed.",
    actionLabel: "Open fixtures manager",
    actionHref: "manage-fixtures.html"
  }
};

const body = document.body;
const cards = Array.from(document.querySelectorAll(".dashboard-card"));
const adminIdentity = document.getElementById("admin-identity");
const sessionState = document.getElementById("session-state");
const dashboardDate = document.getElementById("dashboard-date");
const focusKicker = document.getElementById("focus-kicker");
const focusTitle = document.getElementById("focus-title");
const focusDescription = document.getElementById("focus-description");
const focusTags = document.getElementById("focus-tags");
const focusAction = document.getElementById("focus-action");
const detailTitle = document.getElementById("detail-title");
const detailCopy = document.getElementById("detail-copy");
const detailList = document.getElementById("detail-list");
const actionFeedback = document.getElementById("action-feedback");

let activeSection = "announcements";

function setFeedback(message, state = "") {
  if (!actionFeedback) return;

  actionFeedback.textContent = message;

  if (state) {
    actionFeedback.dataset.state = state;
  } else {
    delete actionFeedback.dataset.state;
  }
}

function formatDashboardDate() {
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  return formatter.format(new Date());
}

function renderDashboardDate() {
  if (!dashboardDate) return;
  dashboardDate.textContent = formatDashboardDate();
}

function renderTags(tags) {
  if (!focusTags) return;

  focusTags.replaceChildren();

  tags.forEach((tag) => {
    const pill = document.createElement("span");
    pill.className = "focus-tag";
    pill.textContent = tag;
    focusTags.appendChild(pill);
  });
}

function renderChecklist(items) {
  if (!detailList) return;

  detailList.replaceChildren();

  items.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.textContent = item;
    detailList.appendChild(listItem);
  });
}

function setActiveSection(sectionKey) {
  const section = dashboardSections[sectionKey];

  if (!section) return;

  activeSection = sectionKey;

  cards.forEach((card) => {
    const isActiveCard = card.dataset.section === sectionKey;
    card.classList.toggle("is-active", isActiveCard);

    if (card.dataset.section !== "logout") {
      card.setAttribute("aria-pressed", String(isActiveCard));
    }
  });

  if (focusKicker) focusKicker.textContent = section.kicker;
  if (focusTitle) focusTitle.textContent = section.title;
  if (focusDescription) focusDescription.textContent = section.description;
  if (detailTitle) detailTitle.textContent = section.detailTitle;
  if (detailCopy) detailCopy.textContent = section.detailCopy;

  if (focusAction) {
    const hasAction = Boolean(section.actionHref && section.actionLabel);
    focusAction.hidden = !hasAction;

    if (hasAction) {
      focusAction.href = section.actionHref;
      focusAction.textContent = section.actionLabel;
    }
  }

  renderTags(section.tags);
  renderChecklist(section.checklist);
  setFeedback(section.feedback, "info");
}

async function handleLogout() {
  setFeedback("Signing out of the admin dashboard...", "info");

  if (sessionState) {
    sessionState.textContent = "Signing out...";
  }

  try {
    await signOut(auth);
    window.location.href = "admin-login.html";
  } catch (error) {
    if (sessionState) {
      sessionState.textContent = "Signed in";
    }

    setFeedback("Sign out failed. Please try again.", "error");
    console.error(error);
  }
}

cards.forEach((card) => {
  card.addEventListener("click", () => {
    const sectionKey = card.dataset.section;

    if (sectionKey === "logout") {
      handleLogout();
      return;
    }

    setActiveSection(sectionKey);
  });
});

renderDashboardDate();
window.setInterval(renderDashboardDate, 60000);
setActiveSection(activeSection);

onAuthStateChanged(
  auth,
  (user) => {
    if (!user) {
      body.dataset.authState = "guest";

      if (adminIdentity) {
        adminIdentity.textContent = "No active admin session";
      }

      if (sessionState) {
        sessionState.textContent = "Redirecting...";
      }

      setFeedback("Admin access is required. Redirecting to the login page...", "error");

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

    setActiveSection(activeSection);
  },
  (error) => {
    body.dataset.authState = "guest";

    if (adminIdentity) {
      adminIdentity.textContent = "Authentication error";
    }

    if (sessionState) {
      sessionState.textContent = "Access error";
    }

    setFeedback("Authentication could not be verified. Returning to login...", "error");
    console.error(error);

    window.setTimeout(() => {
      window.location.href = "admin-login.html";
    }, 900);
  }
);
