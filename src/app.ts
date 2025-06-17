
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import type { ErrorRequestHandler } from "express";
// Import des routes
import authRoutes from "./routes/auth";
import deliberationRoutes from "./routes/deliberations";
import commissionsRoutes from "./routes/commissions";
import interventionsRoutes from "./routes/interventions";
import doleancesRoutes from "./routes/doleances";

import { authMiddleware } from "./middleware/auth";
import router from "./routes/auth";

import deliberationsController from "./controllers/deliberationsController";
// (optionnel) Tu pourras décommenter au besoin
 

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Déclaration des routes
app.use("/api/auth", authRoutes);
app.use("/api/deliberations", deliberationRoutes);
 app.use("/api/commissions", commissionsRoutes);
 app.use("/api/interventions", interventionsRoutes);
app.use("/api/doleances", doleancesRoutes);

// Route test
app.get("/", (_req, res) => {
	res.send("🟢 Backend en ligne !");
});

// Middleware d'authentification
router.get("/", authMiddleware, deliberationsController.getAll);
// Gestion des erreurs (facultatif mais recommandé)
/*
app.use(
	(
		err: any,
		_req: express.Request,
		res: express.Response,
		_next: express.NextFunction
	) => {
		console.error(err.stack);
		res.status(500).json({
			success: false,
			message: "Erreur serveur",
			error: process.env.NODE_ENV === "development" ? err.message : undefined,
		});
	}
);*/
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler: ErrorRequestHandler = (err, _req, res,_next ) => {
	console.error(err.stack);
	res.status(500).json({
		success: false,
		message: "Erreur serveur",
		error: process.env.NODE_ENV === "development" ? err.message : undefined,
	});
};

app.use(errorHandler);

export default app;
