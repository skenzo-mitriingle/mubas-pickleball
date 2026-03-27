import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import { auth, db } from "./firebase-config.js";

const ANNOUNCEMENTS_COLLECTION = "announcements";
const ANNOUNCEMENTS_CACHE_KEY = "mubas-pickleball:announcements-cache";

const body = document.body;
const adminIdentity = document.getElementById("admin-identity");
const logoutButton = document.getElementById("logout-button");
const announcementCount = document.getElementById("announcement-count");
const formModeLabel = document.getElementById("form-mode-label");
const syncLabel = document.getElementById("sync-label");
const editingChip = document.getElementById("editing-chip");
const formHeading = document.getElementById("form-heading");
const announcementForm = document.getElementById("announcement-form");
const dateInput = document.getElementById("announcement-date");
const excerptInput = document.getElementById("announcement-excerpt");
const saveButton = document.getElementById("save-button");
const cancelEditButton = document.getElementById("cancel-edit-button");
const formFeedback = document.getElementById("form-feedback");
const listFeedback = document.getElementById("list-feedback");
const emptyState = document.getElementById("empty-state");
const announcementsList = document.getElementById("announcements-list");

let editingAnnouncementId = "";
let isSubmitting = false;
let currentAnnouncements = [];

function setFeedback(element, message, state = "") {
  if (!element) return;

  element.textContent = message;

  if (state) {
    element.dataset.state = state;
  } else {
    delete element.dataset.state;
  }
}

function setFieldError(input, hasError) {
  if (!input) return;

  input.classList.toggle("is-invalid", hasError);
  input.setAttribute("aria-invalid", String(hasError));
}

