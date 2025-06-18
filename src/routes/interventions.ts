import express from "express";
import { body, query, param } from "express-validator";
import interventionsController from "../controllers/interventionsController";
import { authMiddleware } from "../middleware/auth";
import checkRole from "../middleware/roles";
import upload from "../middleware/upload"; // Pour les documents (photos avant/après, rapports)

const router = express.Router();

router.use(authMiddleware);

const interventionValidation = [
	body("titre").notEmpty().withMessage("Le titre est requis").trim(),
	body("description")
		.notEmpty()
		.withMessage("La description est requise")
		.trim(),
	body("type")
		.notEmpty()
		.withMessage("Le type d'intervention est requis")
		.trim(),
	body("localisation.adresse")
		.notEmpty()
		.withMessage("L'adresse est requise")
		.trim(),
	body("localisation.coordonnees.latitude")
		.optional()
		.isFloat({ min: -90, max: 90 })
		.withMessage("Latitude invalide"),
	body("localisation.coordonnees.longitude")
		.optional()
		.isFloat({ min: -180, max: 180 })
		.withMessage("Longitude invalide"),
	body("statut")
		.isIn(["créée", "planifiée", "en_cours", "terminée", "validée", "annulée"])
		.withMessage("Statut invalide"),
	body("priorité")
		.isIn(["basse", "normale", "haute", "urgente"])
		.withMessage("Priorité invalide"),
	body("datePlanification")
		.optional()
		.isISO8601()
		.toDate()
		.withMessage("Date de planification invalide"),
	body("dateDebut")
		.optional()
		.isISO8601()
		.toDate()
		.withMessage("Date de début invalide"),
	body("dateFin")
		.optional()
		.isISO8601()
		.toDate()
		.withMessage("Date de fin invalide"),
	body("equipeAssignee")
		.optional()
		.isArray()
		.withMessage("L'équipe assignée doit être un tableau d'IDs d'utilisateurs"),
	body("coutEstime")
		.optional()
		.isFloat({ gt: 0 })
		.withMessage("Le coût estimé doit être un nombre positif"),
];

const statusChangeValidation = [
	body("statut")
		.isIn(["créée", "planifiée", "en_cours", "terminée", "validée", "annulée"])
		.withMessage("Nouveau statut invalide"),
	body("commentaire").optional().trim(),
];

const documentUploadValidation = [
	body("type")
		.isIn(["photo_avant", "photo_pendant", "photo_apres", "rapport", "autre"])
		.withMessage("Type de document invalide"),
	body("description").optional().trim(),
];

const finalizeValidation = [
	body("coutFinal")
		.notEmpty()
		.isFloat({ gt: 0 })
		.withMessage("Le coût final est requis et doit être positif"),
];

// Routes CRUD pour les interventions
router.get("/", interventionsController.getAllInterventions);
router.post(
	"/",
	checkRole(["admin", "technicien_chef", "agent_terrain"]), // Ajuster les rôles
	upload.array("documents", 10), // 'documents' est le nom du champ pour les fichiers multiples
	body("data").custom((value, { req }) => {
		// Pour les données JSON avec les fichiers
		if (req.body.data) {
			try {
				req.body.parsedData = JSON.parse(req.body.data);
			} catch (e) {
				throw new Error("Le champ data doit être un JSON valide");
			}
		} else {
			throw new Error("Le champ data est requis avec les fichiers");
		}
		return true;
	}),
	// Valider les champs de parsedData
	body("parsedData.titre").notEmpty().withMessage("Le titre est requis").trim(),
	// ... ajouter les autres validations de `interventionValidation` pour `parsedData`
	interventionsController.createIntervention
);

router.get("/:interventionId", interventionsController.getInterventionById);
router.put(
	"/:interventionId",
	checkRole(["admin", "technicien_chef", "agent_terrain"]),
	upload.array("documents", 10),
	body("data").custom((value, { req }) => {
		if (req.body.data) {
			try {
				req.body.parsedData = JSON.parse(req.body.data);
			} catch (e) {
				throw new Error("Le champ data doit être un JSON valide");
			}
		} else {
			throw new Error("Le champ data est requis avec les fichiers");
		}
		return true;
	}),
	// ... ajouter les autres validations de `interventionValidation` pour `parsedData`
	interventionsController.updateIntervention
);
router.delete(
	"/:interventionId",
	checkRole(["admin", "technicien_chef"]),
	interventionsController.deleteIntervention
);

// Routes spécifiques aux interventions
router.post(
	"/:interventionId/status",
	checkRole(["admin", "technicien_chef", "agent_terrain"]),
	statusChangeValidation,
	interventionsController.changeInterventionStatus
);
router.post(
	"/:interventionId/documents",
	checkRole(["admin", "technicien_chef", "agent_terrain"]),
	upload.single("file"), // 'file' pour un seul document à la fois
	documentUploadValidation,
	interventionsController.addDocumentToIntervention
);
router.delete(
	"/:interventionId/documents/:documentId",
	checkRole(["admin", "technicien_chef"]),
	interventionsController.deleteDocumentFromIntervention
);

router.post(
	"/:interventionId/comments",
	checkRole(["admin", "technicien_chef", "agent_terrain"]),
	[body("texte").notEmpty().withMessage("Le texte du commentaire est requis")],
	interventionsController.addDocumentToIntervention
);

router.post(
	"/:interventionId/finalize",
	checkRole(["admin", "technicien_chef"]),
	finalizeValidation,
	interventionsController.finalizeIntervention
); // Valider et enregistrer sur blockchain

// Route pour enregistrer sur la blockchain (déclenchée manuellement ou automatiquement après validation)
router.post(
	"/:interventionId/blockchain-record",
	checkRole(["admin", "technicien_chef"]),
	interventionsController.recordInterventionOnBlockchain
);

export default router;
