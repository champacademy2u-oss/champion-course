// Configuration for Champion Course Lead Center
window.CONFIG = {
  // Original backend kept for backwards compatibility during migration.
  // NOTE: the frontend no longer calls this endpoint — leads sync directly
  // to Firebase from the browser (see app.js). This value is currently unused.
  API_BASE_URL: "https://champion-course.onrender.com",
};

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCJ_pqxqo4bCmSPQ0COG1ZkWw64ukX0SoM",
  authDomain: "champion-course.firebaseapp.com",
  projectId: "champion-course",
  storageBucket: "champion-course.firebasestorage.app",
  messagingSenderId: "337920852937",
  appId: "1:337920852937:web:fab67a792d3b15c574de18",
  measurementId: "G-3RZV6TX39W"
};

// Zoom registration uses Firebase HTTPS Functions so the meeting link,
// notification credentials and customer records never live in this public file.
window.ZOOM_PUBLIC_CONFIG = {
  functionsBaseUrl: "https://champion-course-video-room.vercel.app/api/zoom",
  singleEndpoint: true,
  appCheckSiteKey: ""
};

window.EMAIL_CAMPAIGN_CONFIG = {
  apiBaseUrl: "https://champion-course-video-room.vercel.app/api/email-campaigns"
};
