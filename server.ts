import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import * as admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Health check route
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Initialize Firebase Admin
  const fs = await import("fs");
  const firebaseConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "firebase-applet-config.json"), "utf8"));
  
  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: firebaseConfig.projectId
      });
      console.log("Firebase Admin initialized for project:", firebaseConfig.projectId);
    } catch (error) {
      console.error("Firebase Admin initialization error:", error);
      // Fallback for local development if applicationDefault fails
      try {
        admin.initializeApp({
          projectId: firebaseConfig.projectId
        });
        console.log("Firebase Admin initialized with projectId only");
      } catch (innerError) {
        console.error("Firebase Admin second attempt failed:", innerError);
      }
    }
  }

  const { getFirestore } = await import("firebase-admin/firestore");
  const db = firebaseConfig.firestoreDatabaseId 
    ? getFirestore(firebaseConfig.firestoreDatabaseId)
    : getFirestore();

  app.use(express.json());

  // API Route to register a user (Admin only)
  app.post("/api/admin/users", async (req, res) => {
    const { email, password, displayName, role, callerUid } = req.body;

    try {
      console.log(`Attempting to create user: ${email} by caller: ${callerUid}`);
      // Verify caller is admin or chef_bureau_logistique in Firestore
      const callerDoc = await db.collection("users").doc(callerUid).get();
      const callerData = callerDoc.data();
      
      const allowedRoles = ["admin", "chef_bureau_logistique"];
      if (!callerData || !allowedRoles.includes(callerData.role)) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Create Auth User
      const userRecord = await admin.auth().createUser({
        email,
        password,
        displayName,
      });

      // Create Firestore Profile
      await db.collection("users").doc(userRecord.uid).set({
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        role: role || "agent_logistique",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.status(201).json({ uid: userRecord.uid });
    } catch (error: any) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to delete a user (Admin only)
  app.delete("/api/admin/users/:uid", async (req, res) => {
    const { uid } = req.params;
    const { callerUid } = req.body;

    try {
      // Verify caller
      const callerDoc = await db.collection("users").doc(callerUid).get();
      const callerData = callerDoc.data();
      
      const allowedRoles = ["admin", "chef_bureau_logistique"];
      if (!callerData || !allowedRoles.includes(callerData.role)) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Delete Auth User
      await admin.auth().deleteUser(uid);

      // Delete Firestore Profile
      await db.collection("users").doc(uid).delete();

      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
