import {
  collection,
  getDocs,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import { db } from "./firebase-config.js";

const FIXTURES_COLLECTION = "fixtureItems";
const FIXTURES_CACHE_KEY = "mubas-pickleball:fixtures-cache";
const HOME_TEAM_NAME = "Mubas Pickleball";

function setArchiveStatus(message, state = "") {
  const status = document.getElementById("fixtures-archive-status");

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

function cacheFixtures(items) {
  try {
    const cachePayload = items.map((item) => ({
      id: item.id || "",
      opponent: item.opponent || "",
      date: item.date || "",
      venue: item.venue || "",
      status: item.status || "",
      details: item.details || "",
      createdAtMs: getTimestampMilliseconds(item.createdAt),
      updatedAtMs: getTimestampMilliseconds(item.updatedAt)
    }));

    window.localStorage.setItem(FIXTURES_CACHE_KEY, JSON.stringify(cachePayload));
  } catch (error) {
    console.warn("Could not cache fixtures locally.", error);
  }
}

function readCachedFixtures() {
  try {
    const rawCache = window.localStorage.getItem(FIXTURES_CACHE_KEY);

    if (!rawCache) {
      return [];
    }

    const parsedCache = JSON.parse(rawCache);

    if (!Array.isArray(parsedCache)) {
      return [];
    }

    return parsedCache.map((item, index) => ({
      id: typeof item.id === "string" && item.id ? item.id : `fixture-cached-${index}`,
      opponent: typeof item.opponent === "string" ? item.opponent : "",
      date: typeof item.date === "string" ? item.date : "",
      venue: typeof item.venue === "string" ? item.venue : "",
      status: typeof item.status === "string" ? item.status : "",
      details: typeof item.details === "string" ? item.details : "",
      createdAt: getTimestampMilliseconds(item.createdAtMs),
      updatedAt: getTimestampMilliseconds(item.updatedAtMs)
    }));
  } catch (error) {
    console.warn("Could not read cached fixtures.", error);
    return [];
  }
}

function getFixtureErrorMessage(error) {
  if (error?.code === "permission-denied" || error?.code === "unauthenticated") {
    return "Firebase is connected, but this page is not allowed to read fixture items. Check your Firestore rules for the fixtureItems collection.";
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

  return "We could not load club fixtures from Firebase right now. Please try again later.";
}

function getFixtureStatusMessage(error, isUsingCache) {
  if (error?.code === "permission-denied" || error?.code === "unauthenticated") {
    return isUsingCache
      ? "Using a saved browser copy because Firestore public fixture reads are blocked."
      : "Firestore blocked public fixture reads.";
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

function normalizeFixtureStatus(status) {
  return status === "completed" ? "completed" : "upcoming";
}

function formatFixtureDate(value, timestamp) {
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

  return "Match Day";
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

function getFixtureSortDate(item) {
  if (item?.date) {
    const parsedDate = Date.parse(`${item.date}T00:00:00`);

    if (!Number.isNaN(parsedDate)) {
      return parsedDate;
    }
  }

  return getTimestampMilliseconds(item?.updatedAt || item?.createdAt) || 0;
}

function sortUpcomingFixtures(items) {
  return [...items].sort((left, right) => {
    const leftDate = getFixtureSortDate(left);
    const rightDate = getFixtureSortDate(right);

    if (leftDate !== rightDate) {
      return leftDate - rightDate;
    }

    const leftUpdated = getTimestampMilliseconds(left.updatedAt || left.createdAt);
    const rightUpdated = getTimestampMilliseconds(right.updatedAt || right.createdAt);
    return rightUpdated - leftUpdated;
  });
}

function sortCompletedFixtures(items) {
  return [...items].sort((left, right) => {
    const leftDate = getFixtureSortDate(left);
    const rightDate = getFixtureSortDate(right);

    if (rightDate !== leftDate) {
      return rightDate - leftDate;
    }

    const leftUpdated = getTimestampMilliseconds(left.updatedAt || left.createdAt);
    const rightUpdated = getTimestampMilliseconds(right.updatedAt || right.createdAt);
    return rightUpdated - leftUpdated;
  });
}

function getFixtureHeadline(item) {
  return `${HOME_TEAM_NAME} vs ${item?.opponent || "Opponent TBD"}`;
}

function updateFixtureStats(allFixtures, upcomingFixtures, completedFixtures) {
  const total = document.getElementById("fixture-total");
  const upcoming = document.getElementById("fixture-upcoming-total");
  const completed = document.getElementById("fixture-completed-total");

  if (total) {
    total.textContent = String(allFixtures.length);
  }

  if (upcoming) {
    upcoming.textContent = String(upcomingFixtures.length);
  }

  if (completed) {
    completed.textContent = String(completedFixtures.length);
  }
}

function renderFeaturedFixture(item) {
  const featuredKicker = document.getElementById("featured-fixture-kicker");
  const featuredDate = document.getElementById("featured-fixture-date");
  const featuredTitle = document.getElementById("featured-fixture-title");
  const featuredVenue = document.getElementById("featured-fixture-venue");
  const featuredCopy = document.getElementById("featured-fixture-copy");
  const featuredMeta = document.getElementById("featured-fixture-meta");

  if (
    !featuredKicker ||
    !featuredDate ||
    !featuredTitle ||
    !featuredVenue ||
    !featuredCopy ||
    !featuredMeta
  ) {
    return;
  }

  if (!item) {
    featuredKicker.textContent = "Featured fixture";
    featuredDate.textContent = "No fixtures yet";
    featuredTitle.textContent = "The archive is ready for the first fixture";
    featuredVenue.textContent = "Venue information will appear here once the first match is added.";
    featuredCopy.textContent = "When the club publishes a fixture or result, it will appear here and in the archive below.";
    featuredMeta.textContent = "Fixture spotlight will update automatically.";
    return;
  }

  const normalizedStatus = normalizeFixtureStatus(item.status);

  featuredKicker.textContent = normalizedStatus === "completed"
    ? "Latest result"
    : "Next match";
  featuredDate.textContent = formatFixtureDate(item.date, item.createdAt);
  featuredTitle.textContent = getFixtureHeadline(item);
  featuredVenue.textContent = `Venue: ${item.venue || "Venue to be confirmed"}`;
  featuredCopy.textContent = item.details || (
    normalizedStatus === "completed"
      ? "Result details will be shared soon."
      : "More match details will be shared soon."
  );
  featuredMeta.textContent = normalizedStatus === "completed"
    ? `Result updated ${formatTimestamp(item.updatedAt || item.createdAt)}`
    : `Fixture updated ${formatTimestamp(item.updatedAt || item.createdAt)}`;
}

function renderFixtureEmptyState(containerId, title, message, kicker) {
  const container = document.getElementById(containerId);

  if (!container) {
    return;
  }

  const card = document.createElement("article");
  card.className = "glass-card fixture-empty-card";

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

function renderFixtureCards(containerId, items) {
  const container = document.getElementById(containerId);

  if (!container) {
    return;
  }

  container.replaceChildren();

  items.forEach((item) => {
    const normalizedStatus = normalizeFixtureStatus(item.status);
    const card = document.createElement("article");
    card.className = "glass-card fixture-archive-card";

    const head = document.createElement("div");
    head.className = "fixture-archive-head";

    const chip = document.createElement("span");
    chip.className = "fixture-chip";
    chip.dataset.variant = normalizedStatus;
    chip.textContent = normalizedStatus === "completed" ? "Completed" : "Upcoming";

    const date = document.createElement("p");
    date.className = "card-date";
    date.textContent = formatFixtureDate(item.date, item.createdAt);

    head.append(chip, date);

    const title = document.createElement("h3");
    title.className = "fixture-archive-title";
    title.textContent = getFixtureHeadline(item);

    const venue = document.createElement("p");
    venue.className = "card-meta";
    venue.textContent = `Venue: ${item.venue || "Venue to be confirmed"}`;

    const details = document.createElement("p");
    details.className = "fixture-archive-copy";
    details.textContent = item.details || (
      normalizedStatus === "completed"
        ? "Result details will be shared soon."
        : "More match details will be shared soon."
    );

    const meta = document.createElement("p");
    meta.className = "fixture-archive-meta";
    meta.textContent = `Updated ${formatTimestamp(item.updatedAt || item.createdAt)}`;

    card.append(head, title, venue, details, meta);
    container.appendChild(card);
  });
}

function renderFixtureArchive(items) {
  const normalizedFixtures = items.map((item) => ({
    ...item,
    status: normalizeFixtureStatus(item.status)
  }));
  const upcomingFixtures = sortUpcomingFixtures(
    normalizedFixtures.filter((item) => item.status === "upcoming")
  );
  const completedFixtures = sortCompletedFixtures(
    normalizedFixtures.filter((item) => item.status === "completed")
  );

  updateFixtureStats(normalizedFixtures, upcomingFixtures, completedFixtures);
  renderFeaturedFixture(upcomingFixtures[0] || completedFixtures[0]);

  if (upcomingFixtures.length) {
    renderFixtureCards("fixtures-upcoming-grid", upcomingFixtures);
  } else {
    renderFixtureEmptyState(
      "fixtures-upcoming-grid",
      "No upcoming fixtures yet",
      "The club has not scheduled any upcoming matches yet. Check back soon for the next fixture.",
      "Upcoming"
    );
  }

  if (completedFixtures.length) {
    renderFixtureCards("fixtures-completed-grid", completedFixtures);
  } else {
    renderFixtureEmptyState(
      "fixtures-completed-grid",
      "No completed results yet",
      "Completed match results will appear here once the first fixture is marked as completed.",
      "Completed"
    );
  }
}

async function loadFixtures() {
  const cachedFixtures = readCachedFixtures();

  if (cachedFixtures.length) {
    renderFixtureArchive(cachedFixtures);
    setArchiveStatus("Showing a saved browser copy while Firebase connects.");
  } else {
    renderFeaturedFixture();
    updateFixtureStats([], [], []);
    renderFixtureEmptyState(
      "fixtures-upcoming-grid",
      "Loading fixtures...",
      "Fetching the latest upcoming matches from Firebase.",
      "Live Fixtures"
    );
    renderFixtureEmptyState(
      "fixtures-completed-grid",
      "Loading results...",
      "Fetching the latest completed results from Firebase.",
      "Live Results"
    );
    setArchiveStatus("Connecting to Firebase...");
  }

  try {
    const fixturesQuery = query(
      collection(db, FIXTURES_COLLECTION),
      orderBy("updatedAt", "desc")
    );
    const snapshot = await withTimeout(
      getDocs(fixturesQuery),
      "Loading fixtures timed out."
    );
    const fixtures = snapshot.docs.map((snapshotDoc) => ({
      id: snapshotDoc.id,
      ...snapshotDoc.data()
    }));

    cacheFixtures(fixtures);
    renderFixtureArchive(fixtures);
    setArchiveStatus("Live fixtures from Firebase.", "success");
  } catch (error) {
    console.error("Fixture archive load failed:", error);

    const fallbackFixtures = readCachedFixtures();

    if (fallbackFixtures.length) {
      renderFixtureArchive(fallbackFixtures);
      setArchiveStatus(
        getFixtureStatusMessage(error, true),
        error?.code === "permission-denied" || error?.code === "unauthenticated"
          ? "warning"
          : "error"
      );
      return;
    }

    renderFeaturedFixture();
    updateFixtureStats([], [], []);
    renderFixtureEmptyState(
      "fixtures-upcoming-grid",
      "Fixtures unavailable",
      getFixtureErrorMessage(error),
      "Archive Error"
    );
    renderFixtureEmptyState(
      "fixtures-completed-grid",
      "Results unavailable",
      "Completed results will appear here once Firebase responds again.",
      "Archive Error"
    );
    setArchiveStatus(getFixtureStatusMessage(error, false), "error");
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

loadFixtures();
window.setInterval(loadFixtures, 60000);
setupMobileMenu();
