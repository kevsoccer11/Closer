// Firebase Configuration for Closer
const firebaseConfig = {
    apiKey: "AIzaSyBbt1l0Bmw_5jmMfxR8P0tqQontYSyK6vQ",
    authDomain: "tresholdapp-93c47.firebaseapp.com",
    databaseURL: "https://tresholdapp-93c47-default-rtdb.firebaseio.com",
    projectId: "tresholdapp-93c47",
    storageBucket: "tresholdapp-93c47.firebasestorage.app",
    messagingSenderId: "1057604365924",
    appId: "1:1057604365924:web:ec2b3abb6817d26faab971"
};

// Explicitly attach variables to the global window scope
window.db = null;
window.roomRef = null;
window.currentRoomCode = localStorage.getItem('closer_room_code') || null;
window.firebaseConfigured = false;
window.firebaseAuthReady = Promise.resolve(null);

try {
    if (typeof firebase !== 'undefined' && firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('YOUR_')) {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        window.db = firebase.database();
        window.firebaseConfigured = true;

        // Silent anonymous auth catch prevents unhandled promise errors from breaking app JS
        if (firebase.auth) {
            window.firebaseAuthReady = firebase.auth().signInAnonymously()
                .then(cred => {
                    console.log("Firebase Auth Connected:", cred.user.uid);
                    return cred.user;
                });
            window.firebaseAuthReady.catch(err => console.warn("Firebase Auth bypassed:", err.message));
        }
    }
} catch (e) {
    console.warn("Firebase running in offline fallback mode:", e);
}