/**
 * Firebase — mesma conta do app de embalagem; coleção separada.
 * SYNC_ENABLED=true sincroniza prateleiras entre celulares.
 */
export const SYNC_ENABLED = true;

export const firebaseConfig = {
  apiKey: 'AIzaSyD_MZWaKejOAwclw_4YC6rJd--5hoC4o24',
  authDomain: 'carol-embalagem.firebaseapp.com',
  projectId: 'carol-embalagem',
  storageBucket: 'carol-embalagem.firebasestorage.app',
  messagingSenderId: '215450406714',
  appId: '1:215450406714:web:2385a61bcd942fc47a8a03',
  measurementId: 'G-HSF638QS2N',
};

/** Coleção Firestore só deste app (não mistura com embalagens). */
export const FIRESTORE_COLLECTION = 'prateleiras';
export const FIRESTORE_EXCLUIDOS = 'prateleiras_excluidos';
