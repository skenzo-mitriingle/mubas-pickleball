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

const FIXTURES_COLLECTION = "fixtureItems";
const FIXTURES_CACHE_KEY = "mubas-pickleball:fixtures-cache";
const HOME_TEAM_NAME = "Mubas Pickleball";

const body = document.body;
const adminIdentity = document.getElementById("admin-identity");
const logoutButton = document.getElementById("logout-button");
const fixtureCount = document.getElementById("fixture-count");
const formModeLabel = document.getElementById("form-mode-label");
const syncLabel = document.getElementById("sync-label");
const editingChip = document.getElementById("editing-chip");
const formHeading = document.getElementById("form-heading");
const fixtureForm = document.getElementById("fixture-form");
const opponentInput = document.getElementById("fixture-opponent");
const dateInput = document.getElementById("fixture-date");
const venueInput = document.getElementById("fixture-venue");
const statusInput = document.getElementById("fixture-status");
const detailsInput = document.getElementById("fixture-details");
const detailsLabel = document.getElementById("fixture-details-label");
const detailsHelper = document.getElementById("fixture-details-helper");
const saveButton = document.getElementById("save-button");
const cancelEditButton = document.getElementById("cancel-edit-button");
const formFeedback = document.getElementById("form-feedback");
const listFeedback = document.getElementById("list-feedback");
const emptyState = document.getElementById("empty-state");
const fixturesList = document.getElementById("fixtures-list");

