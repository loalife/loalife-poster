import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase project: loalife-5071d
const firebaseConfig = {
  apiKey: 'AIzaSyCyMcceBNNRpg-lyTtd7oslSwEDOxcco2g',
  authDomain: 'loalife-5071d.firebaseapp.com',
  projectId: 'loalife-5071d',
  storageBucket: 'loalife-5071d.firebasestorage.app',
  messagingSenderId: '405613985494',
  appId: '1:405613985494:web:eb4be0f5caa132fe6d9377',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
