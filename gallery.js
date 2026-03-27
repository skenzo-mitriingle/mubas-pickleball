import {
  collection,
  getDocs,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import { db } from "./firebase-config.js";

const GALLERY_COLLECTION = "galleryItems";
const GALLERY_CACHE_KEY = "mubas-pickleball:gallery-cache";
const featuredGalleryTrigger = document.getElementById("featured-gallery-trigger");
const galleryLightbox = document.getElementById("gallery-lightbox");
const galleryLightboxClose = document.getElementById("gallery-lightbox-close");
const galleryLightboxDismiss = document.getElementById("gallery-lightbox-dismiss");
const galleryLightboxPrev = document.getElementById("gallery-lightbox-prev");
const galleryLightboxNext = document.getElementById("gallery-lightbox-next");
const galleryLightboxSave = document.getElementById("gallery-lightbox-save");
const galleryLightboxImage = document.getElementById("gallery-lightbox-image");
const galleryLightboxDate = document.getElementById("gallery-lightbox-date");
const galleryLightboxTitle = document.getElementById("gallery-lightbox-title");
const galleryLightboxCaption = document.getElementById("gallery-lightbox-caption");
const galleryLightboxMeta = document.getElementById("gallery-lightbox-meta");

let featuredGalleryItem = null;
let activeLightboxItem = null;
let lastFocusedElement = null;
let currentGalleryItems = [];

function setGalleryStatus(message, state = "") {
  const status = document.getElementById("gallery-archive-status");

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

function cacheGalleryItems(items) {
  try {
    const cachePayload = items.map((item) => ({
      id: item.id || "",
      title: item.title || "",
      date: item.date || "",
      caption: item.caption || "",
      imageUrl: item.imageUrl || "",
      storagePath: item.storagePath || "",
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
      title: typeof item.title === "string" ? item.title : "",
      date: typeof item.date === "string" ? item.date : "",
      caption: typeof item.caption === "string" ? item.caption : "",
      imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : "",
      storagePath: typeof item.storagePath === "string" ? item.storagePath : "",
      createdAt: getTimestampMilliseconds(item.createdAtMs),
      updatedAt: getTimestampMilliseconds(item.updatedAtMs)
    })).filter((item) => item.imageUrl);
  } catch (error) {
    console.warn("Could not read cached gallery items.", error);
    return [];
  }
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

function updateGalleryStats(items) {
  const total = document.getElementById("gallery-total");

  if (total) {
    total.textContent = String(items.length);
  }
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
  const baseName = (item?.title || "mubas-gallery-image")
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
    && entry.title === item.title
    && entry.date === item.date
  ));
}

function updateGalleryLightboxNavigationState() {
  const hasMultipleItems = currentGalleryItems.length > 1;

  if (galleryLightboxPrev) {
    galleryLightboxPrev.hidden = !hasMultipleItems;
    galleryLightboxPrev.disabled = !hasMultipleItems;
    galleryLightboxPrev.setAttribute("aria-label", "Show previous image");
  }

  if (galleryLightboxNext) {
    galleryLightboxNext.hidden = !hasMultipleItems;
    galleryLightboxNext.disabled = !hasMultipleItems;
    galleryLightboxNext.setAttribute("aria-label", "Show next image");
  }

  if (!hasMultipleItems || !activeLightboxItem) {
    return;
  }

  const currentIndex = findGalleryItemIndex(currentGalleryItems, activeLightboxItem);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  const previousItem = currentGalleryItems[
    (safeIndex - 1 + currentGalleryItems.length) % currentGalleryItems.length
  ];
  const nextItem = currentGalleryItems[
    (safeIndex + 1) % currentGalleryItems.length
  ];

  if (galleryLightboxPrev && previousItem) {
    galleryLightboxPrev.setAttribute(
      "aria-label",
      `Show previous image: ${previousItem.title || "Gallery image"}`
    );
  }

  if (galleryLightboxNext && nextItem) {
    galleryLightboxNext.setAttribute(
      "aria-label",
      `Show next image: ${nextItem.title || "Gallery image"}`
    );
  }
}

function setFeaturedTriggerState(item) {
  featuredGalleryItem = item?.imageUrl ? item : null;

  if (!featuredGalleryTrigger) {
    return;
  }

  featuredGalleryTrigger.disabled = !featuredGalleryItem;
  featuredGalleryTrigger.setAttribute(
    "aria-label",
    featuredGalleryItem
      ? `Open full image: ${featuredGalleryItem.title || "Featured gallery image"}`
      : "Open featured gallery image"
  );
}

function renderGalleryLightboxItem(item) {
  if (
    !item ||
    !item.imageUrl ||
    !galleryLightbox ||
    !galleryLightboxImage ||
    !galleryLightboxDate ||
    !galleryLightboxTitle ||
    !galleryLightboxCaption ||
    !galleryLightboxMeta
  ) {
    return;
  }

  activeLightboxItem = item;
  galleryLightboxImage.src = item.imageUrl;
  galleryLightboxImage.alt = item.title || "Full gallery image";
  galleryLightboxDate.textContent = formatGalleryDate(item.date, item.createdAt);
  galleryLightboxTitle.textContent = item.title || "Untitled gallery image";
  galleryLightboxCaption.textContent = item.caption || "More details for this club moment will be shared soon.";
  galleryLightboxMeta.textContent = `Updated ${formatTimestamp(item.updatedAt || item.createdAt)}`;
  updateGalleryLightboxNavigationState();
}

function openGalleryLightbox(item) {
  if (!item || !item.imageUrl || !galleryLightbox) {
    return;
  }

  lastFocusedElement = document.activeElement;
  renderGalleryLightboxItem(item);
  galleryLightbox.hidden = false;
  document.body.classList.add("is-lightbox-open");
  window.setTimeout(() => {
    galleryLightboxClose?.focus();
  }, 0);
}

function stepGalleryLightbox(direction) {
  if (!activeLightboxItem || currentGalleryItems.length < 2) {
    return;
  }

  const currentIndex = findGalleryItemIndex(currentGalleryItems, activeLightboxItem);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = (
    safeIndex + direction + currentGalleryItems.length
  ) % currentGalleryItems.length;

  renderGalleryLightboxItem(currentGalleryItems[nextIndex]);
}

function closeGalleryLightbox() {
  if (!galleryLightbox || galleryLightbox.hidden) {
    return;
  }

  galleryLightbox.hidden = true;
  document.body.classList.remove("is-lightbox-open");
  galleryLightboxImage?.removeAttribute("src");
  activeLightboxItem = null;

  if (lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
}

async function saveActiveGalleryImage() {
  if (!activeLightboxItem?.imageUrl || !galleryLightboxSave) {
    return;
  }

  const saveLabel = galleryLightboxSave.textContent;
  galleryLightboxSave.disabled = true;
  galleryLightboxSave.textContent = "Saving...";

  try {
    const response = await fetch(activeLightboxItem.imageUrl, { mode: "cors" });

    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");

    downloadLink.href = objectUrl;
    downloadLink.download = buildDownloadFileName(activeLightboxItem);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    URL.revokeObjectURL(objectUrl);
    galleryLightboxSave.textContent = "Saved";
  } catch (error) {
    window.open(activeLightboxItem.imageUrl, "_blank", "noopener");
    galleryLightboxSave.textContent = "Opened In New Tab";
  }

  window.setTimeout(() => {
    galleryLightboxSave.disabled = false;
    galleryLightboxSave.textContent = saveLabel;
  }, 1200);
}

function setupGalleryLightbox() {
  if (!galleryLightbox) {
    return;
  }

  featuredGalleryTrigger?.addEventListener("click", () => {
    if (featuredGalleryItem) {
      openGalleryLightbox(featuredGalleryItem);
    }
  });

  galleryLightboxClose?.addEventListener("click", closeGalleryLightbox);
  galleryLightboxDismiss?.addEventListener("click", closeGalleryLightbox);
  galleryLightboxPrev?.addEventListener("click", () => {
    stepGalleryLightbox(-1);
  });
  galleryLightboxNext?.addEventListener("click", () => {
    stepGalleryLightbox(1);
  });
  galleryLightboxSave?.addEventListener("click", saveActiveGalleryImage);

  galleryLightbox.addEventListener("click", (event) => {
    const closeTrigger = event.target.closest("[data-lightbox-close]");

    if (closeTrigger) {
      closeGalleryLightbox();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!galleryLightbox || galleryLightbox.hidden) {
      return;
    }

    if (event.key === "Escape") {
      closeGalleryLightbox();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepGalleryLightbox(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      stepGalleryLightbox(1);
    }
  });
}

function renderFeaturedGalleryItem(item) {
  const featuredImage = document.getElementById("featured-gallery-image");
  const featuredEmpty = document.getElementById("featured-gallery-empty");
  const featuredDate = document.getElementById("featured-gallery-date");
  const featuredTitle = document.getElementById("featured-gallery-title");
  const featuredCaption = document.getElementById("featured-gallery-caption");
  const featuredMeta = document.getElementById("featured-gallery-meta");

  if (
    !featuredImage ||
    !featuredEmpty ||
    !featuredDate ||
    !featuredTitle ||
    !featuredCaption ||
    !featuredMeta
  ) {
    return;
  }

  if (!item || !item.imageUrl) {
    setFeaturedTriggerState(null);
    featuredImage.hidden = true;
    featuredImage.removeAttribute("src");
    featuredImage.alt = "";
    featuredEmpty.hidden = false;
    featuredEmpty.textContent = "No featured photo yet.";
    featuredDate.textContent = "No photos yet";
    featuredTitle.textContent = "The gallery is ready for the first image";
    featuredCaption.textContent = "When the club uploads a new photo, it will appear here and in the full archive below.";
    featuredMeta.textContent = "Latest spotlight will update automatically.";
    return;
  }

  setFeaturedTriggerState(item);
  featuredImage.src = item.imageUrl;
  featuredImage.alt = item.title || "Featured gallery image";
  featuredImage.hidden = false;
  featuredEmpty.hidden = true;
  featuredDate.textContent = formatGalleryDate(item.date, item.createdAt);
  featuredTitle.textContent = item.title || "Untitled gallery item";
  featuredCaption.textContent = item.caption || "More context for this gallery image will be shared soon.";
  featuredMeta.textContent = `Last updated ${formatTimestamp(item.updatedAt || item.createdAt)}`;
}

function renderGalleryState(title, message, kicker = "Gallery") {
  const container = document.getElementById("gallery-archive-grid");

  if (!container) {
    return;
  }

  currentGalleryItems = [];
  updateGalleryLightboxNavigationState();

  const card = document.createElement("article");
  card.className = "glass-card gallery-empty-card";

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

function renderGalleryArchive(items) {
  const container = document.getElementById("gallery-archive-grid");

  if (!container) {
    return;
  }

  const sortedItems = sortGalleryItems(items).filter((item) => item.imageUrl);
  currentGalleryItems = sortedItems;
  updateGalleryStats(sortedItems);
  renderFeaturedGalleryItem(sortedItems[0]);

  if (!sortedItems.length) {
    renderGalleryState(
      "No gallery images yet",
      "The club has not uploaded any gallery photos yet. Check back soon for the first image."
    );
    return;
  }

  container.replaceChildren();

  sortedItems.forEach((item) => {
    const card = document.createElement("article");
    card.className = "glass-card gallery-archive-card";

    const media = document.createElement("div");
    media.className = "gallery-archive-media";

    const mediaButton = document.createElement("button");
    mediaButton.className = "gallery-image-button";
    mediaButton.type = "button";
    mediaButton.setAttribute(
      "aria-label",
      `Open full image: ${item.title || "Gallery image"}`
    );

    const image = document.createElement("img");
    image.src = item.imageUrl;
    image.alt = item.title || "Gallery image";
    image.loading = "lazy";

    const overlay = document.createElement("span");
    overlay.className = "gallery-card-overlay";

    const overlayLabel = document.createElement("span");
    overlayLabel.className = "gallery-card-overlay-label";
    overlayLabel.textContent = "View full image";

    overlay.appendChild(overlayLabel);
    mediaButton.append(image, overlay);
    mediaButton.addEventListener("click", () => {
      openGalleryLightbox(item);
    });
    media.appendChild(mediaButton);

    const copy = document.createElement("div");
    copy.className = "gallery-archive-copy";

    const date = document.createElement("p");
    date.className = "card-date";
    date.textContent = formatGalleryDate(item.date, item.createdAt);

    const title = document.createElement("h3");
    title.className = "gallery-archive-title";
    title.textContent = item.title || "Untitled gallery item";

    const caption = document.createElement("p");
    caption.className = "gallery-archive-text";
    caption.textContent = item.caption || "More details for this club moment will be shared soon.";

    const meta = document.createElement("p");
    meta.className = "gallery-archive-meta";
    meta.textContent = `Updated ${formatTimestamp(item.updatedAt || item.createdAt)}`;

    copy.append(date, title, caption, meta);
    card.append(media, copy);
    container.appendChild(card);
  });

  if (!galleryLightbox?.hidden && activeLightboxItem) {
    const matchingActiveItem = currentGalleryItems.find((item) => (
      item.id === activeLightboxItem.id
      || (
        item.imageUrl === activeLightboxItem.imageUrl
        && item.title === activeLightboxItem.title
        && item.date === activeLightboxItem.date
      )
    ));

    if (matchingActiveItem) {
      renderGalleryLightboxItem(matchingActiveItem);
    } else {
      closeGalleryLightbox();
    }
  }
}

async function loadGallery() {
  const cachedItems = readCachedGalleryItems();

  if (cachedItems.length) {
    renderGalleryArchive(cachedItems);
    setGalleryStatus("Showing a saved browser copy while Firebase connects.");
  } else {
    renderFeaturedGalleryItem();
    updateGalleryStats([]);
    renderGalleryState(
      "Loading gallery...",
      "Fetching the latest club photos from Firebase.",
      "Live Gallery"
    );
    setGalleryStatus("Connecting to Firebase...");
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
    renderGalleryArchive(galleryItems);
    setGalleryStatus("Live gallery from Firebase.", "success");
  } catch (error) {
    console.error("Gallery load failed:", error);

    const fallbackItems = readCachedGalleryItems();

    if (fallbackItems.length) {
      renderGalleryArchive(fallbackItems);
      setGalleryStatus(
        getGalleryStatusMessage(error, true),
        error?.code === "permission-denied" || error?.code === "unauthenticated"
          ? "warning"
          : "error"
      );
      return;
    }

    renderFeaturedGalleryItem();
    updateGalleryStats([]);
    renderGalleryState(
      "Gallery unavailable",
      getGalleryErrorMessage(error),
      "Gallery Error"
    );
    setGalleryStatus(getGalleryStatusMessage(error, false), "error");
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

setupGalleryLightbox();
loadGallery();
window.setInterval(loadGallery, 60000);
setupMobileMenu();
