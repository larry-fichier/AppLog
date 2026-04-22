import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { authenticateToken, authorize } from './middleware/auth.ts';
import { EquipmentService } from './services/equipmentService.ts';
import { AdminService } from './services/adminService.ts';
import { AuthService } from './services/authService.ts';
import { config } from './config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp() {
  const app = express();
  app.use(express.json());

  // --- API ROUTES ---

  // Health check
  app.get("/api/health", async (req, res) => {
    res.json({ status: "ok", mode: config.nodeEnv });
  });

  // Auth
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      const result = await AuthService.login(email, password);
      res.json(result);
    } catch (e: any) {
      res.status(401).json({ error: e.message });
    }
  });

  // Equipment
  app.get("/api/equipment", authenticateToken, async (req, res) => {
    try {
      const equipment = await EquipmentService.getAllEquipment();
      const ids = equipment.map(e => e.id);
      const details = await EquipmentService.getEquipmentDetails(ids);

      const merged = equipment.map(e => ({
        ...e,
        id: String(e.id),
        details: details
          .filter(d => d.equipment_id === e.id)
          .reduce((acc, curr) => ({ ...acc, [curr.field_key]: curr.field_value }), {})
      }));

      res.json(merged);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/equipment", authenticateToken, async (req: any, res) => {
    try {
      const id = await EquipmentService.createEquipment({
        ...req.body,
        created_by: req.user.id
      });
      res.status(201).json({ id: String(id) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Static Config (Used by both admin and main view)
  const getConfig = async (req: any, res: any) => {
    try {
      const data = await AdminService.getFullConfig();
      res.json(data);
    } catch (e: any) {
      console.error("[API] Config Error:", e);
      res.status(500).json({ error: e.message });
    }
  };

  app.get("/api/config", authenticateToken, getConfig);
  app.get("/api/admin/config", authenticateToken, getConfig);

  app.post("/api/admin/config", authenticateToken, authorize(['admin', 'chef_bureau_logistique']), async (req, res) => {
    try {
      const result = await AdminService.saveConfig(req.body);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Admin Users
  app.get("/api/admin/users", authenticateToken, authorize(['admin']), async (req, res) => {
    try {
      const users = await AdminService.getUsers();
      res.json(users);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- VITE / STATIC SERVING ---
  if (config.nodeEnv !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}
