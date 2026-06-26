import { useState, useEffect } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

export interface AuthState {
  user: User | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { user, loading };
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<void> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  await setDoc(doc(db, 'users', cred.user.uid), {
    displayName,
    photoURL: null,
    createdAt: serverTimestamp(),
  });
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

// Returns the householdId for the given user, or null if not yet set up
export async function getHouseholdId(uid: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data().householdId ?? null) : null;
}

// Creates a new household for the user and links it
export async function createHousehold(uid: string, displayName: string): Promise<string> {
  const hRef = doc(db, 'households', `${uid}_h`);
  await setDoc(hRef, {
    name: `${displayName}の家族`,
    ownerUid: uid,
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'households', hRef.id, 'members', uid), { role: 'owner' });
  await setDoc(doc(db, 'users', uid), { householdId: hRef.id }, { merge: true });
  return hRef.id;
}
