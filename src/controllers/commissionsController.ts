import { Request, Response } from "express";
import { validationResult } from "express-validator";
import pool from "../config/database";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const UPLOAD_COMMISSIONS_DIR = path.join(
	__dirname,
	"../../uploads/commissions"
);
if (!fs.existsSync(UPLOAD_COMMISSIONS_DIR)) {
	fs.mkdirSync(UPLOAD_COMMISSIONS_DIR, { recursive: true });
}

const commissionsController = {
	// --- Commissions ---
	getAllCommissions: async (req: Request, res: Response) => {
		try {
			// TODO: Ajouter filtres et pagination si nécessaire
			const result = await pool.query(`
        SELECT c.*, 
               COALESCE(json_agg(DISTINCT m.*) FILTER (WHERE m.id IS NOT NULL), '[]') as membres,
               (SELECT COUNT(r.id) FROM reunions r WHERE r.commission_id = c.id) as nombre_reunions
        FROM commissions c
        LEFT JOIN membres_commission m ON c.id = m.commission_id
        GROUP BY c.id
        ORDER BY c.nom ASC
      `);
			res.json(result.rows);
		} catch (error: any) {
			console.error("Erreur getAllCommissions:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	createCommission: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		const { nom, description, type, membres } = req.body;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const commissionResult = await client.query(
				"INSERT INTO commissions (nom, description, type, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
				[nom, description, type]
			);
			const newCommission = commissionResult.rows[0];

			const membresData = [];
			if (membres && membres.length > 0) {
				for (const membre of membres) {
					const membreResult = await client.query(
						"INSERT INTO membres_commission (commission_id, nom, prenom, fonction, email) VALUES ($1, $2, $3, $4, $5) RETURNING *",
						[
							newCommission.id,
							membre.nom,
							membre.prenom,
							membre.fonction,
							membre.email || null,
						]
					);
					membresData.push(membreResult.rows[0]);
				}
			}
			newCommission.membres = membresData;

			await client.query("COMMIT");
			res.status(201).json(newCommission);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur createCommission:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	getCommissionById: async (req: Request, res: Response) => {
		const { commissionId } = req.params;
		try {
			const commissionResult = await pool.query(
				`
        SELECT c.*,
               COALESCE(json_agg(DISTINCT m.*) FILTER (WHERE m.id IS NOT NULL), '[]') as membres,
               COALESCE(json_agg(DISTINCT r.* ORDER BY r.date DESC) FILTER (WHERE r.id IS NOT NULL AND r.commission_id = c.id), '[]') as reunions_details
        FROM commissions c
        LEFT JOIN membres_commission m ON c.id = m.commission_id
        LEFT JOIN reunions r ON c.id = r.commission_id
        WHERE c.id = $1
        GROUP BY c.id
      `,
				[commissionId]
			);

			if (commissionResult.rows.length === 0) {
				return res.status(404).json({ message: "Commission non trouvée" });
			}

			// Pour chaque réunion, récupérer ses documents et actions
			const commission = commissionResult.rows[0];
			if (
				commission.reunions_details &&
				commission.reunions_details.length > 0
			) {
				for (let reunion of commission.reunions_details) {
					const documentsResult = await pool.query(
						"SELECT * FROM documents_reunion WHERE reunion_id = $1 ORDER BY created_at DESC",
						[reunion.id]
					);
					reunion.documents = documentsResult.rows.map((doc) => ({
						...doc,
						url: doc.url ? `/uploads/commissions/${doc.url}` : null,
					}));

					const actionsResult = await pool.query(
						`
                SELECT a_s.*, 
                       COALESCE(json_agg(DISTINCT m_c.*) FILTER (WHERE m_c.id IS NOT NULL), '[]') as responsables_details
                FROM actions_suivi a_s
                LEFT JOIN responsables_action r_a ON a_s.id = r_a.action_id
                LEFT JOIN membres_commission m_c ON r_a.membre_id = m_c.id
                WHERE a_s.reunion_id = $1
                GROUP BY a_s.id
                ORDER BY a_s.created_at DESC
            `,
						[reunion.id]
					);
					reunion.actions = actionsResult.rows;
				}
			}

			res.json(commission);
		} catch (error: any) {
			console.error("Erreur getCommissionById:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	updateCommission: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		const { commissionId } = req.params;
		const { nom, description, type } = req.body; // La gestion des membres se fera via des routes dédiées
		try {
			const result = await pool.query(
				"UPDATE commissions SET nom = $1, description = $2, type = $3, updated_at = NOW() WHERE id = $4 RETURNING *",
				[nom, description, type, commissionId]
			);
			if (result.rows.length === 0) {
				return res.status(404).json({ message: "Commission non trouvée" });
			}
			res.json(result.rows[0]);
		} catch (error: unknown) {
			console.error("Erreur updateCommission:", error);
			const errorMessage = error instanceof Error ? error.message : String(error);
			res.status(500).json({ message: "Erreur serveur", error: errorMessage });
		}
	},

	deleteCommission: async (req: Request, res: Response) => {
		const { commissionId } = req.params;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			// TODO: Gérer la suppression des documents liés aux réunions de cette commission
			// 1. Récupérer toutes les réunions de la commission
			// 2. Pour chaque réunion, récupérer ses documents et les supprimer du disque
			// 3. Supprimer les entrées de documents_reunion
			// 4. Supprimer les responsables_action, puis actions_suivi
			// 5. Supprimer les presences, puis reunions
			// 6. Supprimer les membres_commission
			// 7. Supprimer la commission

			const reunions = await client.query(
				"SELECT id FROM reunions WHERE commission_id = $1",
				[commissionId]
			);
			for (const reunion of reunions.rows) {
				const documents = await client.query(
					"SELECT url FROM documents_reunion WHERE reunion_id = $1",
					[reunion.id]
				);
				for (const doc of documents.rows) {
					if (doc.url) {
						const docPath = path.join(UPLOAD_COMMISSIONS_DIR, doc.url);
						if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
					}
				}
				await client.query(
					"DELETE FROM documents_reunion WHERE reunion_id = $1",
					[reunion.id]
				);
				await client.query(
					"DELETE FROM responsables_action WHERE action_id IN (SELECT id FROM actions_suivi WHERE reunion_id = $1)",
					[reunion.id]
				);
				await client.query("DELETE FROM actions_suivi WHERE reunion_id = $1", [
					reunion.id,
				]);
				await client.query("DELETE FROM presences WHERE reunion_id = $1", [
					reunion.id,
				]);
			}
			await client.query("DELETE FROM reunions WHERE commission_id = $1", [
				commissionId,
			]);
			await client.query(
				"DELETE FROM membres_commission WHERE commission_id = $1",
				[commissionId]
			);
			const result = await client.query(
				"DELETE FROM commissions WHERE id = $1 RETURNING *",
				[commissionId]
			);

			if (result.rowCount === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Commission non trouvée" });
			}
			await client.query("COMMIT");
			res.json({
				message:
					"Commission et toutes ses données associées supprimées avec succès",
			});
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur deleteCommission:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	// --- Membres Commission ---
	addMembreToCommission: async (req: Request, res: Response) => {
		const errors = validationResult(req); // S'assurer d'avoir une validation pour les membres
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		const { commissionId } = req.params;
		const { nom, prenom, fonction, email } = req.body;
		try {
			const result = await pool.query(
				"INSERT INTO membres_commission (commission_id, nom, prenom, fonction, email) VALUES ($1, $2, $3, $4, $5) RETURNING *",
				[commissionId, nom, prenom, fonction, email || null]
			);
			res.status(201).json(result.rows[0]);
		} catch (error: any) {
			console.error("Erreur addMembreToCommission:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	updateMembreInCommission: async (req: Request, res: Response) => {
		const { commissionId, membreId } = req.params;
		const { nom, prenom, fonction, email } = req.body;
		try {
			const result = await pool.query(
				"UPDATE membres_commission SET nom = $1, prenom = $2, fonction = $3, email = $4 WHERE id = $5 AND commission_id = $6 RETURNING *",
				[nom, prenom, fonction, email || null, membreId, commissionId]
			);
			if (result.rows.length === 0) {
				return res
					.status(404)
					.json({ message: "Membre non trouvé dans cette commission" });
			}
			res.json(result.rows[0]);
		} catch (error: any) {
			console.error("Erreur updateMembreInCommission:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	removeMembreFromCommission: async (req: Request, res: Response) => {
		const { commissionId, membreId } = req.params;
		try {
			// Avant de supprimer un membre, s'assurer qu'il n'est pas responsable d'actions en cours.
			// Ou le désassigner / permettre le transfert de responsabilité.
			// Pour simplifier, on le supprime directement.
			// Il faudra aussi le retirer des listes de `presents` et `excuses` des réunions.
			await pool.query(
				"DELETE FROM responsables_action WHERE membre_id = $1 AND action_id IN (SELECT a.id FROM actions_suivi a JOIN reunions r ON a.reunion_id = r.id WHERE r.commission_id = $2)",
				[membreId, commissionId]
			);
			await pool.query(
				"DELETE FROM presences WHERE membre_id = $1 AND reunion_id IN (SELECT id FROM reunions WHERE commission_id = $2)",
				[membreId, commissionId]
			);

			const result = await pool.query(
				"DELETE FROM membres_commission WHERE id = $1 AND commission_id = $2 RETURNING *",
				[membreId, commissionId]
			);
			if (result.rowCount === 0) {
				return res
					.status(404)
					.json({ message: "Membre non trouvé dans cette commission" });
			}
			res.json({ message: "Membre supprimé de la commission avec succès" });
		} catch (error: any) {
			console.error("Erreur removeMembreFromCommission:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	// --- Réunions ---
	getReunionsByCommission: async (req: Request, res: Response) => {
		const { commissionId } = req.params;
		try {
			const reunionsResult = await pool.query(
				"SELECT * FROM reunions WHERE commission_id = $1 ORDER BY date DESC",
				[commissionId]
			);

			const reunionsDetails = [];
			for (let reunion of reunionsResult.rows) {
				const documentsResult = await pool.query(
					"SELECT * FROM documents_reunion WHERE reunion_id = $1 ORDER BY created_at DESC",
					[reunion.id]
				);
				reunion.documents = documentsResult.rows.map((doc) => ({
					...doc,
					url: doc.url ? `/uploads/commissions/${doc.url}` : null,
				}));

				const actionsResult = await pool.query(
					`SELECT a_s.*, 
                       COALESCE(json_agg(DISTINCT m_c.*) FILTER (WHERE m_c.id IS NOT NULL), '[]') as responsables_details
                FROM actions_suivi a_s
                LEFT JOIN responsables_action r_a ON a_s.id = r_a.action_id
                LEFT JOIN membres_commission m_c ON r_a.membre_id = m_c.id
                WHERE a_s.reunion_id = $1
                GROUP BY a_s.id
                ORDER BY a_s.created_at DESC`,
					[reunion.id]
				);
				reunion.actions = actionsResult.rows;
				reunionsDetails.push(reunion);
			}
			res.json(reunionsDetails);
		} catch (error: any) {
			console.error("Erreur getReunionsByCommission:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	createReunion: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		const { commissionId } = req.params;
		const {
			date,
			lieu,
			statut,
			ordre_du_jour,
			compte_rendu,
			presents,
			excuses,
		} = req.body;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const reunionResult = await client.query(
				"INSERT INTO reunions (commission_id, date, lieu, statut, ordre_du_jour, compte_rendu, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *",
				[commissionId, date, lieu, statut, ordre_du_jour, compte_rendu]
			);
			const newReunion = reunionResult.rows[0];

			if (presents && presents.length > 0) {
				for (const membreId of presents) {
					await client.query(
						"INSERT INTO presences (reunion_id, membre_id, statut) VALUES ($1, $2, $3)",
						[newReunion.id, membreId, "présent"]
					);
				}
			}
			if (excuses && excuses.length > 0) {
				for (const membreId of excuses) {
					await client.query(
						"INSERT INTO presences (reunion_id, membre_id, statut) VALUES ($1, $2, $3)",
						[newReunion.id, membreId, "excusé"]
					);
				}
			}

			await client.query("COMMIT");
			res.status(201).json(newReunion);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur createReunion:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	getReunionById: async (req: Request, res: Response) => {
		const { reunionId } = req.params;
		try {
			const reunionResult = await pool.query(
				"SELECT * FROM reunions WHERE id = $1",
				[reunionId]
			);
			if (reunionResult.rows.length === 0) {
				return res.status(404).json({ message: "Réunion non trouvée" });
			}
			const reunion = reunionResult.rows[0];

			const documentsResult = await pool.query(
				"SELECT * FROM documents_reunion WHERE reunion_id = $1 ORDER BY created_at DESC",
				[reunion.id]
			);
			reunion.documents = documentsResult.rows.map((doc) => ({
				...doc,
				url: doc.url ? `/uploads/commissions/${doc.url}` : null,
			}));

			const actionsResult = await pool.query(
				`SELECT a_s.*, 
                   COALESCE(json_agg(DISTINCT m_c.*) FILTER (WHERE m_c.id IS NOT NULL), '[]') as responsables_details
            FROM actions_suivi a_s
            LEFT JOIN responsables_action r_a ON a_s.id = r_a.action_id
            LEFT JOIN membres_commission m_c ON r_a.membre_id = m_c.id
            WHERE a_s.reunion_id = $1
            GROUP BY a_s.id
            ORDER BY a_s.created_at DESC`,
				[reunion.id]
			);
			reunion.actions = actionsResult.rows;

			const presencesResult = await pool.query(
				`SELECT m_c.*, p.statut 
             FROM presences p 
             JOIN membres_commission m_c ON p.membre_id = m_c.id 
             WHERE p.reunion_id = $1`,
				[reunion.id]
			);
			reunion.participants = presencesResult.rows;

			res.json(reunion);
		} catch (error: any) {
			console.error("Erreur getReunionById:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	updateReunion: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		const { reunionId } = req.params;
		const {
			date,
			lieu,
			statut,
			ordre_du_jour,
			compte_rendu,
			presents,
			excuses,
		} = req.body;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const result = await client.query(
				"UPDATE reunions SET date = $1, lieu = $2, statut = $3, ordre_du_jour = $4, compte_rendu = $5, updated_at = NOW() WHERE id = $6 RETURNING *",
				[date, lieu, statut, ordre_du_jour, compte_rendu, reunionId]
			);
			if (result.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Réunion non trouvée" });
			}

			// Mettre à jour les présences
			await client.query("DELETE FROM presences WHERE reunion_id = $1", [
				reunionId,
			]);
			if (presents && presents.length > 0) {
				for (const membreId of presents) {
					await client.query(
						"INSERT INTO presences (reunion_id, membre_id, statut) VALUES ($1, $2, $3)",
						[reunionId, membreId, "présent"]
					);
				}
			}
			if (excuses && excuses.length > 0) {
				for (const membreId of excuses) {
					await client.query(
						"INSERT INTO presences (reunion_id, membre_id, statut) VALUES ($1, $2, $3)",
						[reunionId, membreId, "excusé"]
					);
				}
			}

			await client.query("COMMIT");
			// Re-fetch pour avoir les données complètes
			return commissionsController.getReunionById(req, res);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur updateReunion:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	deleteReunion: async (req: Request, res: Response) => {
		const { reunionId } = req.params;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			// Supprimer documents, actions, présences liés avant de supprimer la réunion
			const documents = await client.query(
				"SELECT url FROM documents_reunion WHERE reunion_id = $1",
				[reunionId]
			);
			for (const doc of documents.rows) {
				if (doc.url) {
					const docPath = path.join(UPLOAD_COMMISSIONS_DIR, doc.url);
					if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
				}
			}
			await client.query(
				"DELETE FROM documents_reunion WHERE reunion_id = $1",
				[reunionId]
			);
			await client.query(
				"DELETE FROM responsables_action WHERE action_id IN (SELECT id FROM actions_suivi WHERE reunion_id = $1)",
				[reunionId]
			);
			await client.query("DELETE FROM actions_suivi WHERE reunion_id = $1", [
				reunionId,
			]);
			await client.query("DELETE FROM presences WHERE reunion_id = $1", [
				reunionId,
			]);

			const result = await client.query(
				"DELETE FROM reunions WHERE id = $1 RETURNING *",
				[reunionId]
			);
			if (result.rowCount === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Réunion non trouvée" });
			}
			await client.query("COMMIT");
			res.json({ message: "Réunion supprimée avec succès" });
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur deleteReunion:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	// --- Documents Réunion ---
	addDocumentToReunion: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			if (req.file) fs.unlinkSync(req.file.path); // Supprimer le fichier uploadé si validation échoue
			return res.status(400).json({ errors: errors.array() });
		}

		const { reunionId } = req.params;
		const { titre, type, description } = req.body;

		if (!req.file) {
			return res.status(400).json({ message: "Aucun fichier fourni" });
		}
		const file = req.file;
		const newFilename = `${uuidv4()}-${file.originalname.replace(/\s+/g, "_")}`;
		const newPath = path.join(UPLOAD_COMMISSIONS_DIR, newFilename);

		try {
			fs.renameSync(file.path, newPath); // Déplacer de tmp vers le dossier final

			const result = await pool.query(
				"INSERT INTO documents_reunion (reunion_id, titre, description, url, type, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *",
				[reunionId, titre, description || null, newFilename, type]
			);
			const newDoc = result.rows[0];
			newDoc.url = `/uploads/commissions/${newFilename}`;
			res.status(201).json(newDoc);
		} catch (error: any) {
			if (fs.existsSync(newPath))
				fs.unlinkSync(newPath); // Supprimer le fichier si erreur DB
			else if (fs.existsSync(file.path)) fs.unlinkSync(file.path); // Si rename n'a pas eu lieu
			console.error("Erreur addDocumentToReunion:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	deleteDocumentFromReunion: async (req: Request, res: Response) => {
		const { documentId } = req.params;
		try {
			const docResult = await pool.query(
				"SELECT url FROM documents_reunion WHERE id = $1",
				[documentId]
			);
			if (docResult.rows.length === 0) {
				return res.status(404).json({ message: "Document non trouvé" });
			}
			const docUrl = docResult.rows[0].url;

			const deleteResult= await pool.query(
				"DELETE FROM documents_reunion WHERE id = $1 RETURNING *",
				[documentId]
			);
			if ((deleteResult.rowCount ?? 0 > 0) && docUrl) {
				const docPath = path.join(UPLOAD_COMMISSIONS_DIR, docUrl);
				if (fs.existsSync(docPath)) {
					fs.unlinkSync(docPath);
				}
			}
			res.json({ message: "Document supprimé avec succès" });
		} catch (error: any) {
			console.error("Erreur deleteDocumentFromReunion:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	// --- Actions Suivi ---
	createActionSuivi: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		const { reunionId } = req.params;
		const { description, responsables, echeance, statut } = req.body; // responsables est un array d'IDs de membres_commission
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const actionResult = await client.query(
				"INSERT INTO actions_suivi (reunion_id, description, echeance, statut, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
				[reunionId, description, echeance || null, statut]
			);
			const newAction = actionResult.rows[0];

			const responsablesDetails = [];
			for (const membreId of responsables) {
				await client.query(
					"INSERT INTO responsables_action (action_id, membre_id) VALUES ($1, $2)",
					[newAction.id, membreId]
				);
				// Optionnel: récupérer les détails du membre pour la réponse
				// const membreDetails = await client.query('SELECT id, nom, prenom FROM membres_commission WHERE id = $1', [membreId]);
				// if(membreDetails.rows.length > 0) responsablesDetails.push(membreDetails.rows[0]);
			}
			// newAction.responsables_details = responsablesDetails;

			await client.query("COMMIT");
			// Re-fetch pour avoir les responsables
			const finalAction = await pool.query(
				`SELECT a_s.*, COALESCE(json_agg(DISTINCT m_c.*) FILTER (WHERE m_c.id IS NOT NULL), '[]') as responsables_details
         FROM actions_suivi a_s
         LEFT JOIN responsables_action r_a ON a_s.id = r_a.action_id
         LEFT JOIN membres_commission m_c ON r_a.membre_id = m_c.id
         WHERE a_s.id = $1 GROUP BY a_s.id`,
				[newAction.id]
			);
			res.status(201).json(finalAction.rows[0]);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur createActionSuivi:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	updateActionSuivi: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		const { actionId } = req.params;
		const { description, responsables, echeance, statut } = req.body;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const result = await client.query(
				"UPDATE actions_suivi SET description = $1, echeance = $2, statut = $3, updated_at = NOW() WHERE id = $4 RETURNING *",
				[description, echeance || null, statut, actionId]
			);
			if (result.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Action non trouvée" });
			}

			// Mettre à jour les responsables
			await client.query(
				"DELETE FROM responsables_action WHERE action_id = $1",
				[actionId]
			);
			for (const membreId of responsables) {
				await client.query(
					"INSERT INTO responsables_action (action_id, membre_id) VALUES ($1, $2)",
					[actionId, membreId]
				);
			}

			await client.query("COMMIT");
			const finalAction = await pool.query(
				`SELECT a_s.*, COALESCE(json_agg(DISTINCT m_c.*) FILTER (WHERE m_c.id IS NOT NULL), '[]') as responsables_details
         FROM actions_suivi a_s
         LEFT JOIN responsables_action r_a ON a_s.id = r_a.action_id
         LEFT JOIN membres_commission m_c ON r_a.membre_id = m_c.id
         WHERE a_s.id = $1 GROUP BY a_s.id`,
				[actionId]
			);
			res.json(finalAction.rows[0]);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur updateActionSuivi:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	deleteActionSuivi: async (req: Request, res: Response) => {
		const { actionId } = req.params;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				"DELETE FROM responsables_action WHERE action_id = $1",
				[actionId]
			);
			const result = await client.query(
				"DELETE FROM actions_suivi WHERE id = $1 RETURNING *",
				[actionId]
			);
			if (result.rowCount === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Action non trouvée" });
			}
			await client.query("COMMIT");
			res.json({ message: "Action supprimée avec succès" });
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur deleteActionSuivi:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},
};

export default commissionsController;
