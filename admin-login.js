import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebase-config.js";

const adminLoginForm = document.getElementById("admin-login-form");
const adminEmailInput = document.getElementById("admin-email");
const adminPasswordInput = document.getElementById("admin-password");
const loginFeedback = document.getElementById("login-feedback");

function setFeedback(message, state = "") {
  if (!loginFeedback) return;

  loginFeedback.textContent = message;

  if (state) {
    loginFeedback.dataset.state = state;
  } else {
    delete loginFeedback.dataset.state;
  }
}

function setFieldError(input, hasError) {
  if (!input) return;

  input.classList.toggle("is-invalid", hasError);
  input.setAttribute("aria-invalid", String(hasError));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = adminEmailInput.value.trim();
  const password = adminPasswordInput.value.trim();

  setFieldError(adminEmailInput, false);
  setFieldError(adminPasswordInput, false);
  setFeedback("");

  if (!email) {
    setFieldError(adminEmailInput, true);
    setFeedback("Enter your admin email address.", "error");
    return;
  }

  if (!isValidEmail(email)) {
    setFieldError(adminEmailInput, true);
    setFeedback("Enter a valid email address.", "error");
    return;
  }

  if (!password) {
    setFieldError(adminPasswordInput, true);
    setFeedback("Enter your password.", "error");
    return;
  }

  try {
    setFeedback("Signing in...", "info");

    await signInWithEmailAndPassword(auth, email, password);

    setFeedback("Login successful. Redirecting...", "info");

    // Redirect after login
    window.location.href = "admin-dashboard.html";

  } catch (error) {
    let message = "Login failed.";

    if (error.code === "auth/invalid-credential") {
      message = "Invalid email or password.";
    } else if (error.code === "auth/user-not-found") {
      message = "User not found.";
    } else if (error.code === "auth/wrong-password") {
      message = "Wrong password.";
    } else if (error.code === "auth/too-many-requests") {
      message = "Too many attempts. Try again later.";
    }

    setFeedback(message, "error");
  }
});