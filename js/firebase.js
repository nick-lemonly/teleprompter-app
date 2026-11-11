// Firebase init. Every Firebase import in the app goes through this module so the
// SDK version is pinned in exactly one place.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  writeBatch,
  serverTimestamp,
  increment,
  Timestamp,
  disableNetwork,
  enableNetwork,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  remove,
  onDisconnect,
  serverTimestamp as rtdbServerTimestamp,
  goOffline,
  goOnline,
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';
import { firebaseConfig } from './config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let firestore;
try {
  // Offline persistence keeps a loaded script available through brief drops.
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (err) {
  console.warn('Firestore persistence unavailable, using memory cache', err);
  firestore = initializeFirestore(app, {});
}
export const fs = firestore;
export const db = getDatabase(app);

export {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  writeBatch,
  serverTimestamp,
  increment,
  Timestamp,
  disableNetwork,
  enableNetwork,
  ref,
  onValue,
  set,
  update,
  remove,
  onDisconnect,
  rtdbServerTimestamp,
  goOffline,
  goOnline,
};
