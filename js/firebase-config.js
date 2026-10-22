// Firebase Configuration for Closer
const firebaseConfig = {
    apiKey: "YOUR_RESTRICTED_API_KEY",
    authDomain: "tresholdapp-93c47.firebaseapp.com",
    databaseURL: "https://tresholdapp-93c47-default-rtdb.firebaseio.com",
    projectId: "tresholdapp-93c47",
    storageBucket: "tresholdapp-93c47.firebasestorage.app",
    messagingSenderId: "1057604365924",
    appId: "1:1057604365924:web:ec2b3abb6817d26faab971"
};

// Global scope attachment
window.db = null;
window.roomRef = null;
window.currentRoomCode = localStorage.getItem('closer_room_code') || null;

try {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        window.db = firebase.database();

        if (firebase.auth) {
            firebase.auth().signInAnonymously()
                .then(cred => console.log("Firebase Auth active:", cred.user.uid))
                .catch(err => console.warn("Firebase Auth bypassed:", err.message));
        }
    }
} catch (e) {
    console.warn("Firebase running in offline fallback mode:", e);
}