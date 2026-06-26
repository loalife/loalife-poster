import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { FamilyMember, Item, Repeat } from '../types';
import { addInterval, iso } from '../lib/dates';

export function useFamilyMembers(householdId: string | null) {
  const [members, setMembers] = useState<FamilyMember[]>([]);

  useEffect(() => {
    if (!householdId) return;
    const q = query(
      collection(db, 'households', householdId, 'familyMembers'),
      orderBy('createdAt', 'asc')
    );
    return onSnapshot(q, (snap) => {
      setMembers(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as FamilyMember))
      );
    });
  }, [householdId]);

  const addMember = useCallback(
    async (data: Omit<FamilyMember, 'id' | 'createdAt'>) => {
      if (!householdId) return;
      await addDoc(collection(db, 'households', householdId, 'familyMembers'), {
        ...data,
        createdAt: serverTimestamp(),
      });
    },
    [householdId]
  );

  const updateMember = useCallback(
    async (id: string, data: Partial<FamilyMember>) => {
      if (!householdId) return;
      await updateDoc(doc(db, 'households', householdId, 'familyMembers', id), data);
    },
    [householdId]
  );

  const removeMember = useCallback(
    async (id: string) => {
      if (!householdId) return;
      await deleteDoc(doc(db, 'households', householdId, 'familyMembers', id));
    },
    [householdId]
  );

  return { members, addMember, updateMember, removeMember };
}

export function useItems(householdId: string | null) {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    if (!householdId) return;
    const q = query(
      collection(db, 'households', householdId, 'items'),
      orderBy('createdAt', 'asc')
    );
    return onSnapshot(q, (snap) => {
      setItems(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            // Convert Firestore Timestamps to epoch ms
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : data.createdAt,
            updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : data.updatedAt,
            completedAt: data.completedAt instanceof Timestamp ? data.completedAt.toMillis() : data.completedAt,
          } as Item;
        })
      );
    });
  }, [householdId]);

  const addItem = useCallback(
    async (data: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>) => {
      if (!householdId) return;
      await addDoc(collection(db, 'households', householdId, 'items'), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
    [householdId]
  );

  const updateItem = useCallback(
    async (id: string, data: Partial<Item>) => {
      if (!householdId) return;
      await updateDoc(doc(db, 'households', householdId, 'items', id), {
        ...data,
        updatedAt: serverTimestamp(),
      });
    },
    [householdId]
  );

  const removeItem = useCallback(
    async (id: string) => {
      if (!householdId) return;
      await deleteDoc(doc(db, 'households', householdId, 'items', id));
    },
    [householdId]
  );

  // Toggle done; for repeating items advance the due date instead
  const toggleItem = useCallback(
    async (item: Item) => {
      if (!item.done && item.repeat && item.repeat !== 'none') {
        const base = item.dueDate ?? iso(new Date());
        const newDue = addInterval(base, item.repeat);
        await updateItem(item.id, { dueDate: newDue, done: false });
      } else {
        const done = !item.done;
        await updateItem(item.id, {
          done,
          completedAt: done ? Date.now() : undefined,
        });
      }
    },
    [updateItem]
  );

  return { items, addItem, updateItem, removeItem, toggleItem };
}
