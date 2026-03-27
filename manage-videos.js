import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import { auth, db } from "./firebase-config.js";
import {
  createVideoMediaElement,
  getVideoAction,
  getVideoProviderLabel,
  normalizeVideoSource
} from "./video-utils.js";

const VIDEOS_COLLECTION = "videoItems";
const VIDEOS_CACHE_KEY = "mubas-pickleball:videos-cache";

const body = document.body;
const adminIdentity = document.getElementById("admin-identity");
const logoutButton = document.getElementById("logout-button");
const videoCount = document.getElementById("video-count");
const formModeLabel = document.getElementById("form-mode-label");
const syncLabel = document.getElementById("sync-label");
const editingChip = document.getElementById("editing-chip");
const formHeading = document.getElementById("form-heading");
const videoForm = document.getElementById("video-form");
const titleInput = document.getElementById("video-title");
const dateInput = document.getElementById("video-date");
const urlInput = document.getElementById("video-url");
const descriptionInput = document.getElementById("video-description");
const previewPlayer = document.getElementById("video-preview-player");
const previewMeta = document.getElementById("video-preview-meta");
const saveButton = document.getElementById("save-button");
const cancelEditButton = document.getElementById("cancel-edit-button");
const formFeedback = document.getElementById("form-feedback");
const listFeedback = document.getElementById("list-feedback");
const emptyState = document.getElementById("empty-state");
const videosList = document.getElementById("videos-list");

let editingVideoId = "";
let isSubmitting = false;
let currentVideos = [];

function setFeedback(element, message, state = "") {
  if (!element) {
    return;
  }

  element.textContent = message;

  if (state) {
    element.dataset.state = state;
  } else {
    delete element.dataset.state;
  }
}

function setFieldError(input, hasError) {
  if (!input) {
    return;
  }

  input.classList.toggle("is-invalid", hasError);
  input.setAttribute("aria-invalid", String(hasError));
}

