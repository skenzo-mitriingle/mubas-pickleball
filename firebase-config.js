import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";

const firebaseConfig = {
  apiKey: "AIzaSyDm2t2TY77htFMb4GQkfKVZbNlZm6cH-6U",
  authDomain: "mubas-pickleball-club.firebaseapp.com",
  projectId: "mubas-pickleball-club",
  storageBucket: "mubas-pickleball-club.firebasestorage.app",
  messagingSenderId: "727127544749",
  appId: "1:727127544749:web:fef7207261d61091ba8724"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
