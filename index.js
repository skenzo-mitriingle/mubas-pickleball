import {
  collection,
  getDocs,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import { db } from "./firebase-config.js";
import {
  getAdaptiveRefreshInterval,
  prefersLiteExperience,
  scheduleVisibilityAwareRefresh
} from "./performance-utils.js";
import {
  createVideoMediaElement
} from "./video-utils.js";

const ANNOUNCEMENTS_COLLECTION = "announcements";
const ANNOUNCEMENTS_CACHE_KEY = "mubas-pickleball:announcements-cache";
const GALLERY_COLLECTION = "galleryItems";
const GALLERY_CACHE_KEY = "mubas-pickleball:gallery-cache";
const VIDEOS_COLLECTION = "videoItems";
const VIDEOS_CACHE_KEY = "mubas-pickleball:videos-cache";
const FIXTURES_COLLECTION = "fixtureItems";
const FIXTURES_CACHE_KEY = "mubas-pickleball:fixtures-cache";
const HOME_TEAM_NAME = "Mubas Pickleball";
const homeGalleryLightbox = document.getElementById("home-gallery-lightbox");
const homeGalleryLightboxClose = document.getElementById("home-gallery-lightbox-close");
const homeGalleryLightboxPrev = document.getElementById("home-gallery-lightbox-prev");
const homeGalleryLightboxNext = document.getElementById("home-gallery-lightbox-next");
const homeGalleryLightboxSave = document.getElementById("home-gallery-lightbox-save");
const homeGalleryLightboxImage = document.getElementById("home-gallery-lightbox-image");

let activeHomeGalleryItem = null;
let lastHomeGalleryFocus = null;
let visibleHomeGalleryItems = [];

function setAnnouncementsStatus(message, state = "") {
  const status = document.getElementById("announcements-status");

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

function setGalleryStatus(message, state = "") {
  const status = document.getElementById("gallery-status");

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

function setVideosStatus(message, state = "") {
  const status = document.getElementById("videos-status");

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

function setFixturesStatus(message, state = "") {
  const status = document.getElementById("fixtures-status");

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

function setSectionBusy(containerId, isBusy) {
  const container = document.getElementById(containerId);

  if (!container) {
    return;
  }

  container.setAttribute("aria-busy", isBusy ? "true" : "false");
}

function createSkeletonLine(className = "") {
  const line = document.createElement("span");
  line.className = `skeleton-line${className ? ` ${className}` : ""}`;
  line.setAttribute("aria-hidden", "true");
  return line;
}

function createSkeletonBlock(className = "") {
  const block = document.createElement("span");
  block.className = `skeleton-block${className ? ` ${className}` : ""}`;
  block.setAttribute("aria-hidden", "true");
  return block;
}

function createSkeletonCard(className) {
  const card = document.createElement("article");
  card.className = `glass-card ${className} skeleton-card`;
  card.setAttribute("aria-hidden", "true");
  return card;
}

function renderAnnouncementSkeletons() {
  const container = document.getElementById("announcements-list");

  if (!container) {
    return;
  }

  const cards = Array.from({ length: 3 }, () => {
    const card = createSkeletonCard("announcement-card");
    card.append(
      createSkeletonLine("skeleton-line-meta"),
      createSkeletonLine("skeleton-line-long"),
      createSkeletonLine("skeleton-line-medium"),
      createSkeletonLine("skeleton-line-short")
    );
    return card;
  });

  container.replaceChildren(...cards);
  setSectionBusy("announcements-list", true);
}

function renderGallerySkeletons() {
  const container = document.getElementById("gallery-grid");

  if (!container) {
    return;
  }

  visibleHomeGalleryItems = [];
  updateHomeGalleryNavigationState();

  const cards = Array.from({ length: 4 }, () => {
    const card = createSkeletonCard("gallery-card");
    const caption = document.createElement("div");
    caption.className = "gallery-caption";

    caption.append(
      createSkeletonLine("skeleton-line-meta"),
      createSkeletonLine("skeleton-line-short")
    );
    card.append(createSkeletonBlock(), caption);
    return card;
  });

  container.replaceChildren(...cards);
  setSectionBusy("gallery-grid", true);
}

function renderVideoSkeletons() {
  const container = document.getElementById("video-list");

  if (!container) {
    return;
  }

  const cards = Array.from({ length: 4 }, () => {
    const card = createSkeletonCard("video-card");
    const media = document.createElement("div");
    media.className = "video-frame skeleton-block";

    const copy = document.createElement("div");
    copy.className = "video-copy video-copy-compact";
    copy.appendChild(createSkeletonLine("skeleton-line-meta"));

    card.append(media, copy);
    return card;
  });

  container.replaceChildren(...cards);
  delete container.dataset.renderSignature;
  setSectionBusy("video-list", true);
}

function renderFixtureSkeletons() {
  const container = document.getElementById("fixtures-list");

  if (!container) {
    return;
  }

  const cards = Array.from({ length: 4 }, () => {
    const card = createSkeletonCard("fixture-card");
    const head = document.createElement("div");
    head.className = "fixture-card-head";

    const chip = document.createElement("span");
    chip.className = "skeleton-pill";
    chip.setAttribute("aria-hidden", "true");

    head.append(chip, createSkeletonLine("skeleton-line-meta"));
    card.append(
      head,
      createSkeletonLine("skeleton-line-title"),
      createSkeletonLine("skeleton-line-medium"),
      createSkeletonLine("skeleton-line-short")
    );
    return card;
  });

  container.replaceChildren(...cards);
  setSectionBusy("fixtures-list", true);
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

function cacheGalleryItems(items) {
  try {
    const cachePayload = items.map((item) => ({
      id: item.id || "",
      date: item.date || "",
      caption: item.caption || "",
      imageUrl: item.imageUrl || "",
      createdAtMs: getTimestampMilliseconds(item.createdAt),
      updatedAtMs: getTimestampMilliseconds(item.updatedAt)
    }));

    window.localStorage.setItem(
      GALLERY_CACHE_KEY,
      JSON.stringify(cachePayload)
    );
  } catch (error) {
    console.warn("Could not cache gallery items locally.", error);
  }
}

function cacheVideos(items) {
  try {
    const cachePayload = items.map((item) => ({
      id: item.id || "",
      title: item.title || "",
      date: item.date || "",
      description: item.description || "",
      sourceUrl: item.sourceUrl || "",
      embedUrl: item.embedUrl || "",
      provider: item.provider || "",
      createdAtMs: getTimestampMilliseconds(item.createdAt),
      updatedAtMs: getTimestampMilliseconds(item.updatedAt)
    }));

    window.localStorage.setItem(
      VIDEOS_CACHE_KEY,
      JSON.stringify(cachePayload)
    );
  } catch (error) {
    console.warn("Could not cache videos locally.", error);
  }
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

    window.localStorage.setItem(
      FIXTURES_CACHE_KEY,
      JSON.stringify(cachePayload)
    );
  } catch (error) {
    console.warn("Could not cache fixtures locally.", error);
  }
}

function readCachedGalleryItems() {
  try {
    const rawCache = window.localStorage.getItem(GALLERY_CACHE_KEY);

    if (!rawCache) {
      return [];
    }

    const parsedCache = JSON.parse(rawCache);

    if (!Array.isArray(parsedCache)) {
      return [];
    }

    return parsedCache.map((item, index) => ({
      id: typeof item.id === "string" && item.id ? item.id : `gallery-cached-${index}`,
      date: typeof item.date === "string" ? item.date : "",
      caption: typeof item.caption === "string" ? item.caption : "",
      imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : "",
      createdAt: getTimestampMilliseconds(item.createdAtMs),
      updatedAt: getTimestampMilliseconds(item.updatedAtMs)
    })).filter((item) => item.imageUrl);
  } catch (error) {
    console.warn("Could not read cached gallery items.", error);
    return [];
  }
}

function readCachedVideos() {
  try {
    const rawCache = window.localStorage.getItem(VIDEOS_CACHE_KEY);

    if (!rawCache) {
      return [];
    }

    const parsedCache = JSON.parse(rawCache);

    if (!Array.isArray(parsedCache)) {
      return [];
    }

    return parsedCache.map((item, index) => ({
      id: typeof item.id === "string" && item.id ? item.id : `video-cached-${index}`,
      title: typeof item.title === "string" ? item.title : "",
      date: typeof item.date === "string" ? item.date : "",
      description: typeof item.description === "string" ? item.description : "",
      sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : "",
      embedUrl: typeof item.embedUrl === "string" ? item.embedUrl : "",
      provider: typeof item.provider === "string" ? item.provider : "",
      createdAt: getTimestampMilliseconds(item.createdAtMs),
      updatedAt: getTimestampMilliseconds(item.updatedAtMs)
    })).filter((item) => item.sourceUrl || item.embedUrl);
  } catch (error) {
    console.warn("Could not read cached videos.", error);
    return [];
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

function getAnnouncementErrorLabel(error) {
  if (error?.code === "permission-denied" || error?.code === "unauthenticated") {
    return "Permission Error";
  }

  if (error?.code === "deadline-exceeded") {
    return "Timeout";
  }

  return "Connection Error";
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

function getGalleryErrorMessage(error) {
  if (error?.code === "permission-denied" || error?.code === "unauthenticated") {
    return "Firebase is connected, but this page is not allowed to read gallery items. Check your Firestore rules for the galleryItems collection.";
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

  return "We could not load gallery images from Firebase right now. Please try again later.";
}

function getGalleryErrorLabel(error) {
  if (error?.code === "permission-denied" || error?.code === "unauthenticated") {
    return "Permission Error";
  }

  if (error?.code === "deadline-exceeded") {
    return "Timeout";
  }

  return "Connection Error";
}

function getGalleryStatusMessage(error, isUsingCache) {
  if (error?.code === "permission-denied" || error?.code === "unauthenticated") {
    return isUsingCache
      ? "Using a saved browser copy because Firestore public gallery reads are blocked."
      : "Firestore blocked public gallery reads.";
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

function getVideoErrorMessage(error) {
  if (error?.code === "permission-denied" || error?.code === "unauthenticated") {
    return "Firebase is connected, but this page is not allowed to read video items. Check your Firestore rules for the videoItems collection.";
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

  return "We could not load club videos from Firebase right now. Please try again later.";
}

function getVideoStatusMessage(error, isUsingCache) {
  if (error?.code === "permission-denied" || error?.code === "unauthenticated") {
    return isUsingCache
      ? "Using a saved browser copy because Firestore public video reads are blocked."
      : "Firestore blocked public video reads.";
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

function formatGalleryDate(value, timestamp) {
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

  return "Club Photo";
}

function formatVideoDate(value, timestamp) {
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

  return "Club Video";
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

function sortGalleryItems(items) {
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

function sortVideos(items) {
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

function getVisibleVideoSignature(items) {
  return sortVideos(items)
    .filter((item) => item.sourceUrl || item.embedUrl)
    .slice(0, 4)
    .map((item) => [
      item.id || "",
      item.sourceUrl || "",
      item.embedUrl || "",
      item.date || "",
      getTimestampMilliseconds(item.updatedAt || item.createdAt)
    ].join("|"))
    .join("||");
}

function normalizeFixtureStatus(status) {
  return status === "completed" ? "completed" : "upcoming";
}

function getFixtureSortDate(item) {
  if (item?.date) {
    const parsedDate = Date.parse(`${item.date}T00:00:00`);

    if (!Number.isNaN(parsedDate)) {
      return parsedDate;
    }
  }

  const fallbackTimestamp = getTimestampMilliseconds(item?.updatedAt || item?.createdAt);
  return fallbackTimestamp || 0;
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

function extractImageExtension(imageUrl) {
  try {
    const decodedPath = decodeURIComponent(new URL(imageUrl).pathname);
    const fileName = decodedPath.split("/").pop() || "";
    const extensionMatch = fileName.match(/\.(avif|gif|heic|jpeg|jpg|png|webp)$/i);
    return extensionMatch ? extensionMatch[0].toLowerCase() : ".jpg";
  } catch (error) {
    return ".jpg";
  }
}

function buildDownloadFileName(item) {
  const baseName = (item?.caption || item?.date || "mubas-gallery-image")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "mubas-gallery-image";

  return `${baseName}${extractImageExtension(item?.imageUrl || "")}`;
}

function findGalleryItemIndex(items, item) {
  if (!Array.isArray(items) || !items.length || !item) {
    return -1;
  }

  if (item.id) {
    const itemByIdIndex = items.findIndex((entry) => entry.id === item.id);

    if (itemByIdIndex !== -1) {
      return itemByIdIndex;
    }
  }

  return items.findIndex((entry) => (
    entry.imageUrl === item.imageUrl
    && entry.caption === item.caption
    && entry.date === item.date
  ));
}

function updateHomeGalleryNavigationState() {
  const hasMultipleItems = visibleHomeGalleryItems.length > 1;

  if (homeGalleryLightboxPrev) {
    homeGalleryLightboxPrev.hidden = !hasMultipleItems;
    homeGalleryLightboxPrev.disabled = !hasMultipleItems;
    homeGalleryLightboxPrev.setAttribute("aria-label", "Show previous image");
  }

  if (homeGalleryLightboxNext) {
    homeGalleryLightboxNext.hidden = !hasMultipleItems;
    homeGalleryLightboxNext.disabled = !hasMultipleItems;
    homeGalleryLightboxNext.setAttribute("aria-label", "Show next image");
  }

  if (!hasMultipleItems || !activeHomeGalleryItem) {
    return;
  }

  const currentIndex = findGalleryItemIndex(visibleHomeGalleryItems, activeHomeGalleryItem);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  const previousItem = visibleHomeGalleryItems[
    (safeIndex - 1 + visibleHomeGalleryItems.length) % visibleHomeGalleryItems.length
  ];
  const nextItem = visibleHomeGalleryItems[
    (safeIndex + 1) % visibleHomeGalleryItems.length
  ];

  if (homeGalleryLightboxPrev && previousItem) {
    homeGalleryLightboxPrev.setAttribute(
      "aria-label",
      `Show previous image: ${previousItem.caption || "Gallery image"}`
    );
  }

  if (homeGalleryLightboxNext && nextItem) {
    homeGalleryLightboxNext.setAttribute(
      "aria-label",
      `Show next image: ${nextItem.caption || "Gallery image"}`
    );
  }
}

function renderHomeGalleryLightboxItem(item) {
  if (
    !item ||
    !item.imageUrl ||
    !homeGalleryLightbox ||
    !homeGalleryLightboxImage
  ) {
    return;
  }

  activeHomeGalleryItem = item;
  homeGalleryLightboxImage.src = item.imageUrl;
  homeGalleryLightboxImage.alt = item.caption || "Full gallery image";
  updateHomeGalleryNavigationState();
}

function openHomeGalleryLightbox(item) {
  if (!item || !item.imageUrl || !homeGalleryLightbox) {
    return;
  }

  lastHomeGalleryFocus = document.activeElement;
  renderHomeGalleryLightboxItem(item);
  homeGalleryLightbox.hidden = false;
  document.body.classList.add("is-lightbox-open");
  window.setTimeout(() => {
    homeGalleryLightboxClose?.focus();
  }, 0);
}

function stepHomeGalleryLightbox(direction) {
  if (!activeHomeGalleryItem || visibleHomeGalleryItems.length < 2) {
    return;
  }

  const currentIndex = findGalleryItemIndex(visibleHomeGalleryItems, activeHomeGalleryItem);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = (
    safeIndex + direction + visibleHomeGalleryItems.length
  ) % visibleHomeGalleryItems.length;

  renderHomeGalleryLightboxItem(visibleHomeGalleryItems[nextIndex]);
}

function closeHomeGalleryLightbox() {
  if (!homeGalleryLightbox || homeGalleryLightbox.hidden) {
    return;
  }

  homeGalleryLightbox.hidden = true;
  document.body.classList.remove("is-lightbox-open");
  homeGalleryLightboxImage?.removeAttribute("src");
  activeHomeGalleryItem = null;

  if (lastHomeGalleryFocus instanceof HTMLElement) {
    lastHomeGalleryFocus.focus();
  }
}

async function saveActiveHomeGalleryImage() {
  if (!activeHomeGalleryItem?.imageUrl || !homeGalleryLightboxSave) {
    return;
  }

  const saveLabel = homeGalleryLightboxSave.textContent;
  homeGalleryLightboxSave.disabled = true;
  homeGalleryLightboxSave.textContent = "Saving...";

  try {
    const response = await fetch(activeHomeGalleryItem.imageUrl, { mode: "cors" });

    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");

    downloadLink.href = objectUrl;
    downloadLink.download = buildDownloadFileName(activeHomeGalleryItem);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    URL.revokeObjectURL(objectUrl);
    homeGalleryLightboxSave.textContent = "Saved";
  } catch (error) {
    window.open(activeHomeGalleryItem.imageUrl, "_blank", "noopener");
    homeGalleryLightboxSave.textContent = "Opened In New Tab";
  }

  window.setTimeout(() => {
    homeGalleryLightboxSave.disabled = false;
    homeGalleryLightboxSave.textContent = saveLabel;
  }, 1200);
}

function setupHomeGalleryLightbox() {
  if (!homeGalleryLightbox) {
    return;
  }

  homeGalleryLightboxPrev?.addEventListener("click", () => {
    stepHomeGalleryLightbox(-1);
  });
  homeGalleryLightboxNext?.addEventListener("click", () => {
    stepHomeGalleryLightbox(1);
  });
  homeGalleryLightboxClose?.addEventListener("click", closeHomeGalleryLightbox);
  homeGalleryLightboxSave?.addEventListener("click", saveActiveHomeGalleryImage);

  homeGalleryLightbox.addEventListener("click", (event) => {
    const closeTrigger = event.target.closest("[data-lightbox-close]");

    if (closeTrigger) {
      closeHomeGalleryLightbox();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!homeGalleryLightbox || homeGalleryLightbox.hidden) {
      return;
    }

    if (event.key === "Escape") {
      closeHomeGalleryLightbox();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepHomeGalleryLightbox(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      stepHomeGalleryLightbox(1);
    }
  });
}

function renderAnnouncementState(title, message, dateLabel = "Live Updates") {
  const container = document.getElementById("announcements-list");

  if (!container) {
    return;
  }

  const card = document.createElement("article");
  card.className = "glass-card announcement-card";

  const date = document.createElement("p");
  date.className = "card-date";
  date.textContent = dateLabel;

  const heading = document.createElement("h3");
  heading.className = "card-title";
  heading.textContent = title;

  const copy = document.createElement("p");
  copy.className = "card-text";
  copy.textContent = message;

  card.append(date, heading, copy);
  container.replaceChildren(card);
  setSectionBusy("announcements-list", false);
}

function renderAnnouncements(items) {
  const container = document.getElementById("announcements-list");

  if (!container) {
    return;
  }

  const visibleAnnouncements = sortAnnouncements(items).slice(0, 3);

  if (!visibleAnnouncements.length) {
    renderAnnouncementState(
      "No announcements yet",
      "The club has not published any announcements yet. Check back soon for updates."
    );
    return;
  }

  container.replaceChildren();

  visibleAnnouncements.forEach((item) => {
    const card = document.createElement("article");
    card.className = "glass-card announcement-card";

    const date = document.createElement("p");
    date.className = "card-date";
    date.textContent = formatAnnouncementDate(item.date, item.createdAt);

    const copy = document.createElement("p");
    copy.className = "card-text";
    copy.textContent = item.excerpt || item.message || "More details will be shared soon.";

    card.append(date, copy);
    container.appendChild(card);
  });

  setSectionBusy("announcements-list", false);
}

async function loadAnnouncements() {
  const container = document.getElementById("announcements-list");

  if (!container) {
    return;
  }

  const cachedAnnouncements = readCachedAnnouncements();

  if (cachedAnnouncements.length) {
    renderAnnouncements(cachedAnnouncements);
    setAnnouncementsStatus("Showing saved updates while loading.");
  } else {
    renderAnnouncementSkeletons();
    setAnnouncementsStatus("Loading latest updates...");
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
    renderAnnouncements(announcements);
    setAnnouncementsStatus("Latest announcements", "success");
  } catch (error) {
    console.error("Announcement load failed:", error);

    const fallbackAnnouncements = readCachedAnnouncements();

    if (fallbackAnnouncements.length) {
      renderAnnouncements(fallbackAnnouncements);
      setAnnouncementsStatus(
        getAnnouncementStatusMessage(error, true),
        error?.code === "permission-denied" || error?.code === "unauthenticated"
          ? "warning"
          : "error"
      );
      return;
    }

    renderAnnouncementState(
      "Announcements unavailable",
      getAnnouncementErrorMessage(error),
      getAnnouncementErrorLabel(error)
    );
    setAnnouncementsStatus(getAnnouncementStatusMessage(error, false), "error");
  }
}

function renderGalleryState(title, message, dateLabel = "Gallery Update") {
  const container = document.getElementById("gallery-grid");

  if (!container) {
    return;
  }

  visibleHomeGalleryItems = [];
  updateHomeGalleryNavigationState();

  const card = document.createElement("article");
  card.className = "glass-card gallery-card";

  const copy = document.createElement("div");
  copy.className = "gallery-caption";

  const date = document.createElement("p");
  date.className = "card-date";
  date.textContent = dateLabel;

  const heading = document.createElement("h3");
  heading.textContent = title;

  const text = document.createElement("p");
  text.className = "card-text";
  text.textContent = message;

  copy.append(date, heading, text);
  card.appendChild(copy);
  container.replaceChildren(card);
  setSectionBusy("gallery-grid", false);
}

function renderGallery(items) {
  const container = document.getElementById("gallery-grid");

  if (!container) {
    return;
  }

  const visibleGalleryItems = sortGalleryItems(items)
    .filter((item) => item.imageUrl)
    .slice(0, 4);

  visibleHomeGalleryItems = visibleGalleryItems;

  if (!visibleGalleryItems.length) {
    renderGalleryState(
      "No gallery images yet",
      "The club has not uploaded any gallery photos yet. Check back soon for the first image."
    );
    return;
  }

  container.replaceChildren();

  visibleGalleryItems.forEach((item) => {
    const card = document.createElement("article");
    card.className = "glass-card gallery-card is-clickable";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute(
      "aria-label",
      `Open full image: ${item.caption || "Gallery image"}`
    );
    card.addEventListener("click", () => {
      openHomeGalleryLightbox(item);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openHomeGalleryLightbox(item);
      }
    });

    const media = document.createElement("div");
    media.className = "gallery-media";

    const image = document.createElement("img");
    image.src = item.imageUrl;
    image.alt = item.caption || "Gallery image";
    image.className = "gallery-image";
    image.loading = "lazy";
    image.decoding = "async";

    const overlay = document.createElement("span");
    overlay.className = "gallery-card-overlay";

    const overlayLabel = document.createElement("span");
    overlayLabel.className = "gallery-card-overlay-label";
    overlayLabel.textContent = "View full image";

    overlay.appendChild(overlayLabel);
    media.append(image, overlay);

    const caption = document.createElement("div");
    caption.className = "gallery-caption";

    const date = document.createElement("p");
    date.className = "card-date";
    date.textContent = formatGalleryDate(item.date, item.createdAt);
    caption.appendChild(date);
    card.append(media, caption);
    container.appendChild(card);
  });

  setSectionBusy("gallery-grid", false);

  if (!homeGalleryLightbox?.hidden && activeHomeGalleryItem) {
    const matchingActiveItem = visibleHomeGalleryItems.find((item) => (
      item.id === activeHomeGalleryItem.id
      || (
        item.imageUrl === activeHomeGalleryItem.imageUrl
        && item.caption === activeHomeGalleryItem.caption
        && item.date === activeHomeGalleryItem.date
      )
    ));

    if (matchingActiveItem) {
      renderHomeGalleryLightboxItem(matchingActiveItem);
    } else {
      closeHomeGalleryLightbox();
    }
  }
}

async function loadGallery() {
  const container = document.getElementById("gallery-grid");

  if (!container) {
    return;
  }

  const cachedGalleryItems = readCachedGalleryItems();

  if (cachedGalleryItems.length) {
    renderGallery(cachedGalleryItems);
    setGalleryStatus("Showing saved updates while loading.");
  } else {
    renderGallerySkeletons();
    setGalleryStatus("Loading latest updates...");
  }

  try {
    const galleryQuery = query(
      collection(db, GALLERY_COLLECTION),
      orderBy("updatedAt", "desc")
    );
    const snapshot = await withTimeout(
      getDocs(galleryQuery),
      "Loading gallery timed out."
    );
    const galleryItems = snapshot.docs.map((snapshotDoc) => ({
      id: snapshotDoc.id,
      ...snapshotDoc.data()
    }));

    cacheGalleryItems(galleryItems);
    renderGallery(galleryItems);
    setGalleryStatus("Latest gallery updates", "success");
  } catch (error) {
    console.error("Gallery load failed:", error);

    const fallbackGalleryItems = readCachedGalleryItems();

    if (fallbackGalleryItems.length) {
      renderGallery(fallbackGalleryItems);
      setGalleryStatus(
        getGalleryStatusMessage(error, true),
        error?.code === "permission-denied" || error?.code === "unauthenticated"
          ? "warning"
          : "error"
      );
      return;
    }

    renderGalleryState(
      "Gallery unavailable",
      getGalleryErrorMessage(error),
      getGalleryErrorLabel(error)
    );
    setGalleryStatus(getGalleryStatusMessage(error, false), "error");
  }
}

function renderVideoState(title, message, dateLabel = "Video Update") {
  const container = document.getElementById("video-list");

  if (!container) {
    return;
  }

  const card = document.createElement("article");
  card.className = "glass-card video-card";

  const copy = document.createElement("div");
  copy.className = "video-copy";

  const date = document.createElement("p");
  date.className = "card-date";
  date.textContent = dateLabel;

  const heading = document.createElement("h3");
  heading.className = "card-title";
  heading.textContent = title;

  const text = document.createElement("p");
  text.className = "card-text";
  text.textContent = message;

  copy.append(date, heading, text);
  card.appendChild(copy);
  container.replaceChildren(card);
  container.dataset.renderSignature = `state|${dateLabel}|${title}|${message}`;
  setSectionBusy("video-list", false);
}

function renderVideos(items) {
  const container = document.getElementById("video-list");

  if (!container) {
    return;
  }

  const visibleVideos = sortVideos(items)
    .filter((item) => item.sourceUrl || item.embedUrl)
    .slice(0, 4);
  const nextSignature = getVisibleVideoSignature(items);
  const useLiteVideoEmbeds = prefersLiteExperience();

  if (!visibleVideos.length) {
    renderVideoState(
      "No videos yet",
      "The club has not published any video highlights yet. Check back soon for the first upload."
    );
    return;
  }

  if (container.dataset.renderSignature === nextSignature) {
    setSectionBusy("video-list", false);
    return;
  }

  container.replaceChildren();

  visibleVideos.forEach((item) => {
    const card = document.createElement("article");
    card.className = "glass-card video-card";

    const media = createVideoMediaElement(item, {
      title: item.title || item.description || "Club video",
      defer: useLiteVideoEmbeds
    });

    const copy = document.createElement("div");
    copy.className = "video-copy video-copy-compact";

    const date = document.createElement("p");
    date.className = "card-date";
    date.textContent = formatVideoDate(item.date, item.createdAt);
    copy.appendChild(date);

    card.append(media, copy);
    container.appendChild(card);
  });

  container.dataset.renderSignature = nextSignature;
  setSectionBusy("video-list", false);
}

async function loadVideos() {
  const container = document.getElementById("video-list");

  if (!container) {
    return;
  }

  const cachedVideos = readCachedVideos();

  if (cachedVideos.length) {
    renderVideos(cachedVideos);
    setVideosStatus("Showing saved updates while loading.");
  } else {
    renderVideoSkeletons();
    setVideosStatus("Loading latest updates...");
  }

  try {
    const videosQuery = query(
      collection(db, VIDEOS_COLLECTION),
      orderBy("updatedAt", "desc")
    );
    const snapshot = await withTimeout(
      getDocs(videosQuery),
      "Loading videos timed out."
    );
    const videos = snapshot.docs.map((snapshotDoc) => ({
      id: snapshotDoc.id,
      ...snapshotDoc.data()
    }));

    cacheVideos(videos);
    renderVideos(videos);
    setVideosStatus("Latest video updates", "success");
  } catch (error) {
    console.error("Video load failed:", error);

    const fallbackVideos = readCachedVideos();

    if (fallbackVideos.length) {
      renderVideos(fallbackVideos);
      setVideosStatus(
        getVideoStatusMessage(error, true),
        error?.code === "permission-denied" || error?.code === "unauthenticated"
          ? "warning"
          : "error"
      );
      return;
    }

    renderVideoState(
      "Videos unavailable",
      getVideoErrorMessage(error),
      "Video Error"
    );
    setVideosStatus(getVideoStatusMessage(error, false), "error");
  }
}

function renderFixtureState(title, message, dateLabel = "Fixture Update") {
  const container = document.getElementById("fixtures-list");

  if (!container) {
    return;
  }

  const card = document.createElement("article");
  card.className = "glass-card fixture-card";

  const date = document.createElement("p");
  date.className = "card-date";
  date.textContent = dateLabel;

  const heading = document.createElement("h3");
  heading.className = "card-title";
  heading.textContent = title;

  const text = document.createElement("p");
  text.className = "card-text";
  text.textContent = message;

  card.append(date, heading, text);
  container.replaceChildren(card);
  setSectionBusy("fixtures-list", false);
}

function renderFixtures(items) {
  const container = document.getElementById("fixtures-list");

  if (!container) {
    return;
  }

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
  const visibleFixtures = (upcomingFixtures.length
    ? upcomingFixtures
    : completedFixtures
  ).slice(0, 4);

  if (!visibleFixtures.length) {
    renderFixtureState(
      "No fixtures yet",
      "The club has not published any fixtures yet. Check back soon for the first match update."
    );
    return;
  }

  container.replaceChildren();

  visibleFixtures.forEach((item) => {
    const card = document.createElement("article");
    card.className = "glass-card fixture-card";

    const head = document.createElement("div");
    head.className = "fixture-card-head";

    const chip = document.createElement("span");
    chip.className = "fixture-chip";
    chip.dataset.variant = item.status;
    chip.textContent = item.status === "completed" ? "Completed" : "Upcoming";

    const date = document.createElement("p");
    date.className = "card-date";
    date.textContent = formatFixtureDate(item.date, item.createdAt);

    head.append(chip, date);

    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = getFixtureHeadline(item);

    const venue = document.createElement("p");
    venue.className = "card-meta";
    venue.textContent = `Venue: ${item.venue || "Venue to be confirmed"}`;

    card.append(head, title, venue);

    if (item.details) {
      const details = document.createElement("p");
      details.className = "card-text";
      details.textContent = item.details;
      card.appendChild(details);
    }

    container.appendChild(card);
  });

  setSectionBusy("fixtures-list", false);
}

async function loadFixtures() {
  const container = document.getElementById("fixtures-list");

  if (!container) {
    return;
  }

  const cachedFixtures = readCachedFixtures();

  if (cachedFixtures.length) {
    renderFixtures(cachedFixtures);
    setFixturesStatus("Showing saved updates while loading.");
  } else {
    renderFixtureSkeletons();
    setFixturesStatus("Loading latest updates...");
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
    renderFixtures(fixtures);
    setFixturesStatus("Latest fixture updates", "success");
  } catch (error) {
    console.error("Fixture load failed:", error);

    const fallbackFixtures = readCachedFixtures();

    if (fallbackFixtures.length) {
      renderFixtures(fallbackFixtures);
      setFixturesStatus(
        getFixtureStatusMessage(error, true),
        error?.code === "permission-denied" || error?.code === "unauthenticated"
          ? "warning"
          : "error"
      );
      return;
    }

    renderFixtureState(
      "Fixtures unavailable",
      getFixtureErrorMessage(error),
      "Fixture Error"
    );
    setFixturesStatus(getFixtureStatusMessage(error, false), "error");
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

const refreshInterval = getAdaptiveRefreshInterval();

scheduleVisibilityAwareRefresh(loadAnnouncements, { intervalMs: refreshInterval });
scheduleVisibilityAwareRefresh(loadGallery, { intervalMs: refreshInterval });
scheduleVisibilityAwareRefresh(loadVideos, { intervalMs: refreshInterval });
scheduleVisibilityAwareRefresh(loadFixtures, { intervalMs: refreshInterval });
setupHomeGalleryLightbox();
setupMobileMenu();