let editingFixtureId = "";
let isSubmitting = false;
let currentFixtures = [];

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
  [opponentInput, dateInput, venueInput, statusInput, detailsInput].forEach((input) => {
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

function getFixtureErrorMessage(error, fallbackMessage) {
  if (error?.code === "permission-denied") {
    return "Firestore rules are blocking this admin account. Allow your admin email to manage the fixtureItems collection.";
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

function normalizeFixtureStatus(status) {
  return status === "completed" ? "completed" : "upcoming";
}

function formatFixtureDate(value) {
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

function getFixtureSortDate(item) {
  if (item?.date) {
    const parsedDate = Date.parse(`${item.date}T00:00:00`);

    if (!Number.isNaN(parsedDate)) {
      return parsedDate;
    }
  }

  return getTimestampMilliseconds(item?.updatedAt || item?.createdAt) || 0;
}

function sortFixtures(items) {
  const normalizedFixtures = items.map((item) => ({
    ...item,
    status: normalizeFixtureStatus(item.status)
  }));
  const upcomingFixtures = normalizedFixtures
    .filter((item) => item.status === "upcoming")
    .sort((left, right) => {
      const leftDate = getFixtureSortDate(left);
      const rightDate = getFixtureSortDate(right);

      if (leftDate !== rightDate) {
        return leftDate - rightDate;
      }

      const leftUpdated = getTimestampMilliseconds(left.updatedAt || left.createdAt);
      const rightUpdated = getTimestampMilliseconds(right.updatedAt || right.createdAt);
      return rightUpdated - leftUpdated;
    });
  const completedFixtures = normalizedFixtures
    .filter((item) => item.status === "completed")
    .sort((left, right) => {
      const leftDate = getFixtureSortDate(left);
      const rightDate = getFixtureSortDate(right);

      if (rightDate !== leftDate) {
        return rightDate - leftDate;
      }

      const leftUpdated = getTimestampMilliseconds(left.updatedAt || left.createdAt);
      const rightUpdated = getTimestampMilliseconds(right.updatedAt || right.createdAt);
      return rightUpdated - leftUpdated;
    });

  return [...upcomingFixtures, ...completedFixtures];
}

function getFixtureHeadline(item) {
  return `${HOME_TEAM_NAME} vs ${item?.opponent || "Opponent TBD"}`;
}

function syncDetailsFieldCopy() {
  const normalizedStatus = normalizeFixtureStatus(statusInput?.value);

  if (detailsLabel) {
    detailsLabel.textContent = normalizedStatus === "completed"
      ? "Result / Notes"
      : "Match Notes";
  }

  if (detailsInput) {
    detailsInput.placeholder = normalizedStatus === "completed"
      ? "Add the result, short recap, or important completed-match note"
      : "Add schedule reminders, special instructions, or pre-match notes";
  }

  if (detailsHelper) {
    detailsHelper.textContent = normalizedStatus === "completed"
      ? "Use this field for the final result, recap note, or anything supporters should know after the match."
      : "Use this field for reminders before the match, time updates, or extra fixture details.";
  }
}

function updateFormMode() {
  const isEditing = Boolean(editingFixtureId);

  if (formModeLabel) {
    formModeLabel.textContent = isEditing ? "Edit" : "Create";
  }

  if (formHeading) {
    formHeading.textContent = isEditing
      ? "Edit selected fixture"
      : "Create a new fixture";
  }

  if (saveButton) {
    saveButton.textContent = isEditing ? "Update fixture" : "Save fixture";
  }

  if (editingChip) {
    editingChip.hidden = !isEditing;
  }

  if (cancelEditButton) {
    cancelEditButton.hidden = !isEditing;
  }
}

function resetForm() {
  editingFixtureId = "";
  fixtureForm.reset();

  if (statusInput) {
    statusInput.value = "upcoming";
  }

  clearFieldErrors();
  updateFormMode();
  syncDetailsFieldCopy();
  renderFixtures(currentFixtures);
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

function getFixtureValues() {
  return {
    opponent: opponentInput.value.trim(),
    date: dateInput.value,
    venue: venueInput.value.trim(),
    status: normalizeFixtureStatus(statusInput.value),
    details: detailsInput.value.trim()
  };
}

function validateFixture(values) {
  clearFieldErrors();

  if (!values.opponent) {
    setFieldError(opponentInput, true);
    setFeedback(formFeedback, "Enter the opponent name.", "error");
    opponentInput.focus();
    return false;
  }

  if (!values.date) {
    setFieldError(dateInput, true);
    setFeedback(formFeedback, "Choose the fixture date.", "error");
    dateInput.focus();
    return false;
  }

  if (!values.venue) {
    setFieldError(venueInput, true);
    setFeedback(formFeedback, "Enter the venue.", "error");
    venueInput.focus();
    return false;
  }

  if (!values.status) {
    setFieldError(statusInput, true);
    setFeedback(formFeedback, "Choose whether the fixture is upcoming or completed.", "error");
    statusInput.focus();
    return false;
  }

  return true;
}

function renderFixtures(items) {
  if (!fixturesList || !emptyState || !fixtureCount) {
    return;
  }

  fixturesList.replaceChildren();
  fixtureCount.textContent = String(items.length);

  if (!items.length) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  items.forEach((item) => {
    const normalizedStatus = normalizeFixtureStatus(item.status);
    const card = document.createElement("article");
    card.className = "announcement-item fixture-item";
    card.dataset.id = item.id;

    if (item.id === editingFixtureId) {
      card.classList.add("is-editing");
    }

    const topLine = document.createElement("div");
    topLine.className = "item-topline";

    const date = document.createElement("p");
    date.className = "item-date";
    date.textContent = formatFixtureDate(item.date);

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

    const statusPill = document.createElement("p");
    statusPill.className = "fixture-status-pill";
    statusPill.dataset.variant = normalizedStatus;
    statusPill.textContent = normalizedStatus === "completed" ? "Completed" : "Upcoming";

    const title = document.createElement("h3");
    title.className = "item-title";
    title.textContent = getFixtureHeadline(item);

    const venue = document.createElement("p");
    venue.className = "fixture-item-venue";
    venue.textContent = `Venue: ${item.venue || "Venue to be confirmed"}`;

    card.append(topLine, statusPill, title, venue);

    if (item.details) {
      const details = document.createElement("p");
      details.className = "fixture-item-details";
      details.textContent = item.details;
      card.appendChild(details);
    }

    const meta = document.createElement("p");
    meta.className = "item-meta";
    meta.textContent = `Saved ${formatTimestamp(item.updatedAt || item.createdAt)}`;
    card.appendChild(meta);

    fixturesList.appendChild(card);
  });
}

async function loadFixtures(successMessage = "Fixtures synced with Firestore.") {
  const cachedFixtures = readCachedFixtures();
  const hadFixtures = currentFixtures.length > 0 || cachedFixtures.length > 0;

  if (cachedFixtures.length) {
    currentFixtures = sortFixtures(cachedFixtures);
    renderFixtures(currentFixtures);
    setFeedback(listFeedback, "Showing a saved browser copy while Firestore connects.", "info");
  } else {
    setFeedback(listFeedback, "Loading fixtures from Firestore...", "info");
  }

  if (syncLabel) {
    syncLabel.textContent = "Loading";
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

    currentFixtures = sortFixtures(
      snapshot.docs.map((snapshotDoc) => ({
        id: snapshotDoc.id,
        ...snapshotDoc.data()
      }))
    );

    cacheFixtures(currentFixtures);
    renderFixtures(currentFixtures);

    if (syncLabel) {
      syncLabel.textContent = "Live";
    }

    setFeedback(listFeedback, successMessage, "info");
  } catch (error) {
    if (!hadFixtures) {
      currentFixtures = [];
      renderFixtures([]);
    } else if (cachedFixtures.length) {
      currentFixtures = sortFixtures(cachedFixtures);
      renderFixtures(currentFixtures);
    }

    if (syncLabel) {
      syncLabel.textContent = error?.code === "deadline-exceeded" ? "Delayed" : "Error";
    }

    setFeedback(
      listFeedback,
      getFixtureErrorMessage(error, "Could not load fixtures from Firestore."),
      "error"
    );
    console.error(error);
    throw error;
  }
}

function beginEditingFixture(fixtureId) {
  const item = currentFixtures.find((entry) => entry.id === fixtureId);

  if (!item) {
    setFeedback(formFeedback, "That fixture could not be found.", "error");
    return;
  }

  editingFixtureId = fixtureId;
  opponentInput.value = item.opponent || "";
  dateInput.value = item.date || "";
  venueInput.value = item.venue || "";
  statusInput.value = normalizeFixtureStatus(item.status);
  detailsInput.value = item.details || "";

  clearFieldErrors();
  updateFormMode();
  syncDetailsFieldCopy();
  renderFixtures(currentFixtures);
  setFeedback(formFeedback, "Editing fixture. Update the fields and save.", "info");
  opponentInput.focus();
}

async function removeFixture(fixtureId, button) {
  const item = currentFixtures.find((entry) => entry.id === fixtureId);

  if (!item) {
    setFeedback(listFeedback, "That fixture no longer exists.", "error");
    return;
  }

  const confirmed = window.confirm(`Delete "${getFixtureHeadline(item)}"?`);

  if (!confirmed) {
    return;
  }

  button.disabled = true;
  setFeedback(listFeedback, "Deleting fixture...", "info");

  if (syncLabel) {
    syncLabel.textContent = "Deleting";
  }

  try {
    await withTimeout(
      deleteDoc(doc(db, FIXTURES_COLLECTION, fixtureId)),
      "Deleting fixture timed out."
    );
    await loadFixtures("Fixture deleted.");

    if (editingFixtureId === fixtureId) {
      resetForm();
      setFeedback(formFeedback, "Deleted the fixture that was being edited.", "info");
    }
  } catch (error) {
    button.disabled = false;
    setFeedback(
      listFeedback,
      getFixtureErrorMessage(error, "Delete failed. Please try again."),
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

  const values = getFixtureValues();

  if (!validateFixture(values)) {
    return;
  }

  setSubmittingState(true);
  setFeedback(
    formFeedback,
    editingFixtureId ? "Updating fixture..." : "Saving fixture...",
    "info"
  );

  if (syncLabel) {
    syncLabel.textContent = editingFixtureId ? "Updating" : "Saving";
  }

  try {
    const timestamp = new Date();
    const fixturePayload = {
      opponent: values.opponent,
      date: values.date,
      venue: values.venue,
      status: values.status,
      details: values.details,
      updatedAt: timestamp
    };

    if (editingFixtureId) {
      await withTimeout(
        updateDoc(doc(db, FIXTURES_COLLECTION, editingFixtureId), fixturePayload),
        "Updating fixture timed out."
      );

      await loadFixtures("Fixtures synced with Firestore.");
      setFeedback(formFeedback, "Fixture updated successfully.", "success");
    } else {
      await withTimeout(
        addDoc(collection(db, FIXTURES_COLLECTION), {
          ...fixturePayload,
          createdAt: timestamp
        }),
        "Saving fixture timed out."
      );

      await loadFixtures("Fixtures synced with Firestore.");
      setFeedback(formFeedback, "Fixture saved to Firestore.", "success");
    }

    resetForm();
  } catch (error) {
    setFeedback(
      formFeedback,
      getFixtureErrorMessage(error, "Saving failed. Please try again."),
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

fixtureForm.addEventListener("submit", handleFormSubmit);
cancelEditButton.addEventListener("click", () => {
  resetForm();
  setFeedback(formFeedback, "Edit cancelled. You can create a new fixture now.", "info");
});
logoutButton.addEventListener("click", handleLogout);
statusInput.addEventListener("change", syncDetailsFieldCopy);

fixturesList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === "edit") {
    beginEditingFixture(id);
    return;
  }

  if (action === "delete") {
    removeFixture(id, button);
  }
});

updateFormMode();
syncDetailsFieldCopy();

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

    loadFixtures().catch(() => {});
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
