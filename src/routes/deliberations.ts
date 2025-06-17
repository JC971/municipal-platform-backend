/*import express from "express";
import { check } from "express-validator";
import deliberationsController from "../controllers/deliberationsController";
import { authMiddleware } from "../middleware/auth";

import checkRole from "../middleware/roles";
import upload from "../middleware/upload";


const router = express.Router();

// Validation pour la création/mise à jour de délibération
const deliberationValidation = [
	check("titre", "Le titre est requis").not().isEmpty(),
	check("description", "La description est requise").not().isEmpty(),
	check("date", "La date est requise").isISO8601().toDate(),
	check("statut", "Le statut est requis").isIn(["brouillon", "publié"]),
];

// Protection des routes avec middleware d'authentification
router.use(authMiddleware);

// Routes pour les délibérations
router.get("/", deliberationsController.getAll);
router.get("/:id", deliberationsController.getById);

// Routes protégées par rôle
router.post(
	"/",
	checkRole(["admin", "secretaire"]),
	upload.fields([
		{ name: "fichierPdf", maxCount: 1 },
		{ name: "annexes", maxCount: 10 },
	]),
	deliberationValidation,
	deliberationsController.create
);

router.put(
	"/:id",
	checkRole(["admin", "secretaire"]),
	upload.fields([
		{ name: "fichierPdf", maxCount: 1 },
		{ name: "annexes", maxCount: 10 },
	]),
	deliberationValidation,
	deliberationsController.update
);

router.delete("/:id", checkRole(["admin"]), deliberationsController.delete);

router.post(
	"/:id/publier",
	checkRole(["admin", "secretaire"]),
	deliberationsController.publier
);

export default router;
*/
import { Router } from "express";
import { check, query } from "express-validator";
import deliberationsController from "../controllers/deliberationsController";
import {authMiddleware} from "../middleware/auth"; // ⚠️ 
import checkRole from "../middleware/roles";
import upload from "../middleware/upload";

const router = Router();

/* -------------------------------------------------------------------------- */
/*  Validation                                                               */
/* -------------------------------------------------------------------------- */
const STATUTS = ["brouillon", "publié"] as const;

const deliberationValidation = [
	check("titre").notEmpty().withMessage("Le titre est requis").trim(),
	check("description")
		.notEmpty()
		.withMessage("La description est requise")
		.trim(),
	check("date")
		.isISO8601()
		.withMessage("La date doit être au format ISO‑8601 (YYYY‑MM‑DD)")
		.toDate(),
	check("statut")
		.isIn(STATUTS)
		.withMessage(`Le statut doit être ${STATUTS.join(" ou ")}`),
];

const paginationValidation = [
	query("page").optional().isInt({ min: 1 }).toInt(),
	query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];

/* -------------------------------------------------------------------------- */
/*  Routes protégées par authentification                                    */
/* -------------------------------------------------------------------------- */
router.use(authMiddleware);

/* ----------------------------- Lecture ------------------------------------ */
// GET /api/deliberations?page=1&limit=10
router.get("/", paginationValidation, deliberationsController.getAll);

// GET /api/deliberations/:id
router.get("/:id", deliberationsController.getById);

/* ----------------------------- Création ----------------------------------- */
router.post(
	"/",
	checkRole(["admin", "secretaire"]),
	upload.fields([
		{ name: "fichierPdf", maxCount: 1 },
		{ name: "annexes", maxCount: 10 },
	]),
	deliberationValidation,
	deliberationsController.create
);

/* ----------------------------- Mise à jour -------------------------------- */
router.put(
	"/:id",
	checkRole(["admin", "secretaire"]),
	upload.fields([
		{ name: "fichierPdf", maxCount: 1 },
		{ name: "annexes", maxCount: 10 },
	]),
	deliberationValidation,
	deliberationsController.update
);

/* ------------------------------ Suppression ------------------------------- */
router.delete("/:id", checkRole(["admin"]), deliberationsController.delete);

/* ------------------------------ Publication ------------------------------- */
router.post(
	"/:id/publier",
	checkRole(["admin", "secretaire"]),
	deliberationsController.publier
);

export default router;
