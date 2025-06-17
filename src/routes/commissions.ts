import express from "express";
import { body, param } from "express-validator";
import commissionsController from "../controllers/commissionsController";
import { authMiddleware } from "../middleware/auth";
import checkRole from "../middleware/roles";
import upload from "../middleware/upload"; // Pour les documents des réunions

const router = express.Router();

router.use(authMiddleware); // Toutes les routes des commissions nécessitent une authentification

// Validation pour la création/mise à jour de commission
const commissionValidation = [
	body("nom")
		.notEmpty()
		.withMessage("Le nom de la commission est requis")
		.trim(),
	body("type")
		.notEmpty()
		.withMessage("Le type de commission est requis")
		.trim(),
	body("description").optional().trim(),
	body("membres")
		.isArray()
		.withMessage("Les membres doivent être un tableau")
		.optional(),
	body("membres.*.nom")
		.if(body("membres").exists())
		.notEmpty()
		.withMessage("Le nom du membre est requis"),
	body("membres.*.prenom")
		.if(body("membres").exists())
		.notEmpty()
		.withMessage("Le prénom du membre est requis"),
	body("membres.*.fonction")
		.if(body("membres").exists())
		.notEmpty()
		.withMessage("La fonction du membre est requise"),
	body("membres.*.email")
		.if(body("membres").exists())
		.optional()
		.isEmail()
		.withMessage("Email de membre invalide"),
];

// Validation pour une réunion
const reunionValidation = [
	body("date")
		.isISO8601()
		.toDate()
		.withMessage("La date de réunion est requise et doit être valide"),
	body("lieu").optional().trim(),
	body("statut")
		.isIn(["planifiée", "terminée", "annulée"])
		.withMessage("Statut de réunion invalide"),
	body("ordre_du_jour").optional().trim(),
	body("compte_rendu").optional().trim(),
	body("presents")
		.optional()
		.isArray()
		.withMessage("La liste des présents doit être un tableau d'IDs"),
	body("excuses")
		.optional()
		.isArray()
		.withMessage("La liste des excusés doit être un tableau d'IDs"),
];

// Validation pour une action de suivi
const actionValidation = [
	body("description")
		.notEmpty()
		.withMessage("La description de l'action est requise"),
	body("responsables")
		.isArray({ min: 1 })
		.withMessage("Au moins un responsable est requis pour l'action"),
	body("echeance")
		.optional()
		.isISO8601()
		.toDate()
		.withMessage("Échéance invalide"),
	body("statut")
		.isIn(["à_faire", "en_cours", "terminé", "annulé"])
		.withMessage("Statut d'action invalide"),
];

// Routes CRUD pour les commissions
router.get("/", commissionsController.getAllCommissions);
router.post(
	"/",
	checkRole(["admin", "secretaire_mairie"]),
	commissionValidation,
	commissionsController.createCommission
);
router.get("/:commissionId", commissionsController.getCommissionById);
router.put(
	"/:commissionId",
	checkRole(["admin", "secretaire_mairie"]),
	commissionValidation,
	commissionsController.updateCommission
);
router.delete(
	"/:commissionId",
	checkRole(["admin"]),
	commissionsController.deleteCommission
);

// Routes pour les membres d'une commission
router.post(
	"/:commissionId/membres",
	checkRole(["admin", "secretaire_mairie"]),
	commissionsController.addMembreToCommission
);
router.put(
	"/:commissionId/membres/:membreId",
	checkRole(["admin", "secretaire_mairie"]),
	commissionsController.updateMembreInCommission
);
router.delete(
	"/:commissionId/membres/:membreId",
	checkRole(["admin", "secretaire_mairie"]),
	commissionsController.removeMembreFromCommission
);

// Routes pour les réunions d'une commission
router.get(
	"/:commissionId/reunions",
	commissionsController.getReunionsByCommission
);
router.post(
	"/:commissionId/reunions",
	checkRole(["admin", "secretaire_mairie"]),
	reunionValidation,
	commissionsController.createReunion
);
router.get(
	"/:commissionId/reunions/:reunionId",
	commissionsController.getReunionById
);
router.put(
	"/:commissionId/reunions/:reunionId",
	checkRole(["admin", "secretaire_mairie"]),
	reunionValidation,
	commissionsController.updateReunion
);
router.delete(
	"/:commissionId/reunions/:reunionId",
	checkRole(["admin", "secretaire_mairie"]),
	commissionsController.deleteReunion
);

// Routes pour les documents d'une réunion
router.post(
	"/:commissionId/reunions/:reunionId/documents",
	checkRole(["admin", "secretaire_mairie"]),
	upload.single("file"), // 'file' est le nom du champ dans le FormData
	[
		body("titre").notEmpty().withMessage("Le titre du document est requis"),
		body("type")
			.isIn([
				"ordre_du_jour",
				"compte_rendu",
				"presentation",
				"document_travail",
				"autre",
			])
			.withMessage("Type de document invalide"),
	],
	commissionsController.addDocumentToReunion
);
router.delete(
	"/:commissionId/reunions/:reunionId/documents/:documentId",
	checkRole(["admin", "secretaire_mairie"]),
	commissionsController.deleteDocumentFromReunion
);

// Routes pour les actions de suivi d'une réunion
router.post(
	"/:commissionId/reunions/:reunionId/actions",
	checkRole(["admin", "secretaire_mairie"]),
	actionValidation,
	commissionsController.createActionSuivi
);
router.put(
	"/:commissionId/reunions/:reunionId/actions/:actionId",
	checkRole(["admin", "secretaire_mairie"]),
	actionValidation,
	commissionsController.updateActionSuivi
);
router.delete(
	"/:commissionId/reunions/:reunionId/actions/:actionId",
	checkRole(["admin", "secretaire_mairie"]),
	commissionsController.deleteActionSuivi
);

export default router;
