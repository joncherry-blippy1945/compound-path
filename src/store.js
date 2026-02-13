import { db } from './firebase';
import { doc, setDoc, onSnapshot, getDoc } from 'firebase/firestore';

function userRef(uid) { return doc(db, 'users', uid); }

// Save entire user document (debounce externally)
export async function saveUserData(uid, data) {
  await setDoc(userRef(uid), data, { merge: true });
}

// Subscribe to real-time updates
export function subscribeToUserData(uid, callback) {
  return onSnapshot(userRef(uid), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

// Load once
export async function loadUserData(uid) {
  const snap = await getDoc(userRef(uid));
  return snap.exists() ? snap.data() : null;
}
