import { collection, doc, setDoc, getDocs, query, where, orderBy, limit as limitDocs, updateDoc, serverTimestamp, getDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';

export interface Signal {
  id?: string;
  pair: string;
  timeframe: string;
  type: string;
  entry: number;
  targets: number[];
  stop_loss: number;
  note?: string;
  status: 'OPEN' | 'TARGET_HIT' | 'STOP_HIT' | 'CLOSED';
  is_aggressive?: boolean;
  strategyName?: string;
  created_at?: Date | any;
  updated_at?: Date | any;
}

export async function clearAllSignals(): Promise<boolean> {
  try {
    const signalsRef = collection(db, 'signals');
    const snapshot = await getDocs(signalsRef);
    console.log(`Found ${snapshot.size} signals to clear`);
    if (snapshot.empty) return true;

    const batch = writeBatch(db);
    let count = 0;
    for (const document of snapshot.docs) {
      console.log(`Deleting signal doc ID: ${document.id}`);
      batch.delete(document.ref);
      count++;
    }
    console.log(`Prepared to delete ${count} signals in batch`);
    if (count > 0) {
      await batch.commit();
      console.log('Batch commit successful');
    }
    return true;
  } catch (error) {
    console.error('Error clearing signals:', error);
    return false;
  }
}

export async function addUser(telegramId: string): Promise<boolean> {
  try {
    const userRef = doc(db, 'users', telegramId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        telegram_id: telegramId,
        created_at: serverTimestamp()
      });
    }
    return true;
  } catch (error) {
    console.error('Error adding user:', error);
    return false;
  }
}

export async function getAllUsers(): Promise<string[]> {
  try {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    return snapshot.docs.map(doc => doc.data().telegram_id);
  } catch (error) {
    console.error('Error getting users:', error);
    return [];
  }
}

export async function saveSignal(signal: Signal): Promise<string | null> {
  try {
    const signalsRef = collection(db, 'signals');
    const newDocRef = doc(signalsRef);
    await setDoc(newDocRef, {
      ...signal,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp()
    });
    return newDocRef.id;
  } catch (error) {
    console.error('Error saving signal:', error);
    return null;
  }
}

export async function getActiveSignals(): Promise<Signal[]> {
  try {
    const signalsRef = collection(db, 'signals');
    const q = query(signalsRef, where('status', '==', 'OPEN'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return { 
        id: doc.id,
        ...data,
        created_at: data.created_at?.toDate?.()?.toISOString() || new Date(0).toISOString(),
        updated_at: data.updated_at?.toDate?.()?.toISOString() || new Date(0).toISOString()
      } as Signal;
    });
  } catch (error) {
    console.error('Error getting active signals:', error);
    return [];
  }
}

export async function updateSignalStatus(id: string, status: 'TARGET_HIT' | 'STOP_HIT' | 'CLOSED'): Promise<boolean> {
  try {
    const docRef = doc(db, 'signals', id);
    await updateDoc(docRef, {
      status,
      updated_at: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('Error updating signal status:', error);
    return false;
  }
}

export async function getRecentSignals(limitNum: number = 20): Promise<Signal[]> {
  try {
    const signalsRef = collection(db, 'signals');
    const q = query(signalsRef, orderBy('created_at', 'desc'), limitDocs(limitNum));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return { 
        id: doc.id,
        ...data,
        created_at: data.created_at?.toDate?.()?.toISOString() || new Date().toISOString(),
        updated_at: data.updated_at?.toDate?.()?.toISOString() || new Date().toISOString()
      } as Signal;
    });
  } catch (error) {
    console.error('Error getting recent signals:', error);
    return [];
  }
}

export async function get24hPerformance(): Promise<any> {
  try {
    const signalsRef = collection(db, 'signals');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Fallback: get all closed/hit signals since we might lack a composite index
    // We'll filter in JS.
    const snapshot = await getDocs(signalsRef);
    let wins = 0;
    let losses = 0;
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (['TARGET_HIT', 'STOP_HIT', 'CLOSED'].includes(data.status)) {
        // Handle firestore timestamp or fallback
        const updatedTime = data.updated_at?.toDate?.() || data.created_at?.toDate?.() || new Date(0);
        if (updatedTime >= yesterday) {
          if (data.status === 'TARGET_HIT') wins++;
          if (data.status === 'STOP_HIT') losses++;
        }
      }
    });

    const total = wins + losses;
    if (total === 0) {
      return { status: 'no signals today' };
    }
    
    return {
      wins,
      losses,
      total,
      winrate: ((wins / total) * 100).toFixed(1) + '%'
    };
  } catch (error) {
    console.error('Error getting performance:', error);
    return { status: 'error' };
  }
}
