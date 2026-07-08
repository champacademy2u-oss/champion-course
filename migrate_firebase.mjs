import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, setDoc } from "firebase/firestore";
import fs from "fs";

const firebaseConfig = {
  apiKey: "AIzaSyCJ_pqxqo4bCmSPQ0COG1ZkWw64ukX0SoM",
  authDomain: "champion-course.firebaseapp.com",
  projectId: "champion-course",
  storageBucket: "champion-course.firebasestorage.app",
  messagingSenderId: "337920852937",
  appId: "1:337920852937:web:fab67a792d3b15c574de18"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrateData() {
  console.log("Reading local backup data...");
  const rawData = fs.readFileSync("./lead-center-full-backup-2026-07-04-v3.json", "utf-8");
  const data = JSON.parse(rawData);

  console.log(`Starting migration for ${data.leads?.length || 0} leads...`);

  // Migrate Leads
  if (data.leads && Array.isArray(data.leads)) {
    let count = 0;
    for (const lead of data.leads) {
      if (!lead.id) continue;
      await setDoc(doc(db, "leads", lead.id), lead);
      count++;
      if (count % 10 === 0) console.log(`Migrated ${count} leads...`);
    }
    console.log(`Successfully migrated ${count} leads.`);
  }

  // Migrate Templates (save as a single document in 'config' collection, or 'templates' collection)
  if (data.templates) {
    await setDoc(doc(db, "config", "templates"), data.templates);
    console.log("Successfully migrated templates.");
  }

  // Migrate Previews
  if (data.previews && Array.isArray(data.previews)) {
    for (const preview of data.previews) {
      if (!preview.id) continue;
      await setDoc(doc(db, "previews", preview.id), preview);
    }
    console.log(`Successfully migrated ${data.previews.length} previews.`);
  }

  // Migrate Videos
  if (data.videos && Array.isArray(data.videos)) {
    for (const video of data.videos) {
      if (!video.id) continue;
      await setDoc(doc(db, "videos", video.id), video);
    }
    console.log(`Successfully migrated ${data.videos.length} videos.`);
  }

  // Custom Groups and Course Orders (save in 'config')
  await setDoc(doc(db, "config", "layout"), {
    customGroups: data.customGroups || [],
    courseOrder: data.courseOrder || []
  });
  console.log("Successfully migrated layout config.");

  console.log("Migration complete!");
  process.exit(0);
}

migrateData().catch(console.error);
