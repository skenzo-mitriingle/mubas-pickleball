import {
  collection,
  getDocs,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import { db } from "./firebase-config.js";

const ANNOUNCEMENTS_COLLECTION = "announcements";
const ANNOUNCEMENTS_CACHE_KEY = "mubas-pickleball:announcements-cache";

function setArchiveStatus(message, state = "") {
  const status = document.getElementById("archive-status");

  if (!status) {
    return;
  }

  status.textContent = message;

  if (state) {
    status.dataset.state = state;
  } else {
    delete status.dataset.state;
  }
}

function getTimestampMilliseconds(timestamp) {
  if (!timestamp) {
    return 0;
  }

  if (typeof timestamp.toMillis === "function") {
    return timestamp.toMillis();
  }

  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }

  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }

  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (typeof timestamp.seconds === "number") {
    const nanoseconds = typeof timestamp.nanoseconds === "number"
      ? timestamp.nanoseconds
      : 0;

    return (timestamp.seconds * 1000) + Math.floor(nanoseconds / 1000000);
  }

  return 0;
}

function getTimestampDate(timestamp) {
  const milliseconds = getTimestampMilliseconds(timestamp);

  if (!milliseconds) {
    return null;
  }

  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cacheAnnouncements(items) {
  try {
    const cachePayload = items.map((item) => ({
      id: item.id || "",
      title: item.title || "",
      date: item.date || "",
      excerpt: item.excerpt || item.message || "",
      createdAtMs: getTimestampMilliseconds(item.createdAt),
      updatedAtMs: getTimestampMilliseconds(item.updatedAt)
    }));

    window.localStorage.setItem(
      ANNOUNCEMENTS_CACHE_KEY,
      JSON.stringify(cachePayload)
    );
  } catch (error) {
    console.warn("Could not cache announcements locally.", error);
  }
}

function readCachedAnnouncements() {
  try {
    const rawCache = window.localStorage.getItem(ANNOUNCEMENTS_CACHE_KEY);

    if (!rawCache) {
      return [];
    }

    const parsedCache = JSON.parse(rawCache);

    if (!Array.isArray(parsedCache)) {
      return [];
    }

    return parsedCache.map((item, index) => ({
      id: typeof item.id === "string" && item.id ? item.id : `cached-${index}`,
      title: typeof item.title === "string" ? item.title : "",
      date: typeof item.date === "string" ? item.date : "",
      excerpt: typeof item.excerpt === "string" ? item.excerpt : "",
      createdAt: getTimestampMilliseconds(item.createdAtMs),
      updatedAt: getTimestampMilliseconds(item.updatedAtMs)
    }));
  } catch (error) {
    console.warn("Could not read cached announcements.", error);
    return [];
  }
}

function getAnnouncementErrorMessage(error) {
  if (error?.code === "permission-denied" || error?.code === "unauthenticated") {
    return "Firebase is connected, but this page is not allowed to read announcements. Check your Firestore rules for the announcements collection.";
  }

  if (error?.code === "failed-precondition") {
    return "This Firestore database is not fully ready yet. Check that you created the correct database and published its rules in the current Firebase project.";
  }

  if (error?.code === "unavailable") {
    return "The app could not reach Firestore. Check your internet connection and confirm the new Firebase project details are correct.";
  }

  if (error?.code === "invalid-argument") {
    return "The app is pointing at an invalid Firestore setup. Recheck firebase-config.js after changing your Firebase project or database.";
  }

  if (error?.code === "deadline-exceeded") {
    return "Firebase did not respond in time. The browser can reach the page, but not Firestore.";
  }

  return "We could not load announcements from Firebase right now. Please try again later.";
}

function getAnnouncementStatusMessage(error, isUsingCache) {
  if (error?.code === "permission-denied" || error?.code === "unauthenticated") {
    return isUsingCache
      ? "Using a saved browser copy because Firestore public reads are blocked."
      : "Firestore blocked public announcement reads.";
  }

  if (error?.code === "deadline-exceeded") {
    return isUsingCache
      ? "Using a saved browser copy because Firebase is taking too long to respond."
      : "Firebase took too long to respond.";
  }

  return isUsingCache
    ? "Using a saved browser copy while Firebase is unavailable."
    : "Firebase connection error.";
}

function withTimeout(promise, timeoutMessage, timeoutMs = 15000) {
  let timerId = 0;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = window.setTimeout(() => {
      const timeoutError = new Error(timeoutMessage);
      timeoutError.code = "deadline-exceeded";
      reject(timeoutError);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    window.clearTimeout(timerId);
  });
}

function formatAnnouncementDate(value, timestamp) {
  if (value) {
    const parsedDate = new Date(`${value}T00:00:00`);

    if (!Number.isNaN(parsedDate.getTime())) {
      return new Intl.DateTimeFormat(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric"
      }).format(parsedDate);
    }

    const fallbackDate = new Date(value);

    if (!Number.isNaN(fallbackDate.getTime())) {
      return new Intl.DateTimeFormat(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric"
      }).format(fallbackDate);
    }

    return value;
  }

  const timestampDate = getTimestampDate(timestamp);

  if (timestampDate) {
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(timestampDate);
  }

  return "Club Update";
}

