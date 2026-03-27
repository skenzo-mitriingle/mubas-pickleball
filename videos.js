import {
  collection,
  getDocs,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import { db } from "./firebase-config.js";
import {
  createVideoMediaElement,
  getVideoAction
} from "./video-utils.js";

const VIDEOS_COLLECTION = "videoItems";
const VIDEOS_CACHE_KEY = "mubas-pickleball:videos-cache";

function setArchiveStatus(message, state = "") {
  const status = document.getElementById("videos-archive-status");

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

    window.localStorage.setItem(VIDEOS_CACHE_KEY, JSON.stringify(cachePayload));
  } catch (error) {
    console.warn("Could not cache videos locally.", error);
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

function updateVideoStats(items) {
  const total = document.getElementById("video-total");

  if (total) {
    total.textContent = String(items.length);
  }
}

function renderFeaturedPlaceholder(container) {
  if (!container) {
    return;
  }

  const placeholder = document.createElement("div");
  placeholder.className = "video-frame video-frame-fallback";
  placeholder.textContent = "The latest video will appear here once it is published.";
  container.replaceChildren(placeholder);
}

function renderFeaturedVideo(item) {
  const featuredPlayer = document.getElementById("featured-video-player");
  const featuredDate = document.getElementById("featured-video-date");
  const featuredTitle = document.getElementById("featured-video-title");
  const featuredDescription = document.getElementById("featured-video-description");
  const featuredMeta = document.getElementById("featured-video-meta");
  const featuredLink = document.getElementById("featured-video-link");

  if (
    !featuredPlayer ||
    !featuredDate ||
    !featuredTitle ||
    !featuredDescription ||
    !featuredMeta ||
    !featuredLink
  ) {
    return;
  }

  if (!item) {
    renderFeaturedPlaceholder(featuredPlayer);
    featuredDate.textContent = "No videos yet";
    featuredTitle.textContent = "The archive is ready for the first video";
    featuredDescription.textContent = "When the club publishes a new highlight or training clip, it will appear here and in the archive below.";
    featuredMeta.textContent = "Latest video spotlight will update automatically.";
    featuredLink.hidden = true;
    featuredLink.removeAttribute("href");
    return;
  }

  const action = getVideoAction(item);
  const featuredMedia = createVideoMediaElement(item, {
    title: item.title || item.description || "Featured club video"
  });

  featuredPlayer.replaceChildren(featuredMedia);
  featuredDate.textContent = formatVideoDate(item.date, item.createdAt);
  featuredTitle.textContent = item.title || "Latest video highlight";
  featuredDescription.textContent = item.description || "More details for this club video will be shared soon.";
  featuredMeta.textContent = `Last updated ${formatTimestamp(item.updatedAt || item.createdAt)}`;
  featuredLink.hidden = !action.href;

  if (action.href) {
    featuredLink.href = action.href;
    featuredLink.textContent = action.label;
  }
}

function renderArchiveState(title, message, kicker = "Video Archive") {
  const container = document.getElementById("videos-archive-grid");

  if (!container) {
    return;
  }

  const card = document.createElement("article");
  card.className = "glass-card video-empty-card";

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

function renderVideoArchive(items) {
  const container = document.getElementById("videos-archive-grid");

  if (!container) {
    return;
  }

  const sortedVideos = sortVideos(items).filter((item) => item.sourceUrl || item.embedUrl);
  updateVideoStats(sortedVideos);
  renderFeaturedVideo(sortedVideos[0]);

  if (!sortedVideos.length) {
    renderArchiveState(
      "No videos yet",
      "The club has not published any video highlights yet. Check back soon for the first upload."
    );
    return;
  }

  container.replaceChildren();

  sortedVideos.forEach((item) => {
    const card = document.createElement("article");
    card.className = "glass-card video-archive-card";

    const media = createVideoMediaElement(item, {
      title: item.title || item.description || "Club video"
    });

    const copy = document.createElement("div");
    copy.className = "video-archive-copy";

    const date = document.createElement("p");
    date.className = "card-date";
    date.textContent = formatVideoDate(item.date, item.createdAt);
    copy.appendChild(date);

    card.append(media, copy);
    container.appendChild(card);
  });
}

async function loadVideos() {
  const cachedVideos = readCachedVideos();

  if (cachedVideos.length) {
    renderVideoArchive(cachedVideos);
    setArchiveStatus("Showing saved updates while loading.");
  } else {
    renderFeaturedVideo();
    updateVideoStats([]);
    renderArchiveState(
      "Loading videos...",
      "Fetching the latest club highlights.",
      "Videos"
    );
    setArchiveStatus("Loading latest updates...");
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
    renderVideoArchive(videos);
    setArchiveStatus("Latest video updates", "success");
  } catch (error) {
    console.error("Video archive load failed:", error);

    const fallbackVideos = readCachedVideos();

    if (fallbackVideos.length) {
      renderVideoArchive(fallbackVideos);
      setArchiveStatus(
        getVideoStatusMessage(error, true),
        error?.code === "permission-denied" || error?.code === "unauthenticated"
          ? "warning"
          : "error"
      );
      return;
    }

    renderFeaturedVideo();
    updateVideoStats([]);
    renderArchiveState(
      "Videos unavailable",
      getVideoErrorMessage(error),
      "Archive Error"
    );
    setArchiveStatus(getVideoStatusMessage(error, false), "error");
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

loadVideos();
window.setInterval(loadVideos, 60000);
setupMobileMenu();
