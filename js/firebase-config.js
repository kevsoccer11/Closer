// Replace with your project credentials in Firebase Console
const firebaseConfig = {
    apiKey: "AIzaSyBbt1l0Bmw_5jmMfxR8P0tqQontYSyK6vQ",
    authDomain: "tresholdapp-93c47.firebaseapp.com",
    databaseURL: "https://tresholdapp-93c47-default-rtdb.firebaseio.com",
    projectId: "tresholdapp-93c47",
    storageBucket: "tresholdapp-93c47.firebasestorage.app",
    messagingSenderId: "1057604365924",
    appId: "1:1057604365924:web:ec2b3abb6817d26faab971"
};

let db = null;
let roomRef = null;
let currentRoomCode = localStorage.getItem('closer_room_code') || null;

try {
    firebase.initializeApp(firebaseConfig);
    firebase.auth().signInAnonymously();
    db = firebase.database();
} catch (e) {
    console.warn("Firebase running in offline browser mode.");
}