function formatTimestamp(timestamp) {
  const timestampDate = getTimestampDate(timestamp);

  if (!timestampDate) {
    return "just now";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(timestampDate);
}

function sortAnnouncements(items) {
  return [...items].sort((left, right) => {
    const leftCreated = getTimestampMilliseconds(left.updatedAt || left.createdAt);
    const rightCreated = getTimestampMilliseconds(right.updatedAt || right.createdAt);

    if (rightCreated !== leftCreated) {
      return rightCreated - leftCreated;
    }

    const leftDate = left.date || "";
    const rightDate = right.date || "";

    return rightDate.localeCompare(leftDate);
  });
}

function updateArchiveStats(items) {
  const total = document.getElementById("announcement-total");

  if (total) {
    total.textContent = String(items.length);
  }
}

function renderFeaturedAnnouncement(item) {
  const featuredDate = document.getElementById("featured-date");
  const featuredTitle = document.getElementById("featured-title");
  const featuredCopy = document.getElementById("featured-copy");
  const featuredMeta = document.getElementById("featured-meta");

  if (!featuredDate || !featuredTitle || !featuredCopy || !featuredMeta) {
    return;
  }

  if (!item) {
    featuredDate.textContent = "No updates yet";
    featuredTitle.textContent = "The archive is ready for the first announcement";
    featuredCopy.textContent = "When the club publishes a new notice, it will appear here and in the full archive below.";
    featuredMeta.textContent = "Latest spotlight will update automatically.";
    return;
  }

  featuredDate.textContent = formatAnnouncementDate(item.date, item.createdAt);
  featuredTitle.textContent = item.title || "Untitled announcement";
  featuredCopy.textContent = item.excerpt || item.message || "More details will be shared soon.";
  featuredMeta.textContent = `Last updated ${formatTimestamp(item.updatedAt || item.createdAt)}`;
}

function renderArchiveState(title, message, kicker = "Archive") {
  const container = document.getElementById("archive-grid");

  if (!container) {
    return;
  }

  const card = document.createElement("article");
  card.className = "glass-card archive-empty-card";

  const cardKicker = document.createElement("p");
  cardKicker.className = "card-kicker";
  cardKicker.textContent = kicker;

  const heading = document.createElement("h3");
  heading.className = "card-title";
  heading.textContent = title;

  const copy = document.createElement("p");
  copy.className = "card-text";
  copy.textContent = message;

  card.append(cardKicker, heading, copy);
  container.replaceChildren(card);
}

function renderAnnouncementsArchive(items) {
  const container = document.getElementById("archive-grid");

  if (!container) {
    return;
  }

  const sortedAnnouncements = sortAnnouncements(items);
  updateArchiveStats(sortedAnnouncements);
  renderFeaturedAnnouncement(sortedAnnouncements[0]);

  if (!sortedAnnouncements.length) {
    renderArchiveState(
      "No announcements yet",
      "The club has not published any announcements yet. Check back soon for the first update."
    );
    return;
  }

  container.replaceChildren();

  sortedAnnouncements.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "glass-card archive-card";

    const head = document.createElement("div");
    head.className = "archive-card-head";

    const chip = document.createElement("span");
    chip.className = "archive-chip";
    chip.textContent = index === 0 ? "Latest" : `Notice ${index + 1}`;

    const date = document.createElement("p");
    date.className = "card-date";
    date.textContent = formatAnnouncementDate(item.date, item.createdAt);

    head.append(chip, date);

    const title = document.createElement("h3");
    title.className = "card-title archive-card-title";
    title.textContent = item.title || "Untitled announcement";

    const copy = document.createElement("p");
    copy.className = "card-text archive-card-copy";
    copy.textContent = item.excerpt || item.message || "More details will be shared soon.";

    const meta = document.createElement("p");
    meta.className = "archive-card-meta";
    meta.textContent = `Updated ${formatTimestamp(item.updatedAt || item.createdAt)}`;

    card.append(head, title, copy, meta);
    container.appendChild(card);
  });
}