function clearFieldErrors() {
  [titleInput, dateInput, urlInput, descriptionInput].forEach((input) => {
    setFieldError(input, false);
  });
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

function getVideoErrorMessage(error, fallbackMessage) {
  if (error?.code === "permission-denied") {
    return "Firestore rules are blocking this admin account. Allow your admin email to manage the videoItems collection.";
  }

  if (error?.code === "unauthenticated") {
    return "You are signed out for Firestore access. Please log in again.";
  }

  if (error?.code === "failed-precondition") {
    return "This Firestore database is not fully ready yet. Check that you created the correct database and published its rules in the current Firebase project.";
  }

  if (error?.code === "unavailable") {
    return "The app could not reach Firebase. Check your internet connection and confirm the new Firebase project details are correct.";
  }

  if (error?.code === "invalid-argument") {
    return "The app is pointing at an invalid Firebase setup. Recheck firebase-config.js after changing your Firebase project or database.";
  }

  if (error?.code === "deadline-exceeded") {
    return "Firebase did not respond in time. Please check the connection and try again.";
  }

  return fallbackMessage;
}

function formatVideoDate(value) {
  if (!value) {
    return "No date";
  }

  const parsedDate = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(parsedDate);
}

function formatTimestamp(timestamp) {
  const milliseconds = getTimestampMilliseconds(timestamp);

  if (!milliseconds) {
    return "just now";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(milliseconds));
}

function updateFormMode() {
  const isEditing = Boolean(editingVideoId);

  if (formModeLabel) {
    formModeLabel.textContent = isEditing ? "Edit" : "Create";
  }

  if (formHeading) {
    formHeading.textContent = isEditing
      ? "Edit selected video"
      : "Create a new video highlight";
  }

  if (saveButton) {
    saveButton.textContent = isEditing ? "Update video" : "Save video";
  }

  if (editingChip) {
    editingChip.hidden = !isEditing;
  }

  if (cancelEditButton) {
    cancelEditButton.hidden = !isEditing;
  }
}

function renderPreviewPlaceholder(message) {
  if (!previewPlayer || !previewMeta) {
    return;
  }

  const placeholder = document.createElement("div");
  placeholder.className = "video-frame video-frame-fallback";
  placeholder.textContent = message;
  previewPlayer.replaceChildren(placeholder);
}

function updateVideoPreview() {
  if (!previewPlayer || !previewMeta) {
    return;
  }

  const videoUrl = urlInput?.value.trim() || "";
  const videoTitle = titleInput?.value.trim() || "Club video preview";

  if (!videoUrl) {
    renderPreviewPlaceholder("Paste a supported video link to preview it here.");
    previewMeta.textContent = "Supported formats: YouTube, Vimeo, and direct video files.";
    return;
  }

  const normalizedSource = normalizeVideoSource(videoUrl);

  if (!normalizedSource.isValid) {
    renderPreviewPlaceholder("This video link is not supported yet.");
    previewMeta.textContent = normalizedSource.error;
    return;
  }

  const previewItem = {
    title: videoTitle,
    sourceUrl: normalizedSource.sourceUrl,
    embedUrl: normalizedSource.embedUrl,
    provider: normalizedSource.provider
  };
  const media = createVideoMediaElement(previewItem, {
    title: videoTitle
  });

  previewPlayer.replaceChildren(media);
  previewMeta.textContent = `${normalizedSource.providerLabel} preview ready. This is how the video will appear on the site.`;
}

function resetForm() {
  editingVideoId = "";
  videoForm.reset();
  clearFieldErrors();
  updateFormMode();
  updateVideoPreview();
  renderVideos(currentVideos);
}

function setSubmittingState(isBusy) {
  isSubmitting = isBusy;

  if (saveButton) {
    saveButton.disabled = isBusy;
  }

  if (cancelEditButton) {
    cancelEditButton.disabled = isBusy;
  }

  if (logoutButton) {
    logoutButton.disabled = isBusy;
  }
}

function getVideoValues() {
  return {
    title: titleInput.value.trim(),
    date: dateInput.value,
    sourceUrl: urlInput.value.trim(),
    description: descriptionInput.value.trim()
  };
}

function validateVideo(values) {
  clearFieldErrors();

  if (!values.title) {
    setFieldError(titleInput, true);
    setFeedback(formFeedback, "Enter a video title.", "error");
    titleInput.focus();
    return null;
  }

  if (!values.date) {
    setFieldError(dateInput, true);
    setFeedback(formFeedback, "Choose the video date.", "error");
    dateInput.focus();
    return null;
  }

  if (!values.sourceUrl) {
    setFieldError(urlInput, true);
    setFeedback(formFeedback, "Paste the video link.", "error");
    urlInput.focus();
    return null;
  }

  const normalizedSource = normalizeVideoSource(values.sourceUrl);

  if (!normalizedSource.isValid) {
    setFieldError(urlInput, true);
    setFeedback(formFeedback, normalizedSource.error, "error");
    urlInput.focus();
    return null;
  }

  if (!values.description) {
    setFieldError(descriptionInput, true);
    setFeedback(formFeedback, "Enter the video description.", "error");
    descriptionInput.focus();
    return null;
  }

  return normalizedSource;
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

function renderVideos(items) {
  if (!videosList || !emptyState || !videoCount) {
    return;
  }

  videosList.replaceChildren();
  videoCount.textContent = String(items.length);

  if (!items.length) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  items.forEach((item) => {
    const action = getVideoAction(item);
    const card = document.createElement("article");
    card.className = "announcement-item video-item";
    card.dataset.id = item.id;

    if (item.id === editingVideoId) {
      card.classList.add("is-editing");
    }

    const mediaWrap = document.createElement("div");
    mediaWrap.className = "video-item-media";
    mediaWrap.appendChild(createVideoMediaElement(item, {
      title: item.title || "Club video"
    }));

    const copy = document.createElement("div");
    copy.className = "video-item-copy";

    const topLine = document.createElement("div");
    topLine.className = "item-topline";

    const date = document.createElement("p");
    date.className = "item-date";
    date.textContent = formatVideoDate(item.date);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const editButton = document.createElement("button");
    editButton.className = "item-button";
    editButton.type = "button";
    editButton.dataset.action = "edit";
    editButton.dataset.id = item.id;
    editButton.textContent = "Edit";

    const deleteButton = document.createElement("button");
    deleteButton.className = "item-button item-button-danger";
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.id = item.id;
    deleteButton.textContent = "Delete";

    actions.append(editButton, deleteButton);
    topLine.append(date, actions);

    const provider = document.createElement("p");
    provider.className = "video-item-provider";
    provider.textContent = getVideoProviderLabel(item.provider);

    const title = document.createElement("h3");
    title.className = "item-title";
    title.textContent = item.title || "Untitled video";

    const description = document.createElement("p");
    description.className = "video-item-description";
    description.textContent = item.description || "More details for this club video will be shared soon.";

    const meta = document.createElement("p");
    meta.className = "item-meta";
    meta.textContent = `Saved ${formatTimestamp(item.updatedAt || item.createdAt)}`;

    copy.append(topLine, provider, title, description, meta);

    if (action.href) {
      const actionRow = document.createElement("div");
      actionRow.className = "video-item-actions-row";

      const link = document.createElement("a");
      link.className = "video-item-link";
      link.href = action.href;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = action.label;

      actionRow.appendChild(link);
      copy.appendChild(actionRow);
    }

    card.append(mediaWrap, copy);
    videosList.appendChild(card);
  });
}

async function loadVideos(successMessage = "Videos synced with Firestore.") {
  const cachedVideos = readCachedVideos();
  const hadVideos = currentVideos.length > 0 || cachedVideos.length > 0;

  if (cachedVideos.length) {
    currentVideos = sortVideos(cachedVideos);
    renderVideos(currentVideos);
    setFeedback(listFeedback, "Showing a saved browser copy while Firestore connects.", "info");
  } else {
    setFeedback(listFeedback, "Loading videos from Firestore...", "info");
  }

  if (syncLabel) {
    syncLabel.textContent = "Loading";
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

    currentVideos = sortVideos(
      snapshot.docs.map((snapshotDoc) => ({
        id: snapshotDoc.id,
        ...snapshotDoc.data()
      }))
    );

    cacheVideos(currentVideos);
    renderVideos(currentVideos);

    if (syncLabel) {
      syncLabel.textContent = "Live";
    }

    setFeedback(listFeedback, successMessage, "info");
  } catch (error) {
    if (!hadVideos) {
      currentVideos = [];
      renderVideos([]);
    } else if (cachedVideos.length) {
      currentVideos = sortVideos(cachedVideos);
      renderVideos(currentVideos);
    }

    if (syncLabel) {
      syncLabel.textContent = error?.code === "deadline-exceeded" ? "Delayed" : "Error";
    }

    setFeedback(
      listFeedback,
      getVideoErrorMessage(error, "Could not load videos from Firestore."),
      "error"
    );
    console.error(error);
    throw error;
  }
}

function beginEditingVideo(videoId) {
  const item = currentVideos.find((entry) => entry.id === videoId);

  if (!item) {
    setFeedback(formFeedback, "That video could not be found.", "error");
    return;
  }

  editingVideoId = videoId;
  titleInput.value = item.title || "";
  dateInput.value = item.date || "";
  urlInput.value = item.sourceUrl || "";
  descriptionInput.value = item.description || "";

  clearFieldErrors();
  updateFormMode();
  updateVideoPreview();
  renderVideos(currentVideos);
  setFeedback(formFeedback, "Editing video. Update the fields and save.", "info");
  titleInput.focus();
}

async function removeVideo(videoId, button) {
  const item = currentVideos.find((entry) => entry.id === videoId);

  if (!item) {
    setFeedback(listFeedback, "That video no longer exists.", "error");
    return;
  }

  const confirmed = window.confirm(`Delete "${item.title}"?`);

  if (!confirmed) {
    return;
  }

  button.disabled = true;
  setFeedback(listFeedback, "Deleting video...", "info");

  if (syncLabel) {
    syncLabel.textContent = "Deleting";
  }

  try {
    await withTimeout(
      deleteDoc(doc(db, VIDEOS_COLLECTION, videoId)),
      "Deleting video timed out."
    );
    await loadVideos("Video deleted.");

    if (editingVideoId === videoId) {
      resetForm();
      setFeedback(formFeedback, "Deleted the video that was being edited.", "info");
    }
  } catch (error) {
    button.disabled = false;
    setFeedback(
      listFeedback,
      getVideoErrorMessage(error, "Delete failed. Please try again."),
      "error"
    );

    if (syncLabel) {
      syncLabel.textContent = "Error";
    }

    console.error(error);
  }
}

async function handleFormSubmit(event) {
  event.preventDefault();

  if (isSubmitting) {
    return;
  }

  const values = getVideoValues();
  const normalizedSource = validateVideo(values);

  if (!normalizedSource) {
    return;
  }

  setSubmittingState(true);
  setFeedback(
    formFeedback,
    editingVideoId ? "Updating video..." : "Saving video...",
    "info"
  );

  if (syncLabel) {
    syncLabel.textContent = editingVideoId ? "Updating" : "Saving";
  }

  try {
    const timestamp = new Date();
    const videoPayload = {
      title: values.title,
      date: values.date,
      description: values.description,
      sourceUrl: normalizedSource.sourceUrl,
      embedUrl: normalizedSource.embedUrl,
      provider: normalizedSource.provider,
      updatedAt: timestamp
    };

    if (editingVideoId) {
      await withTimeout(
        updateDoc(doc(db, VIDEOS_COLLECTION, editingVideoId), videoPayload),
        "Updating video timed out."
      );

      await loadVideos("Videos synced with Firestore.");
      setFeedback(formFeedback, "Video updated successfully.", "success");
    } else {
      await withTimeout(
        addDoc(collection(db, VIDEOS_COLLECTION), {
          ...videoPayload,
          createdAt: timestamp
        }),
        "Saving video timed out."
      );

      await loadVideos("Videos synced with Firestore.");
      setFeedback(formFeedback, "Video saved to Firestore.", "success");
    }

    resetForm();
  } catch (error) {
    setFeedback(
      formFeedback,
      getVideoErrorMessage(error, "Saving failed. Please try again."),
      "error"
    );

    if (syncLabel) {
      syncLabel.textContent = "Error";
    }

    console.error(error);
  } finally {
    setSubmittingState(false);
  }
}

async function handleLogout() {
  setFeedback(formFeedback, "Signing out...", "info");
  setSubmittingState(true);

  try {
    await signOut(auth);
    window.location.href = "admin-login.html";
  } catch (error) {
    setSubmittingState(false);
    setFeedback(formFeedback, "Sign out failed. Please try again.", "error");
    console.error(error);
  }
}

videoForm.addEventListener("submit", handleFormSubmit);
cancelEditButton.addEventListener("click", () => {
  resetForm();
  setFeedback(formFeedback, "Edit cancelled. You can create a new video now.", "info");
});
logoutButton.addEventListener("click", handleLogout);
urlInput.addEventListener("input", updateVideoPreview);
titleInput.addEventListener("input", updateVideoPreview);

videosList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === "edit") {
    beginEditingVideo(id);
    return;
  }

  if (action === "delete") {
    removeVideo(id, button);
  }
});

updateFormMode();
updateVideoPreview();

onAuthStateChanged(
  auth,
  (user) => {
    if (!user) {
      body.dataset.authState = "guest";

      if (adminIdentity) {
        adminIdentity.textContent = "No active admin session";
      }

      if (syncLabel) {
        syncLabel.textContent = "Redirecting...";
      }

      setFeedback(formFeedback, "Admin access is required. Redirecting to login...", "error");

      window.setTimeout(() => {
        window.location.href = "admin-login.html";
      }, 700);

      return;
    }

    body.dataset.authState = "ready";

    if (adminIdentity) {
      adminIdentity.textContent = user.email || "Authenticated admin";
    }

    if (syncLabel) {
      syncLabel.textContent = "Loading";
    }

    loadVideos().catch(() => {});
  },
  (error) => {
    body.dataset.authState = "guest";

    if (adminIdentity) {
      adminIdentity.textContent = "Authentication error";
    }

    if (syncLabel) {
      syncLabel.textContent = "Error";
    }

    setFeedback(formFeedback, "Authentication could not be verified. Redirecting...", "error");
    console.error(error);

    window.setTimeout(() => {
      window.location.href = "admin-login.html";
    }, 900);
  }
);
