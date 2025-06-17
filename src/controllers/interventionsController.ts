import crypto from "crypto";
import { Request, Response } from "express";
import { validationResult } from "express-validator";
import pool from "../config/database";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import blockchainService from "../services/blockchainService"; // Service pour interagir avec la blockchain

const UPLOAD_INTERVENTIONS_DIR = path.join(
	__dirname,
	"../../uploads/interventions"
);
if (!fs.existsSync(UPLOAD_INTERVENTIONS_DIR)) {
	fs.mkdirSync(UPLOAD_INTERVENTIONS_DIR, { recursive: true });
}

const interventionsController = {
	getAllInterventions: async (req: Request, res: Response) => {
		try {
			const {
				texte,
				type,
				statut,
				priorité,
				dateDebut,
				dateFin,
				zone,
				page = 1,
				limit = 10,
			} = req.query;

			let query = `
SELECT i.*,
       (SELECT username FROM users WHERE id = i.created_by) AS createur_username,

       COALESCE(json_agg(
         jsonb_build_object(
           'id', d.id,
           'nom', d.nom,
           'url', d.url,
           'date_ajout', d.date_ajout
         )
         ORDER BY d.date_ajout DESC
       ) FILTER (WHERE d.id IS NOT NULL), '[]') AS documents_files,

       COALESCE(json_agg(
         jsonb_build_object(
           'id', c.id,
           'texte', c.texte,
           'date', c.date,
           'auteur_id', c.auteur_id
         )
         ORDER BY c.date DESC
       ) FILTER (WHERE c.id IS NOT NULL), '[]') AS commentaires_list,

       COALESCE(json_agg(
         jsonb_build_object(
           'id', u.id,
           'username', u.username,
           'email', u.email
         )
       ) FILTER (WHERE u.id IS NOT NULL), '[]') AS equipe_assignee_noms,

       (
         SELECT json_build_object(
           'transactionHash', bi.transaction_hash,
           'blockNumber', bi.block_number,
           'timestamp', bi.timestamp_blockchain
         )
         FROM blockchain_interventions bi
         WHERE bi.intervention_id = i.id
         ORDER BY bi.created_at DESC
         LIMIT 1
       ) AS blockchain_info

FROM interventions i
LEFT JOIN documents_intervention d ON i.id = d.intervention_id
LEFT JOIN commentaires_intervention c ON i.id = c.intervention_id
LEFT JOIN equipes_intervention ei ON i.id = ei.intervention_id
LEFT JOIN users u ON ei.agent_id = u.id
`;
			const whereConditions: string[] = [];
			const queryParams: any[] = [];
			let paramIndex = 1;

			if (texte) {
				whereConditions.push(
					`(i.titre ILIKE $${paramIndex} OR i.description ILIKE $${paramIndex} OR i.adresse ILIKE $${paramIndex})`
				);
				queryParams.push(`%${texte}%`);
				paramIndex++;
			}
			if (type) {
				whereConditions.push(`i.type = $${paramIndex}`);
				queryParams.push(type);
				paramIndex++;
			}
			if (statut) {
				whereConditions.push(`i.statut = $${paramIndex}`);
				queryParams.push(statut);
				paramIndex++;
			}
			if (priorité) {
				whereConditions.push(`i.priorite = $${paramIndex}`);
				queryParams.push(priorité);
				paramIndex++;
			}
			if (dateDebut) {
				whereConditions.push(`i.date_creation >= $${paramIndex}`);
				queryParams.push(dateDebut);
				paramIndex++;
			}
			if (dateFin) {
				whereConditions.push(`i.date_creation <= $${paramIndex}`);
				queryParams.push(dateFin);
				paramIndex++;
			}
			// TODO: Filtrage par zone géographique si PostGIS est utilisé

			if (whereConditions.length > 0) {
				query += " WHERE " + whereConditions.join(" AND ");
			}

			query += `
        GROUP BY i.id
        ORDER BY i.date_creation DESC
      `;

			const totalQuery = `SELECT COUNT(DISTINCT i.id) FROM interventions i ${
				whereConditions.length > 0
					? "WHERE " + whereConditions.join(" AND ")
					: ""
			}`;
			const totalResult = await pool.query(
				totalQuery,
				queryParams.slice(0, paramIndex - 1)
			);
			const totalItems = parseInt(totalResult.rows[0].count, 10);

			query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
			queryParams.push(limit);
			queryParams.push((Number(page) - 1) * Number(limit));

			const result = await pool.query(query, queryParams);

			res.json({
				data: result.rows.map((row) => ({
					...row,
					documents: row.documents_files.map((doc: any) => ({
						...doc,
						url: doc.url ? `/uploads/interventions/${doc.url}` : null,
					})),
					commentaires: row.commentaires_list,
					equipeAssignee: row.equipe_assignee_noms, // Noms au lieu d'IDs pour l'affichage
				})),
				pagination: {
					currentPage: Number(page),
					totalPages: Math.ceil(totalItems / Number(limit)),
					totalItems,
					itemsPerPage: Number(limit),
				},
			});
		} catch (error: any) {
			console.error("Erreur getAllInterventions:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	createIntervention: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			// Supprimer les fichiers si la validation des données JSON échoue
			const files = req.files as Express.Multer.File[];
			if (files) files.forEach((f) => fs.unlinkSync(f.path));
			return res.status(400).json({ errors: errors.array() });
		}

		const {
			titre,
			description,
			type: interventionType,
			localisation,
			statut,
			priorité,
			datePlanification,
			dateDebut,
			dateFin,
			equipeAssignee,
			coutEstime,
		} = req.body.parsedData;
		const uploadedFiles = req.files as Express.Multer.File[]; // `upload.array` fournit `req.files`
		const client = await pool.connect();

		try {
			await client.query("BEGIN");
			const interventionResult = await client.query(
				`INSERT INTO interventions (titre, description, type, adresse, latitude, longitude, statut, priorite, date_creation, date_planification, date_debut, date_fin, cout_estime, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11, $12, $13) RETURNING *`,
				[
					titre,
					description,
					interventionType,
					localisation.adresse,
					localisation.coordonnees?.latitude || null,
					localisation.coordonnees?.longitude || null,
					statut,
					priorité,
					datePlanification || null,
					dateDebut || null,
					dateFin || null,
					coutEstime || null,
					req.user?.id,
				]
			);
			const newIntervention = interventionResult.rows[0];

			// Gérer l'équipe assignée
			if (equipeAssignee && equipeAssignee.length > 0) {
				for (const agentId of equipeAssignee) {
					await client.query(
						"INSERT INTO equipes_intervention (intervention_id, agent_id) VALUES ($1, $2)",
						[newIntervention.id, agentId]
					);
				}
			}

			// Gérer les documents uploadés
			const documentsData = [];
			if (uploadedFiles && uploadedFiles.length > 0) {
				for (const file of uploadedFiles) {
					const newFilename = `${uuidv4()}-${file.originalname.replace(
						/\s+/g,
						"_"
					)}`;
					const newPath = path.join(UPLOAD_INTERVENTIONS_DIR, newFilename);
					fs.renameSync(file.path, newPath);

					// Le type de document doit être envoyé dans `req.body.parsedData.documentTypes` par exemple, ou déduit du nom.
					// Pour cet exemple, on met 'autre' par défaut si non fourni.
					// Idéalement, chaque fichier dans le FormData aurait son propre champ `type`.
					// Ou, vous pourriez avoir un tableau de métadonnées pour les fichiers dans `req.body.parsedData.filesMetadata`.
					const documentType =
						req.body.parsedData.documentTypes?.[file.originalname] || "autre";

					const docResult = await client.query(
						"INSERT INTO documents_intervention (intervention_id, nom, url, type, date_ajout) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
						[newIntervention.id, file.originalname, newFilename, documentType]
					);
					const newDoc = docResult.rows[0];
					newDoc.url = `/uploads/interventions/${newFilename}`;
					documentsData.push(newDoc);
				}
			}
			newIntervention.documents = documentsData;
			// Récupérer les noms de l'équipe pour la réponse
			// ... (similaire à getInterventionById)

			await client.query("COMMIT");
			res.status(201).json(newIntervention);
		} catch (error: any) {
			await client.query("ROLLBACK");
			if (uploadedFiles)
				uploadedFiles.forEach(
					(f) => fs.existsSync(f.path) && fs.unlinkSync(f.path)
				);
			console.error("Erreur createIntervention:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	getInterventionById: async (req: Request, res: Response) => {
		const { interventionId } = req.params;
		try {
			const query = `
SELECT i.*,
       (SELECT username FROM users WHERE id = i.created_by) as createur_username,

       COALESCE(json_agg(
         DISTINCT jsonb_build_object(
           'id', d.id,
           'nom', d.nom,
           'url', d.url,
           'date_ajout', d.date_ajout
         ) ORDER BY d.date_ajout DESC
       ) FILTER (WHERE d.id IS NOT NULL), '[]') as documents_files,

       COALESCE(json_agg(
         DISTINCT jsonb_build_object(
           'id', c.id,
           'texte', c.texte,
           'date', c.date,
           'auteur_id', c.auteur_id,
           'auteur_username', u_com.username
         ) ORDER BY c.date DESC
       ) FILTER (WHERE c.id IS NOT NULL), '[]') as commentaires_list,

       COALESCE(json_agg(
         DISTINCT jsonb_build_object(
           'id', u_eq.id,
           'username', u_eq.username,
           'email', u_eq.email
         )
       ) FILTER (WHERE u_eq.id IS NOT NULL), '[]') as equipe_assignee_details,

       (
         SELECT json_build_object(
           'transactionHash', bi.transaction_hash,
           'blockNumber', bi.block_number,
           'timestamp', bi.timestamp_blockchain,
           'documentHash', bi.document_hash
         )
         FROM blockchain_interventions bi
         WHERE bi.intervention_id = i.id
         ORDER BY bi.created_at DESC
         LIMIT 1
       ) as blockchain_info

FROM interventions i
LEFT JOIN documents_intervention d ON i.id = d.intervention_id
LEFT JOIN commentaires_intervention c ON i.id = c.intervention_id
LEFT JOIN users u_com ON c.auteur_id = u_com.id
LEFT JOIN equipes_intervention ei ON i.id = ei.intervention_id
LEFT JOIN users u_eq ON ei.agent_id = u_eq.id
WHERE i.id = $1
GROUP BY i.id
`;

			const result = await pool.query(query, [interventionId]);

			if (result.rows.length === 0) {
				return res.status(404).json({ message: "Intervention non trouvée" });
			}
			const intervention = result.rows[0];
			intervention.documents = intervention.documents_files.map((doc: any) => ({
				...doc,
				url: doc.url ? `/uploads/interventions/${doc.url}` : null,
			}));
			intervention.commentaires = intervention.commentaires_list;
			intervention.equipeAssignee = intervention.equipe_assignee_details;

			res.json(intervention);
		} catch (error: any) {
			console.error("Erreur getInterventionById:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	updateIntervention: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			const files = req.files as Express.Multer.File[];
			if (files) files.forEach((f) => fs.unlinkSync(f.path));
			return res.status(400).json({ errors: errors.array() });
		}
		const { interventionId } = req.params;
		const {
			titre,
			description,
			type: interventionType,
			localisation,
			statut,
			priorité,
			datePlanification,
			dateDebut,
			dateFin,
			equipeAssignee,
			coutEstime,
		} = req.body.parsedData;
		// Note: La mise à jour des documents se fait via une route dédiée addDocument/deleteDocument
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const interventionResult = await client.query(
				`UPDATE interventions 
         SET titre = $1, description = $2, type = $3, adresse = $4, latitude = $5, longitude = $6, 
             statut = $7, priorite = $8, date_planification = $9, date_debut = $10, date_fin = $11, 
             cout_estime = $12, updated_at = NOW()
         WHERE id = $13 RETURNING *`,
				[
					titre,
					description,
					interventionType,
					localisation.adresse,
					localisation.coordonnees?.latitude || null,
					localisation.coordonnees?.longitude || null,
					statut,
					priorité,
					datePlanification || null,
					dateDebut || null,
					dateFin || null,
					coutEstime || null,
					interventionId,
				]
			);
			if (interventionResult.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Intervention non trouvée" });
			}

			// Mettre à jour l'équipe assignée
			await client.query(
				"DELETE FROM equipes_intervention WHERE intervention_id = $1",
				[interventionId]
			);
			if (equipeAssignee && equipeAssignee.length > 0) {
				for (const agentId of equipeAssignee) {
					await client.query(
						"INSERT INTO equipes_intervention (intervention_id, agent_id) VALUES ($1, $2)",
						[interventionId, agentId]
					);
				}
			}

			await client.query("COMMIT");
			// Re-fetch pour avoir les données complètes
			return interventionsController.getInterventionById(req, res);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur updateIntervention:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	deleteIntervention: async (req: Request, res: Response) => {
		const { interventionId } = req.params;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			// Supprimer les documents associés
			const documents = await client.query(
				"SELECT url FROM documents_intervention WHERE intervention_id = $1",
				[interventionId]
			);
			for (const doc of documents.rows) {
				if (doc.url) {
					const docPath = path.join(UPLOAD_INTERVENTIONS_DIR, doc.url);
					if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
				}
			}
			await client.query(
				"DELETE FROM documents_intervention WHERE intervention_id = $1",
				[interventionId]
			);
			await client.query(
				"DELETE FROM commentaires_intervention WHERE intervention_id = $1",
				[interventionId]
			);
			await client.query(
				"DELETE FROM equipes_intervention WHERE intervention_id = $1",
				[interventionId]
			);
			// Supprimer les enregistrements blockchain liés si nécessaire, ou les garder pour l'historique
			await client.query(
				"DELETE FROM blockchain_interventions WHERE intervention_id = $1",
				[interventionId]
			);

			const result = await client.query(
				"DELETE FROM interventions WHERE id = $1 RETURNING *",
				[interventionId]
			);
			if (result.rowCount === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Intervention non trouvée" });
			}
			await client.query("COMMIT");
			res.json({ message: "Intervention supprimée avec succès" });
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur deleteIntervention:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	changeInterventionStatus: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		const { interventionId } = req.params;
		const { statut, commentaire } = req.body; // `commentaire` est optionnel, pour l'historique
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const intervention = await client.query(
				"SELECT * FROM interventions WHERE id = $1",
				[interventionId]
			);
			if (intervention.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Intervention non trouvée" });
			}
			const oldStatus = intervention.rows[0].statut;

			// Mise à jour du statut
			const updatedIntervention = await client.query(
				"UPDATE interventions SET statut = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
				[statut, interventionId]
			);

			// Logique pour l'historique (si une table d'historique des statuts existe)
			// Exemple: await client.query('INSERT INTO historique_statut_intervention ...', [interventionId, oldStatus, statut, commentaire, req.user.id]);

			// Si le statut passe à "validée", on pourrait déclencher l'enregistrement blockchain ici
			if (statut === "validée" && oldStatus !== "validée") {
				// S'assurer que `cout_final` est défini avant d'appeler le service blockchain
				if (!updatedIntervention.rows[0].cout_final) {
					await client.query("ROLLBACK");
					return res.status(400).json({
						message:
							"Le coût final doit être défini pour valider une intervention.",
					});
				}
				try {
					await blockchainService.enregistrerIntervention(
						updatedIntervention.rows[0]
					);
					// Enregistrer les infos de la transaction dans `blockchain_interventions`
					await client.query(
						"INSERT INTO blockchain_interventions (intervention_id, transaction_hash, block_number, timestamp_blockchain, document_hash, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
						[interventionId, "temp_tx_hash", 0, 0, "temp_doc_hash"] // Remplacer par les vraies valeurs du service
					);
				} catch (bcError: any) {
					await client.query("ROLLBACK"); // Annuler la mise à jour du statut si l'enregistrement blockchain échoue
					console.error("Erreur blockchain lors de la validation :", bcError);
					return res.status(500).json({
						message: `Erreur lors de l'enregistrement sur la blockchain: ${bcError.message}`,
					});
				}
			}

			await client.query("COMMIT");
			// Re-fetch pour avoir les données complètes
			return interventionsController.getInterventionById(req, res);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur changeInterventionStatus:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	addDocumentToIntervention: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			if (req.file) fs.unlinkSync(req.file.path);
			return res.status(400).json({ errors: errors.array() });
		}
		const { interventionId } = req.params;
		const { type, description } = req.body; // Type: photo_avant, photo_apres, rapport, etc.

		if (!req.file) {
			return res.status(400).json({ message: "Aucun fichier fourni" });
		}
		const file = req.file;
		const newFilename = `${uuidv4()}-${file.originalname.replace(/\s+/g, "_")}`;
		const newPath = path.join(UPLOAD_INTERVENTIONS_DIR, newFilename);

		try {
			fs.renameSync(file.path, newPath);
			const result = await pool.query(
				"INSERT INTO documents_intervention (intervention_id, nom, url, type, date_ajout) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
				[interventionId, file.originalname, newFilename, type]
			);
			const newDoc = result.rows[0];
			newDoc.url = `/uploads/interventions/${newFilename}`; // Renvoyer l'URL accessible
			// Re-fetch pour avoir les données complètes
			return interventionsController.getInterventionById(req, res);
		} catch (error: any) {
			if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
			else if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
			console.error("Erreur addDocumentToIntervention:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	deleteDocumentFromIntervention: async (req: Request, res: Response) => {
		const { documentId } = req.params; // interventionId est aussi dans req.params si besoin de vérifier l'appartenance
		try {
			const docResult = await pool.query(
				"SELECT url FROM documents_intervention WHERE id = $1",
				[documentId]
			);
			if (docResult.rows.length === 0) {
				return res.status(404).json({ message: "Document non trouvé" });
			}
			const docUrl = docResult.rows[0].url;

			const deleteResult = await pool.query(
				"DELETE FROM documents_intervention WHERE id = $1 RETURNING *",
				[documentId]
			);
			if ((deleteResult.rowCount ?? 0) > 0 && docUrl) {
				const docPath = path.join(UPLOAD_INTERVENTIONS_DIR, docUrl);
				if (fs.existsSync(docPath)) {
					fs.unlinkSync(docPath);
				}
			}
			// Re-fetch pour avoir les données complètes (ou juste un message de succès)
			// Pour l'instant, un message de succès. Le client devra re-fetch l'intervention.
			res.json({ message: "Document supprimé avec succès" });
		} catch (error: any) {
			console.error("Erreur deleteDocumentFromIntervention:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	addCommentToIntervention: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		const { interventionId } = req.params;
		const { texte } = req.body;
		try {
			const result = await pool.query(
				"INSERT INTO commentaires_intervention (intervention_id, texte, auteur_id, date) VALUES ($1, $2, $3, NOW()) RETURNING *",
				[interventionId, texte, req.user?.id]
			);
			// Re-fetch pour avoir les données complètes
			return interventionsController.getInterventionById(req, res);
		} catch (error: any) {
			console.error("Erreur addCommentToIntervention:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	finalizeIntervention: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		const { interventionId } = req.params;
		const { coutFinal } = req.body;
		const client = await pool.connect();

		try {
			await client.query("BEGIN");
			const interventionCheck = await client.query(
				"SELECT * FROM interventions WHERE id = $1",
				[interventionId]
			);
			if (interventionCheck.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Intervention non trouvée" });
			}
			let intervention = interventionCheck.rows[0];

			// Mettre à jour le coût final et le statut à "validée"
			// S'assurer que le statut n'est pas déjà "validée" pour éviter double enregistrement blockchain
			if (intervention.statut === "validée") {
				// On pourrait permettre la mise à jour du coût final même si déjà validée, mais sans ré-enregistrer sur blockchain
				// ou interdire la modification une fois validée. Pour l'instant, on met à jour le coût et on ne ré-enregistre pas.
				const updatedInterventionResult = await client.query(
					"UPDATE interventions SET cout_final = $1, date_validation = NOW(), updated_at = NOW() WHERE id = $2 RETURNING *",
					[coutFinal, interventionId]
				);
				intervention = updatedInterventionResult.rows[0];
			} else {
				const updatedInterventionResult = await client.query(
					"UPDATE interventions SET statut = $1, cout_final = $2, date_validation = NOW(), updated_at = NOW() WHERE id = $3 RETURNING *",
					["validée", coutFinal, interventionId]
				);
				intervention = updatedInterventionResult.rows[0];

				// Enregistrer sur la blockchain
				const bcResult = await blockchainService.enregistrerIntervention(
					intervention
				);
				await client.query(
					"INSERT INTO blockchain_interventions (intervention_id, transaction_hash, block_number, timestamp_blockchain, document_hash, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
					[
						interventionId,
						bcResult.transactionHash,
						bcResult.blockNumber,
						bcResult.timestamp,
						bcResult.documentHash, // Assurez-vous que le service blockchain retourne un documentHash
					]
				);
				intervention.blockchainInfo = {
					// Ajouter les infos pour la réponse
					transactionHash: bcResult.transactionHash,
					blockNumber: bcResult.blockNumber,
					timestamp: bcResult.timestamp,
					documentHash: bcResult.documentHash,
				};
			}

			await client.query("COMMIT");
			// Re-fetch pour avoir les données complètes
			return interventionsController.getInterventionById(req, res);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur finalizeIntervention:", error);
			if (error.message.startsWith("Erreur Blockchain:")) {
				return res.status(500).json({ message: error.message });
			}
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	recordInterventionOnBlockchain: async (req: Request, res: Response) => {
		const { interventionId } = req.params;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const interventionResult = await client.query(
				"SELECT * FROM interventions WHERE id = $1",
				[interventionId]
			);
			if (interventionResult.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Intervention non trouvée" });
			}
			const intervention = interventionResult.rows[0];

			// Vérifier si l'intervention est dans un état approprié pour l'enregistrement (ex: 'terminée' ou 'validée')
			// Et si elle n'a pas déjà été enregistrée récemment pour la même version des données
			if (
				intervention.statut !== "validée" &&
				intervention.statut !== "terminée"
			) {
				await client.query("ROLLBACK");
				return res.status(400).json({
					message: `L'intervention doit être terminée ou validée pour être enregistrée sur la blockchain. Statut actuel: ${intervention.statut}`,
				});
			}
			if (intervention.statut === "validée" && !intervention.cout_final) {
				await client.query("ROLLBACK");
				return res.status(400).json({
					message:
						"Le coût final doit être défini pour une intervention validée avant enregistrement blockchain.",
				});
			}

			// Éviter les enregistrements multiples si les données n'ont pas changé
			const dataToHash = JSON.stringify({
				id: intervention.id,
				titre: intervention.titre,
				statut: intervention.statut,
				dateFin: intervention.date_fin,
				coutFinal: intervention.cout_final,
			});
			const currentDocumentHash =
				"0x" + crypto.createHash("sha256").update(dataToHash).digest("hex");

			const existingRecord = await client.query(
				"SELECT * FROM blockchain_interventions WHERE intervention_id = $1 AND document_hash = $2 ORDER BY created_at DESC LIMIT 1",
				[interventionId, currentDocumentHash]
			);

			if (existingRecord.rows.length > 0) {
				await client.query("ROLLBACK");
				return res.status(409).json({
					message:
						"Cette version de l'intervention a déjà été enregistrée sur la blockchain.",
					blockchainInfo: existingRecord.rows[0],
				});
			}

			const bcResult = await blockchainService.enregistrerIntervention(
				intervention
			);

			await client.query(
				"INSERT INTO blockchain_interventions (intervention_id, transaction_hash, block_number, timestamp_blockchain, document_hash, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
				[
					interventionId,
					bcResult.transactionHash,
					bcResult.blockNumber,
					bcResult.timestamp,
					bcResult.documentHash,
				]
			);

			await client.query("COMMIT");
			// Re-fetch pour avoir les données complètes
			return interventionsController.getInterventionById(req, res);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur recordInterventionOnBlockchain:", error);
			if (error.message.startsWith("Erreur Blockchain:")) {
				return res.status(500).json({ message: error.message });
			}
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},
};

export default interventionsController;