async function loadAnnouncements() {
  const cachedAnnouncements = readCachedAnnouncements();

  if (cachedAnnouncements.length) {
    renderAnnouncementsArchive(cachedAnnouncements);
    setArchiveStatus("Showing a saved browser copy while Firebase connects.");
  } else {
    renderFeaturedAnnouncement();
    updateArchiveStats([]);
    renderArchiveState(
      "Loading announcements...",
      "Fetching the latest club updates from Firebase.",
      "Live Updates"
    );
    setArchiveStatus("Connecting to Firebase...");
  }

  try {
    const announcementsQuery = query(
      collection(db, ANNOUNCEMENTS_COLLECTION),
      orderBy("updatedAt", "desc")
    );
    const snapshot = await withTimeout(
      getDocs(announcementsQuery),
      "Loading announcements timed out."
    );
    const announcements = snapshot.docs.map((snapshotDoc) => ({
      id: snapshotDoc.id,
      ...snapshotDoc.data()
    }));

    cacheAnnouncements(announcements);
    renderAnnouncementsArchive(announcements);
    setArchiveStatus("Live announcements from Firebase.", "success");
  } catch (error) {
    console.error("Archive announcement load failed:", error);

    const fallbackAnnouncements = readCachedAnnouncements();

    if (fallbackAnnouncements.length) {
      renderAnnouncementsArchive(fallbackAnnouncements);
      setArchiveStatus(
        getAnnouncementStatusMessage(error, true),
        error?.code === "permission-denied" || error?.code === "unauthenticated"
          ? "warning"
          : "error"
      );
      return;
    }

    renderFeaturedAnnouncement();
    updateArchiveStats([]);
    renderArchiveState(
      "Announcements unavailable",
      getAnnouncementErrorMessage(error),
      "Archive Error"
    );
    setArchiveStatus(getAnnouncementStatusMessage(error, false), "error");
  }
}

function setupMobileMenu() {
  const siteHeader = document.querySelector(".site-header");
  const navMenu = document.getElementById("primary-navigation");
  const navToggle = document.querySelector(".nav-toggle");
  const mobileBreakpoint = window.matchMedia("(max-width: 63.9375rem)");

  if (!siteHeader || !navMenu || !navToggle) {
    return;
  }

  function setMenuState(isOpen) {
    const shouldOpen = mobileBreakpoint.matches && isOpen;

    siteHeader.dataset.menuOpen = String(shouldOpen);
    navToggle.setAttribute("aria-expanded", String(shouldOpen));
    navToggle.setAttribute(
      "aria-label",
      shouldOpen ? "Close navigation menu" : "Open navigation menu"
    );

    if (mobileBreakpoint.matches) {
      navMenu.hidden = !shouldOpen;
      return;
    }

    navMenu.hidden = false;
  }

  function syncMenuState() {
    setMenuState(false);
  }

  navToggle.addEventListener("click", () => {
    const isOpen = siteHeader.dataset.menuOpen === "true";
    setMenuState(!isOpen);
  });

  navMenu.querySelectorAll(".nav-link, .nav-button").forEach((item) => {
    item.addEventListener("click", () => {
      if (mobileBreakpoint.matches) {
        setMenuState(false);
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (!mobileBreakpoint.matches || siteHeader.dataset.menuOpen !== "true") {
      return;
    }

    if (!siteHeader.contains(event.target)) {
      setMenuState(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && siteHeader.dataset.menuOpen === "true") {
      setMenuState(false);
      navToggle.focus();
    }
  });

  if (typeof mobileBreakpoint.addEventListener === "function") {
    mobileBreakpoint.addEventListener("change", syncMenuState);
  } else {
    mobileBreakpoint.addListener(syncMenuState);
  }

  syncMenuState();
}

loadAnnouncements();
window.setInterval(loadAnnouncements, 60000);
setupMobileMenu();