function clearFieldErrors() {
  [dateInput, excerptInput].forEach((input) => {
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

  if (typeof timestamp.seconds === "number") {
    const nanoseconds = typeof timestamp.nanoseconds === "number"
      ? timestamp.nanoseconds
      : 0;

    return (timestamp.seconds * 1000) + Math.floor(nanoseconds / 1000000);
  }

  return 0;
}

function cacheAnnouncements(items) {
  try {
    const cachePayload = items.map((item) => ({
      id: item.id || "",
      date: item.date || "",
      excerpt: item.excerpt || "",
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

function getFirestoreErrorMessage(error, fallbackMessage) {
  if (error?.code === "permission-denied") {
    return "Firestore rules are blocking this admin account. Allow signed-in users to manage the announcements collection.";
  }

  if (error?.code === "unauthenticated") {
    return "You are signed out for Firestore access. Please log in again.";
  }

  if (error?.code === "deadline-exceeded") {
    return "Firestore did not respond in time. Please check the connection and try again.";
  }

  return fallbackMessage;
}

function formatAnnouncementDate(value) {
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
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "just now";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp.toDate());
}

function updateFormMode() {
  const isEditing = Boolean(editingAnnouncementId);

  if (formModeLabel) {
    formModeLabel.textContent = isEditing ? "Edit" : "Create";
  }

  if (formHeading) {
    formHeading.textContent = isEditing
      ? "Edit selected announcement"
      : "Create a new announcement";
  }

  if (saveButton) {
    saveButton.textContent = isEditing ? "Update announcement" : "Save announcement";
  }

  if (editingChip) {
    editingChip.hidden = !isEditing;
  }

  if (cancelEditButton) {
    cancelEditButton.hidden = !isEditing;
  }
}

function resetForm() {
  editingAnnouncementId = "";
  announcementForm.reset();
  clearFieldErrors();
  updateFormMode();
  renderAnnouncements(currentAnnouncements);
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

function getAnnouncementValues() {
  return {
    date: dateInput.value,
    excerpt: excerptInput.value.trim()
  };
}

function validateAnnouncement(values) {
  clearFieldErrors();

  if (!values.date) {
    setFieldError(dateInput, true);
    setFeedback(formFeedback, "Choose the announcement date.", "error");
    dateInput.focus();
    return false;
  }

  if (!values.excerpt) {
    setFieldError(excerptInput, true);
    setFeedback(formFeedback, "Enter the announcement message.", "error");
    excerptInput.focus();
    return false;
  }

  return true;
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

function renderAnnouncements(items) {
  if (!announcementsList || !emptyState || !announcementCount) return;

  announcementsList.replaceChildren();
  announcementCount.textContent = String(items.length);

  if (!items.length) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "announcement-item";
    card.dataset.id = item.id;

    if (item.id === editingAnnouncementId) {
      card.classList.add("is-editing");
    }

    const topLine = document.createElement("div");
    topLine.className = "item-topline";

    const date = document.createElement("p");
    date.className = "item-date";
    date.textContent = formatAnnouncementDate(item.date);

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

    const excerpt = document.createElement("p");
    excerpt.className = "item-excerpt";
    excerpt.textContent = item.excerpt;

    const meta = document.createElement("p");
    meta.className = "item-meta";
    meta.textContent = `Saved ${formatTimestamp(item.updatedAt || item.createdAt)}`;

    card.append(topLine, excerpt, meta);
    announcementsList.appendChild(card);
  });
}

async function loadAnnouncements(successMessage = "Announcements synced with Firestore.") {
  const hadAnnouncements = currentAnnouncements.length > 0;
  setFeedback(listFeedback, "Loading announcements from Firestore...", "info");
  if (syncLabel) {
    syncLabel.textContent = "Loading";
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

    currentAnnouncements = sortAnnouncements(
      snapshot.docs.map((snapshotDoc) => ({
        id: snapshotDoc.id,
        ...snapshotDoc.data()
      }))
    );

    cacheAnnouncements(currentAnnouncements);
    renderAnnouncements(currentAnnouncements);

    if (syncLabel) {
      syncLabel.textContent = "Live";
    }

    setFeedback(listFeedback, successMessage, "info");
  } catch (error) {
    if (!hadAnnouncements) {
      currentAnnouncements = [];
      renderAnnouncements([]);
    }

    if (syncLabel) {
      syncLabel.textContent = error?.code === "deadline-exceeded" ? "Delayed" : "Error";
    }

    setFeedback(
      listFeedback,
      getFirestoreErrorMessage(error, "Could not load announcements from Firestore."),
      "error"
    );
    console.error(error);
    throw error;
  }
}

function beginEditingAnnouncement(announcementId) {
  const item = currentAnnouncements.find((entry) => entry.id === announcementId);

  if (!item) {
    setFeedback(formFeedback, "That announcement could not be found.", "error");
    return;
  }

  editingAnnouncementId = announcementId;
  dateInput.value = item.date || "";
  excerptInput.value = item.excerpt || "";

  clearFieldErrors();
  updateFormMode();
  renderAnnouncements(currentAnnouncements);
  setFeedback(formFeedback, "Editing announcement. Update the fields and save.", "info");
  excerptInput.focus();
}

async function removeAnnouncement(announcementId, button) {
  const item = currentAnnouncements.find((entry) => entry.id === announcementId);

  if (!item) {
    setFeedback(listFeedback, "That announcement no longer exists.", "error");
    return;
  }

  const confirmed = window.confirm(`Delete "${item.excerpt || "this announcement"}"?`);

  if (!confirmed) {
    return;
  }

  button.disabled = true;
  setFeedback(listFeedback, "Deleting announcement...", "info");

  if (syncLabel) {
    syncLabel.textContent = "Deleting";
  }

  try {
    await withTimeout(
      deleteDoc(doc(db, ANNOUNCEMENTS_COLLECTION, announcementId)),
      "Deleting announcement timed out."
    );
    await loadAnnouncements("Announcement deleted.");

    if (editingAnnouncementId === announcementId) {
      resetForm();
      setFeedback(formFeedback, "Deleted the announcement that was being edited.", "info");
    }

  } catch (error) {
    button.disabled = false;
    setFeedback(
      listFeedback,
      getFirestoreErrorMessage(error, "Delete failed. Please try again."),
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

  const values = getAnnouncementValues();

  if (!validateAnnouncement(values)) {
    return;
  }

  setSubmittingState(true);
  setFeedback(
    formFeedback,
    editingAnnouncementId ? "Updating announcement..." : "Saving announcement...",
    "info"
  );

  if (syncLabel) {
    syncLabel.textContent = editingAnnouncementId ? "Updating" : "Saving";
  }

  try {
    const timestamp = new Date();

    if (editingAnnouncementId) {
      await withTimeout(
        updateDoc(doc(db, ANNOUNCEMENTS_COLLECTION, editingAnnouncementId), {
          title: deleteField(),
          date: values.date,
          excerpt: values.excerpt,
          updatedAt: timestamp
        }),
        "Updating announcement timed out."
      );

      await loadAnnouncements("Announcements synced with Firestore.");
      setFeedback(formFeedback, "Announcement updated successfully.", "success");
    } else {
      await withTimeout(
        addDoc(collection(db, ANNOUNCEMENTS_COLLECTION), {
          date: values.date,
          excerpt: values.excerpt,
          createdAt: timestamp,
          updatedAt: timestamp
        }),
        "Saving announcement timed out."
      );

      await loadAnnouncements("Announcements synced with Firestore.");
      setFeedback(formFeedback, "Announcement saved to Firestore.", "success");
    }

    resetForm();
  } catch (error) {
    setFeedback(
      formFeedback,
      getFirestoreErrorMessage(error, "Saving failed. Please try again."),
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

announcementForm.addEventListener("submit", handleFormSubmit);

cancelEditButton.addEventListener("click", () => {
  resetForm();
  setFeedback(formFeedback, "Edit cancelled. You can create a new announcement now.", "info");
  renderAnnouncements(currentAnnouncements);
});

logoutButton.addEventListener("click", handleLogout);

announcementsList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === "edit") {
    beginEditingAnnouncement(id);
    return;
  }

  if (action === "delete") {
    removeAnnouncement(id, button);
  }
});

updateFormMode();

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

    loadAnnouncements().catch(() => {});
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
