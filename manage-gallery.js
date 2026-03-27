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

const GALLERY_COLLECTION = "galleryItems";
const GALLERY_CACHE_KEY = "mubas-pickleball:gallery-cache";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const body = document.body;
const adminIdentity = document.getElementById("admin-identity");
const logoutButton = document.getElementById("logout-button");
const galleryCount = document.getElementById("gallery-count");
const formModeLabel = document.getElementById("form-mode-label");
const syncLabel = document.getElementById("sync-label");
const editingChip = document.getElementById("editing-chip");
const formHeading = document.getElementById("form-heading");
const galleryForm = document.getElementById("gallery-form");
const dateInput = document.getElementById("gallery-date");
const captionInput = document.getElementById("gallery-caption");
const imageInput = document.getElementById("gallery-image");
const replaceImageNote = document.getElementById("replace-image-note");
const selectedImageName = document.getElementById("selected-image-name");
const previewImage = document.getElementById("preview-image");
const previewEmpty = document.getElementById("preview-empty");
const previewMeta = document.getElementById("preview-meta");
const saveButton = document.getElementById("save-button");
const cancelEditButton = document.getElementById("cancel-edit-button");
const formFeedback = document.getElementById("form-feedback");
const listFeedback = document.getElementById("list-feedback");
const emptyState = document.getElementById("empty-state");
const galleryList = document.getElementById("gallery-list");

