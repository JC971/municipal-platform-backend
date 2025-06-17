import express from "express";
import { body, query, param } from "express-validator";
import doleancesController from "../controllers/doleancesController";
import {authMiddleware} from "../middleware/auth";
import checkRole from "../middleware/roles";
//import upload from "../middleware/upload"; // Pour les photos des doléances
import multer from "multer";

const router = express.Router();

const upload = multer({
	dest: "uploads/doleances"
}) // Dossier où les photos seront stockées	

// Routes publiques pour la création et le suivi par numéro
router.post(
	"/",
	upload.any(), // ✅ accepte photo_0, photo_1, etc.
	body("data").custom((value, { req }) => {
		if (!req.body.data) throw new Error("Le champ data est requis");
		try {
			req.body.parsedData = JSON.parse(req.body.data);
		} catch {
			throw new Error("Le champ data doit être un JSON valide");
		}
		return true;
	}),
	// Validation sur parsedData
	body("parsedData.titre").notEmpty().withMessage("Le titre est requis").trim(),
	body("parsedData.description")
		.notEmpty()
		.withMessage("La description est requise")
		.trim(),
	body("parsedData.categorie").optional().trim(),
	body("parsedData.localisation.adresse").optional().trim(),
	body("parsedData.localisation.coordonnees.latitude")
		.optional()
		.isFloat({ min: -90, max: 90 }),
	body("parsedData.localisation.coordonnees.longitude")
		.optional()
		.isFloat({ min: -180, max: 180 }),
	body("parsedData.citoyen.anonyme")
		.isBoolean()
		.withMessage("Le champ anonyme est requis (true/false)"),
	body("parsedData.citoyen.nom")
		.if(body("parsedData.citoyen.anonyme").equals("false"))
		.notEmpty()
		.withMessage("Le nom est requis si non anonyme"),
	body("parsedData.citoyen.email")
		.if(body("parsedData.citoyen.anonyme").equals("false"))
		.isEmail()
		.withMessage("Email invalide"),
	body("parsedData.citoyen.telephone").optional().trim(),
	doleancesController.createDoleance // Contrôleur public
);

router.get("/suivi/:numeroSuivi", doleancesController.getDoleanceByNumeroSuivi); // Route publique

// Middleware d'authentification pour les routes de gestion interne
router.use(authMiddleware);

const doleanceUpdateValidation = [
	// Pour la mise à jour interne
	body("titre")
		.optional()
		.notEmpty()
		.withMessage("Le titre ne peut être vide")
		.trim(),
	body("description")
		.optional()
		.notEmpty()
		.withMessage("La description ne peut être vide")
		.trim(),
	body("statut")
		.optional()
		.isIn([
			"reçue",
			"qualifiée",
			"assignée",
			"planifiée",
			"en_cours",
			"résolue",
			"clôturée",
			"rejetée",
		]),
	body("urgence").optional().isIn(["basse", "normale", "élevée", "critique"]),
	body("categorie").optional().trim(),
	body("interventionLieeId")
		.optional()
		.isUUID()
		.withMessage("L'ID de l'intervention liée doit être un UUID valide"),
	body("assigneA")
		.optional()
		.isArray()
		.withMessage("La liste des agents assignés doit être un tableau d'IDs"),
];

const statusChangeValidation = [
	body("statut")
		.isIn([
			"reçue",
			"qualifiée",
			"assignée",
			"planifiée",
			"en_cours",
			"résolue",
			"clôturée",
			"rejetée",
		])
		.withMessage("Nouveau statut invalide"),
	body("commentaire").optional().trim(),
];

const assignValidation = [
	body("agentIds")
		.isArray({ min: 1 })
		.withMessage("Au moins un ID d'agent est requis"),
	body("agentIds.*")
		.isUUID()
		.withMessage("Chaque ID d'agent doit être un UUID valide"),
];

const linkInterventionValidation = [
	body("interventionId")
		.isUUID()
		.withMessage("L'ID de l'intervention doit être un UUID valide"),
];

const resolveValidation = [
	body("coutResolution")
		.optional()
		.isFloat({ gt: 0 })
		.withMessage("Le coût de résolution doit être un nombre positif"),
	body("commentaireResolution").optional().trim(),
];

// Routes de gestion interne (nécessitent authentification)
router.get(
	"/",
	checkRole(["admin", "agent_accueil", "technicien_mairie"]),
	doleancesController.getAllDoleances
); // Accès interne
router.get(
	"/:doleanceId",
	checkRole(["admin", "agent_accueil", "technicien_mairie"]),
	doleancesController.getDoleanceByIdInternal
);

router.put(
	"/:doleanceId",
	checkRole(["admin", "agent_accueil", "technicien_mairie"]),
	upload.array("photos", 5), // Permet d'ajouter/modifier des photos lors de la mise à jour
	body("data").custom((value, { req }) => {
		if (req.body.data) {
			try {
				req.body.parsedData = JSON.parse(req.body.data);
			} catch {
				throw new Error("Le champ data doit être un JSON valide");
			}
		} else {
			// Aucune donnée texte ? On crée un objet vide pour éviter undefined
			req.body.parsedData = {};
		}
		return true;
	}),
	
	doleancesController.updateDoleanceInternal
);

router.delete(
	"/:doleanceId",
	checkRole(["admin"]),
	doleancesController.deleteDoleanceInternal
);

// Routes spécifiques à la gestion interne des doléances
router.post(
	"/:doleanceId/status",
	checkRole(["admin", "agent_accueil", "technicien_mairie"]),
	statusChangeValidation,
	doleancesController.changeDoleanceStatus
);
router.post(
	"/:doleanceId/assigner",
	checkRole(["admin", "technicien_mairie"]),
	assignValidation,
	doleancesController.assignDoleanceToAgent
);
router.post(
	"/:doleanceId/lier-intervention",
	checkRole(["admin", "technicien_mairie"]),
	linkInterventionValidation,
	doleancesController.linkDoleanceToIntervention
);
router.post(
	"/:doleanceId/resoudre",
	checkRole(["admin", "technicien_mairie"]),
	resolveValidation,
	doleancesController.resolveDoleance
);

router.post(
	"/:doleanceId/photos",
	checkRole(["admin", "agent_accueil", "technicien_mairie"]),
	upload.array("photos", 5), // Permet d'ajouter de nouvelles photos
	doleancesController.addPhotosToDoleance
);
router.delete(
	"/:doleanceId/photos/:photoId",
	checkRole(["admin", "agent_accueil", "technicien_mairie"]),
	doleancesController.deletePhotoFromDoleance
);

router.post(
	"/:doleanceId/commentaires",
	checkRole(["admin", "agent_accueil", "technicien_mairie"]),
	[body("texte").notEmpty().withMessage("Le texte du commentaire est requis")],
	doleancesController.addInternalCommentToDoleance
);
router.post(
	"/:doleanceId/reponse-publique",
	checkRole(["admin", "agent_communication"]),
	[body("texte").notEmpty().withMessage("Le texte de la réponse est requis")],
	doleancesController.addPublicResponseToDoleance
);

// Route pour enregistrer sur la blockchain
router.post(
	"/:doleanceId/blockchain-record",
	checkRole(["admin"]),
	doleancesController.recordDoleanceOnBlockchain
);

export default router;
