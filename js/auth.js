import {
  auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from './firebase.js';
import { ALLOWED_EMAIL } from './config.js';

let currentUser = null;

export function watchAuth(callback) {
  return onAuthStateChanged(auth, (user) => {
    currentUser = user;
    callback(user);
  });
}

export function getUser() {
  return currentUser;
}

export function isAllowed(user) {
  return !!(user && user.emailVerified && user.email && ALLOWED_EMAIL.test(user.email));
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

export function signOutUser() {
  return signOut(auth);
}

export function firstName(user = currentUser) {
  const name = user?.displayName || user?.email || '';
  return name.split(/[\s@]/)[0] || 'Someone';
}

// Stored on documents as createdBy/updatedBy.
export function userStamp(deviceId) {
  return {
    name: currentUser?.displayName || currentUser?.email || 'Unknown',
    email: currentUser?.email || '',
    ...(deviceId ? { deviceId } : {}),
  };
}