let editingGalleryId = "";
let isSubmitting = false;
let currentGalleryItems = [];
let transientPreviewUrl = "";

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
  [dateInput, captionInput, imageInput].forEach((input) => {
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

function cacheGalleryItems(items) {
  try {
    const cachePayload = items.map((item) => ({
      id: item.id || "",
      date: item.date || "",
      caption: item.caption || "",
      imageUrl: item.imageUrl || "",
      publicId: item.publicId || "",
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

function getGalleryErrorMessage(error, fallbackMessage) {
  if (
    error?.code === "permission-denied" ||
    error?.code === "storage/unauthorized"
  ) {
    return "Access to the gallery data is blocked. Confirm that your admin account can manage gallery items.";
  }

  if (error?.code === "unauthenticated") {
    return "You are signed out for Firebase access. Please log in again.";
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

  if (error?.code === "upload-failed") {
    return "The image service could not accept this upload. Try another image or try again in a moment.";
  }

  if (error instanceof TypeError) {
    return "The image upload service could not be reached. Check your internet connection and try again.";
  }

  return fallbackMessage;
}

function formatGalleryDate(value) {
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
    const asDate = getTimestampMilliseconds(timestamp);

    if (!asDate) {
      return "just now";
    }

    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(asDate));
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp.toDate());
}

function setSelectedImageMessage(message) {
  if (!selectedImageName) {
    return;
  }

  selectedImageName.textContent = message;
}

function clearTransientPreview() {
  if (!transientPreviewUrl) {
    return;
  }

  window.URL.revokeObjectURL(transientPreviewUrl);
  transientPreviewUrl = "";
}

function showPreviewState(url, alt, metaMessage) {
  if (!previewImage || !previewEmpty || !previewMeta) {
    return;
  }

  if (url) {
    previewImage.src = url;
    previewImage.alt = alt || "Selected gallery image preview";
    previewImage.hidden = false;
    previewEmpty.hidden = true;
  } else {
    previewImage.hidden = true;
    previewImage.removeAttribute("src");
    previewImage.alt = "";
    previewEmpty.hidden = false;
  }

  previewMeta.textContent = metaMessage;
}

function updatePreviewFromState() {
  const file = imageInput?.files?.[0];

  if (file) {
    clearTransientPreview();
    transientPreviewUrl = window.URL.createObjectURL(file);
    showPreviewState(
      transientPreviewUrl,
      captionInput.value.trim() || file.name,
      `Selected file: ${file.name}`
    );
    setSelectedImageMessage(file.name);
    return;
  }

  if (editingGalleryId) {
    const currentItem = currentGalleryItems.find((item) => item.id === editingGalleryId);

    if (currentItem?.imageUrl) {
      clearTransientPreview();
      showPreviewState(
        currentItem.imageUrl,
        currentItem.caption || "Current gallery image",
        "Current gallery image. Select a new file only if you want to replace it."
      );
      setSelectedImageMessage("Keeping the current gallery image.");
      return;
    }
  }

  clearTransientPreview();
  showPreviewState("", "", "Image preview ready for the next upload.");
  setSelectedImageMessage("No image selected yet.");
}

function updateFormMode() {
  const isEditing = Boolean(editingGalleryId);

  if (formModeLabel) {
    formModeLabel.textContent = isEditing ? "Edit" : "Create";
  }

  if (formHeading) {
    formHeading.textContent = isEditing
      ? "Edit selected gallery item"
      : "Upload a new gallery image";
  }

  if (saveButton) {
    saveButton.textContent = isEditing ? "Update gallery item" : "Save gallery item";
  }

  if (editingChip) {
    editingChip.hidden = !isEditing;
  }

  if (cancelEditButton) {
    cancelEditButton.hidden = !isEditing;
  }

  if (replaceImageNote) {
    replaceImageNote.textContent = isEditing
      ? "Leave the image field empty to keep the current gallery image."
      : "Choose an image file to upload.";
  }
}

function resetForm() {
  editingGalleryId = "";
  galleryForm.reset();
  clearFieldErrors();
  clearTransientPreview();
  updateFormMode();
  updatePreviewFromState();
  renderGalleryItems(currentGalleryItems);
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

  if (imageInput) {
    imageInput.disabled = isBusy;
  }
}

function getGalleryValues() {
  return {
    date: dateInput.value,
    caption: captionInput.value.trim()
  };
}

function validateGallery(values, imageFile) {
  clearFieldErrors();

  if (!values.date) {
    setFieldError(dateInput, true);
    setFeedback(formFeedback, "Choose the photo date.", "error");
    dateInput.focus();
    return false;
  }

  if (!editingGalleryId && !imageFile) {
    setFieldError(imageInput, true);
    setFeedback(formFeedback, "Choose an image file to upload.", "error");
    imageInput.focus();
    return false;
  }

  if (imageFile && !imageFile.type.startsWith("image/")) {
    setFieldError(imageInput, true);
    setFeedback(formFeedback, "The selected file must be an image.", "error");
    imageInput.focus();
    return false;
  }

  if (imageFile && imageFile.size > MAX_IMAGE_BYTES) {
    setFieldError(imageInput, true);
    setFeedback(formFeedback, "Choose an image smaller than 8 MB.", "error");
    imageInput.focus();
    return false;
  }

  return true;
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

function renderGalleryItems(items) {
  if (!galleryList || !emptyState || !galleryCount) {
    return;
  }

  galleryList.replaceChildren();
  galleryCount.textContent = String(items.length);

  if (!items.length) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "gallery-item-card";
    card.dataset.id = item.id;

    if (item.id === editingGalleryId) {
      card.classList.add("is-editing");
    }

    const layout = document.createElement("div");
    layout.className = "gallery-item-layout";

    const media = document.createElement("div");
    media.className = "gallery-item-media";

    const image = document.createElement("img");
    image.className = "gallery-item-image";
    image.src = item.imageUrl || "";
    image.alt = item.caption || "Gallery image";
    image.loading = "lazy";
    image.decoding = "async";

    media.appendChild(image);

    const copy = document.createElement("div");
    copy.className = "gallery-item-copy";

    const head = document.createElement("div");
    head.className = "gallery-item-head";

    const date = document.createElement("p");
    date.className = "item-date";
    date.textContent = formatGalleryDate(item.date);

    const actions = document.createElement("div");
    actions.className = "gallery-item-actions";

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
    head.append(date, actions);

    const caption = document.createElement("p");
    caption.className = "gallery-item-caption";
    caption.textContent = item.caption || "No caption added.";

    const meta = document.createElement("p");
    meta.className = "gallery-item-meta";
    meta.textContent = `Saved ${formatTimestamp(item.updatedAt || item.createdAt)}`;

    copy.append(head, caption, meta);
    layout.append(media, copy);
    card.appendChild(layout);
    galleryList.appendChild(card);
  });
}

async function loadGallery(successMessage = "Gallery refreshed.") {
  const hadItems = currentGalleryItems.length > 0;
  setFeedback(listFeedback, "Loading gallery items...", "info");

  if (syncLabel) {
    syncLabel.textContent = "Loading";
  }

  try {
    const galleryQuery = query(
      collection(db, GALLERY_COLLECTION),
      orderBy("updatedAt", "desc")
    );
    const snapshot = await withTimeout(
      getDocs(galleryQuery),
      "Loading gallery items timed out."
    );

    currentGalleryItems = sortGalleryItems(
      snapshot.docs.map((snapshotDoc) => ({
        id: snapshotDoc.id,
        ...snapshotDoc.data()
      }))
    );

    cacheGalleryItems(currentGalleryItems);
    renderGalleryItems(currentGalleryItems);

    if (syncLabel) {
      syncLabel.textContent = "Live";
    }

    setFeedback(listFeedback, successMessage, "info");
  } catch (error) {
    if (!hadItems) {
      currentGalleryItems = [];
      renderGalleryItems([]);
    }

    if (syncLabel) {
      syncLabel.textContent = error?.code === "deadline-exceeded" ? "Delayed" : "Error";
    }

    setFeedback(
      listFeedback,
      getGalleryErrorMessage(error, "Could not load gallery items right now."),
      "error"
    );
    console.error(error);
    throw error;
  }
}

function beginEditingGalleryItem(galleryId) {
  const item = currentGalleryItems.find((entry) => entry.id === galleryId);

  if (!item) {
    setFeedback(formFeedback, "That gallery item could not be found.", "error");
    return;
  }

  editingGalleryId = galleryId;
  imageInput.value = "";
  dateInput.value = item.date || "";
  captionInput.value = item.caption || "";
  clearFieldErrors();
  updateFormMode();
  updatePreviewFromState();
  renderGalleryItems(currentGalleryItems);
  setFeedback(formFeedback, "Editing gallery item. Update the fields and save.", "info");
  captionInput.focus();
}

async function uploadGalleryImage(file) {
  const cloudName = "dm7hdoes1";
  const uploadPreset = "mubas_gallery";

  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  const response = await fetch(url, {
    method: "POST",
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    const uploadError = new Error(
      data?.error?.message || "The image service rejected this upload."
    );
    uploadError.code = "upload-failed";
    throw uploadError;
  }

  return {
    imageUrl: data.secure_url,
    publicId: data.public_id
  };
}

async function deleteStoredImage(publicId) {
  void publicId;
}

async function removeGalleryItem(galleryId, button) {
  const item = currentGalleryItems.find((entry) => entry.id === galleryId);

  if (!item) {
    setFeedback(listFeedback, "That gallery item no longer exists.", "error");
    return;
  }

  const confirmed = window.confirm(`Delete "${item.caption || "this gallery image"}" from the gallery?`);

  if (!confirmed) {
    return;
  }

  button.disabled = true;
  setFeedback(listFeedback, "Deleting gallery item...", "info");

  if (syncLabel) {
    syncLabel.textContent = "Deleting";
  }

  try {
    await withTimeout(
      deleteDoc(doc(db, GALLERY_COLLECTION, galleryId)),
      "Deleting gallery item timed out."
    );

    const remoteImageId = item.publicId || item.storagePath || "";

    if (remoteImageId) {
      try {
        await deleteStoredImage(remoteImageId);
      } catch (storageError) {
        console.warn("The gallery item was deleted, but the uploaded image could not be removed.", storageError);
      }
    }

    await loadGallery("Gallery item deleted.");

    if (editingGalleryId === galleryId) {
      resetForm();
      setFeedback(formFeedback, "Deleted the gallery item that was being edited.", "info");
    }
  } catch (error) {
    button.disabled = false;
    setFeedback(
      listFeedback,
      getGalleryErrorMessage(error, "Delete failed. Please try again."),
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

  const values = getGalleryValues();
  const selectedFile = imageInput.files?.[0] || null;

  if (!validateGallery(values, selectedFile)) {
    return;
  }

  const existingItem = editingGalleryId
    ? currentGalleryItems.find((entry) => entry.id === editingGalleryId)
    : null;

  if (editingGalleryId && !existingItem) {
    setFeedback(formFeedback, "That gallery item could not be found for editing.", "error");
    return;
  }

  setSubmittingState(true);
  setFeedback(
    formFeedback,
    selectedFile ? "Uploading image..." : "Saving gallery item...",
    "info"
  );

  if (syncLabel) {
    syncLabel.textContent = selectedFile ? "Uploading" : "Saving";
  }

  let uploadedImage = null;
  let didPersistGalleryItem = false;

  try {
    const timestamp = new Date();

    if (editingGalleryId) {
      let imageUrl = existingItem.imageUrl || "";
      let publicId = existingItem.publicId || existingItem.storagePath || "";

      if (selectedFile) {
        uploadedImage = await uploadGalleryImage(selectedFile);
        imageUrl = uploadedImage.imageUrl;
        publicId = uploadedImage.publicId;
        setFeedback(formFeedback, "Image uploaded. Saving gallery metadata...", "info");
      }

      if (syncLabel) {
        syncLabel.textContent = "Saving";
      }

      await withTimeout(
        updateDoc(doc(db, GALLERY_COLLECTION, editingGalleryId), {
          title: deleteField(),
          date: values.date,
          caption: values.caption,
          imageUrl,
          publicId,
          storagePath: deleteField(),
          updatedAt: timestamp
        }),
        "Updating gallery item timed out."
      );
      didPersistGalleryItem = true;

      if (
        uploadedImage &&
        existingItem.publicId &&
        existingItem.publicId !== uploadedImage.publicId
      ) {
        try {
          await deleteStoredImage(existingItem.publicId);
        } catch (storageError) {
          console.warn("The gallery item was updated, but the previous image could not be removed.", storageError);
        }
      }

      await loadGallery("Gallery refreshed.");
      setFeedback(formFeedback, "Gallery item updated successfully.", "success");
    } else {
      uploadedImage = await uploadGalleryImage(selectedFile);

      if (syncLabel) {
        syncLabel.textContent = "Saving";
      }

      await withTimeout(
        addDoc(collection(db, GALLERY_COLLECTION), {
          date: values.date,
          caption: values.caption,
          imageUrl: uploadedImage.imageUrl,
          publicId: uploadedImage.publicId,
          createdAt: timestamp,
          updatedAt: timestamp
        }),
        "Saving gallery item timed out."
      );
      didPersistGalleryItem = true;

      await loadGallery("Gallery refreshed.");
      setFeedback(formFeedback, "Gallery item saved successfully.", "success");
    }

    resetForm();
  } catch (error) {
    if (uploadedImage && !didPersistGalleryItem) {
      try {
        await deleteStoredImage(uploadedImage.publicId);
      } catch (cleanupError) {
        console.warn("A temporary uploaded image could not be cleaned up after a failed save.", cleanupError);
      }
    }

    setFeedback(
      formFeedback,
      getGalleryErrorMessage(error, "Saving failed. Please try again."),
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

galleryForm.addEventListener("submit", handleFormSubmit);

imageInput.addEventListener("change", () => {
  setFieldError(imageInput, false);
  updatePreviewFromState();
});

cancelEditButton.addEventListener("click", () => {
  resetForm();
  setFeedback(formFeedback, "Edit cancelled. You can upload a new gallery item now.", "info");
});

logoutButton.addEventListener("click", handleLogout);

galleryList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === "edit") {
    beginEditingGalleryItem(id);
    return;
  }

  if (action === "delete") {
    removeGalleryItem(id, button);
  }
});

updateFormMode();
updatePreviewFromState();

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

    loadGallery().catch(() => {});
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
