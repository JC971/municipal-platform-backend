import { createHash } from "crypto";
import { Request, Response } from "express";
import { validationResult } from "express-validator";
import pool from "../config/database";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import blockchainService from "../services/blockchainService";

const UPLOAD_DOLEANCES_DIR = path.join(__dirname, "../../uploads/doleances");
if (!fs.existsSync(UPLOAD_DOLEANCES_DIR)) {
	fs.mkdirSync(UPLOAD_DOLEANCES_DIR, { recursive: true });
}

const doleancesController = {
	// --- Création et suivi public ---
	createDoleance: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			const files = req.files as Express.Multer.File[];
			if (files) files.forEach((f) => fs.unlinkSync(f.path));
			return res.status(400).json({ errors: errors.array() });
		}
		
		const {
			titre,
			description,
			categorie,
			localisation,
			citoyen: {
				anonyme,
				nom: citoyenNom,
				email: citoyenEmail,
				telephone: citoyenTel,
			},
		} = req.body.parsedData;
		const uploadedPhotos = req.files as Express.Multer.File[];
		const client = await pool.connect();

		try {
			await client.query("BEGIN");
			// Le numéro de suivi est généré par un trigger `generate_doleance_numero_suivi`
			const doleanceResult = await client.query(
				`INSERT INTO doleances (titre, description, date_creation, statut, urgence, categorie, adresse, latitude, longitude, 
                                citoyen_anonyme, citoyen_nom, citoyen_email, citoyen_telephone, citoyen_id)
         VALUES ($1, $2, NOW(), 'reçue', 'normale', $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
				[
					titre,
					description,
					categorie || null,
					localisation?.adresse || null,
					localisation?.coordonnees?.latitude || null,
					localisation?.coordonnees?.longitude || null,
					anonyme,
					anonyme ? null : citoyenNom,
					anonyme ? null : citoyenEmail,
					anonyme ? null : citoyenTel,
					null, // citoyen_id à gérer si les citoyens ont des comptes
				]
			);
			const newDoleance = doleanceResult.rows[0];

			const photosData = [];
			if (uploadedPhotos && uploadedPhotos.length > 0) {
				for (const photoFile of uploadedPhotos) {
					const newFilename = `${uuidv4()}-${photoFile.originalname.replace(
						/\s+/g,
						"_"
					)}`;
					const newPath = path.join(UPLOAD_DOLEANCES_DIR, newFilename);
					fs.renameSync(photoFile.path, newPath);

					const photoDbResult = await client.query(
						"INSERT INTO photos_doleance (doleance_id, nom_original, nom_fichier, type_mime, taille_fichier, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *",
						[
							newDoleance.id,
							photoFile.originalname,
							newFilename,
							photoFile.mimetype,
							photoFile.size,
						]
					);
					const newPhoto = photoDbResult.rows[0];
					newPhoto.url = `/uploads/doleances/${newFilename}`; // Pour la réponse
					photosData.push(newPhoto);
				}
			}
			newDoleance.photos = photosData;

			// Enregistrer l'historique initial
			await client.query(
				`INSERT INTO historique_doleance 
				 (doleance_id, statut_precedent, statut_actuel, statut, commentaire)
				 VALUES ($1, $2, $3, $4, $5)`,
				[newDoleance.id, null, "reçue", "reçue", "Doléance créée par citoyen."]
			);

			await client.query("COMMIT");
			res.status(201).json({
				message: "Doléance créée avec succès.",
				numeroSuivi: newDoleance.numero_suivi,
				id: newDoleance.id,
				doleance: newDoleance, // Renvoyer la doléance complète pour confirmation
			});
		} catch (error: unknown) {
			await client.query("ROLLBACK");

			if (uploadedPhotos)
				uploadedPhotos.forEach(
					(f) => fs.existsSync(f.path) && fs.unlinkSync(f.path)
				);
			
			console.error("Erreur createDoleance:", error);

			if (error instanceof Error) {
				res.status(500).json({ message: "Erreur serveur", error: error.message });
			} else {
				res.status(500).json({ message: "Erreur serveur", error: String(error) });
			}
		} finally {
			client.release();
		}
	},
	
	getDoleanceByNumeroSuivi: async (req: Request, res: Response) => {
		const { numeroSuivi } = req.params;
		try {
			const query = `
        SELECT d.*,
               COALESCE(json_agg(DISTINCT p.* ORDER BY p.created_at) FILTER (WHERE p.id IS NOT NULL), '[]') as photos_files,
               COALESCE(json_agg(DISTINCT h.* ORDER BY h.date DESC) FILTER (WHERE h.id IS NOT NULL), '[]') as historique_list,
               (SELECT json_build_object('texte', rp.texte, 'date', rp.date, 'agent_nom', u.username) 
                FROM reponses_publiques_doleance rp JOIN users u ON rp.agent_id = u.id 
                WHERE rp.doleance_id = d.id ORDER BY rp.date DESC LIMIT 1) as reponse_publique,
               (SELECT json_build_object('transactionHash', bd.transaction_hash, 'blockNumber', bd.block_number, 'timestamp', bd.timestamp_blockchain) 
                FROM blockchain_doleances bd WHERE bd.doleance_id = d.id ORDER BY bd.created_at DESC LIMIT 1) as blockchain_info
        FROM doleances d
        LEFT JOIN photos_doleance p ON d.id = p.doleance_id
        LEFT JOIN historique_doleance h ON d.id = h.doleance_id
        WHERE d.numero_suivi = $1
        GROUP BY d.id
      `;
			const result = await pool.query(query, [numeroSuivi]);
			if (result.rows.length === 0) {
				return res
					.status(404)
					.json({ message: "Doléance non trouvée avec ce numéro de suivi" });
			}
			const doleance = result.rows[0];
			// Masquer les infos personnelles si la doléance a été soumise anonymement (ou toujours pour le suivi public)
			if (doleance.citoyen_anonyme) {
				doleance.citoyen_nom = null;
				doleance.citoyen_email = null;
				doleance.citoyen_telephone = null;
			}
			doleance.photos = doleance.photos_files.map((photo: any) => ({
				id: photo.id,
				url: `/uploads/doleances/${photo.nom_fichier}`,
				nom: photo.nom_original,
				created_at: photo.created_at,
			}));
			doleance.historique = doleance.historique_list; // Déjà formaté

			res.json(doleance);
		} catch (error:unknown) {
			console.error("Erreur getDoleanceByNumeroSuivi:", error);
			if (error instanceof Error) {
				res.status(500).json({ message: "Erreur serveur", error: error.message });
			} else {
				res.status(500).json({ message: "Erreur serveur", error: String(error) });
			}
		}
	},

	// --- Gestion interne ---
	getAllDoleances: async (req: Request, res: Response) => {
		try {
			const {
				texte,
				statut,
				urgence,
				categorie,
				dateDebut,
				dateFin,
				assigneA,
				page = 1,
				limit = 10,
			} = req.query;
			let query = `
        SELECT d.*,
               (SELECT username FROM users u_assign JOIN agents_doleance ad ON u_assign.id = ad.agent_id WHERE ad.doleance_id = d.id LIMIT 1) as premier_agent_assigne,
               COALESCE(json_agg(DISTINCT u_assign.username) FILTER (WHERE u_assign.id IS NOT NULL), '[]') as agents_assignes_noms,
               (SELECT COUNT(p.id) FROM photos_doleance p WHERE p.doleance_id = d.id) as nombre_photos,
               i.titre as intervention_liee_titre
        FROM doleances d
        LEFT JOIN agents_doleance ad_list ON d.id = ad_list.doleance_id
        LEFT JOIN users u_assign ON ad_list.agent_id = u_assign.id
        LEFT JOIN interventions i ON d.intervention_liee_id = i.id
      `;
			const whereConditions: string[] = [];
			const queryParams: any[] = [];
			let paramIndex = 1;

			if (texte) {
				whereConditions.push(
					`(d.titre ILIKE $${paramIndex} OR d.description ILIKE $${paramIndex} OR d.numero_suivi ILIKE $${paramIndex})`
				);
				queryParams.push(`%${texte}%`);
				paramIndex++;
			}
			if (statut) {
				const statuts = (Array.isArray(statut) ? statut : [statut]) as string[];
				whereConditions.push(
					`d.statut IN (${statuts
						.map((_, idx) => `$${paramIndex + idx}`)
						.join(", ")})`
				);
				statuts.forEach((s) => queryParams.push(s));
				paramIndex += statuts.length;
			}
			// ... autres filtres (urgence, categorie, dates, assigneA)
			if (assigneA) {
				// This requires a subquery or a join that checks if `assigneA` (user ID) is in `agents_doleance`
				whereConditions.push(
					`EXISTS (SELECT 1 FROM agents_doleance ad_filter WHERE ad_filter.doleance_id = d.id AND ad_filter.agent_id = $${paramIndex})`
				);
				queryParams.push(assigneA);
				paramIndex++;
			}
			/////////////////////////////
			if (dateDebut) {
				whereConditions.push(`d.date_creation >= $${paramIndex}`);
				queryParams.push(dateDebut);
				paramIndex++;
			}

			if (dateFin) {
				whereConditions.push(`d.date_creation <= $${paramIndex}`);
				queryParams.push(dateFin);
				paramIndex++;
			}
			///////////////////////

			if (whereConditions.length > 0) {
				query += " WHERE " + whereConditions.join(" AND ");
			}
			query += ` GROUP BY d.id, i.titre ORDER BY d.date_creation DESC`;

			const totalQuery = `SELECT COUNT(DISTINCT d.id) FROM doleances d ${
				whereConditions.length > 0
					? "LEFT JOIN agents_doleance ad_list ON d.id = ad_list.doleance_id WHERE " +
					  whereConditions.join(" AND ")
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
				data: result.rows.map((r) => ({
					...r,
					agentsAssignes: r.agents_assignes_noms,
				})),
				pagination: {
					currentPage: Number(page),
					totalPages: Math.ceil(totalItems / Number(limit)),
					totalItems,
					itemsPerPage: Number(limit),
				},
			});
		} catch (error: any) {
			console.error("Erreur getAllDoleances (interne):", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	getDoleanceByIdInternal: async (req: Request, res: Response) => {
		const { doleanceId } = req.params;
		try {
			const query = `
        SELECT d.*,
               COALESCE(json_agg(DISTINCT p.* ORDER BY p.created_at) FILTER (WHERE p.id IS NOT NULL), '[]') as photos_files,
               COALESCE(json_agg(DISTINCT h.* ORDER BY h.date DESC) FILTER (WHERE h.id IS NOT NULL), '[]') as historique_list,
               COALESCE(json_agg(DISTINCT jsonb_build_object('id', ci.id, 'texte', ci.texte, 'date', ci.date, 'agent_nom', u_ci.username)) 
                        FILTER (WHERE ci.id IS NOT NULL) ORDER BY ci.date DESC, '[]') as commentaires_internes_list,
               (SELECT json_build_object('texte', rp.texte, 'date', rp.date, 'agent_nom', u_rp.username) 
                FROM reponses_publiques_doleance rp JOIN users u_rp ON rp.agent_id = u_rp.id 
                WHERE rp.doleance_id = d.id ORDER BY rp.date DESC LIMIT 1) as reponse_publique,
               COALESCE(json_agg(DISTINCT jsonb_build_object('id', u_assign.id, 'username', u_assign.username, 'email', u_assign.email)) 
                        FILTER (WHERE u_assign.id IS NOT NULL), '[]') as agents_assignes_details,
               i.titre as intervention_liee_titre,
               i.statut as intervention_liee_statut,
               (SELECT json_build_object('transactionHash', bd.transaction_hash, 'blockNumber', bd.block_number, 'timestamp', bd.timestamp_blockchain, 'documentHash', bd.document_hash) 
                FROM blockchain_doleances bd WHERE bd.doleance_id = d.id ORDER BY bd.created_at DESC LIMIT 1) as blockchain_info
        FROM doleances d
        LEFT JOIN photos_doleance p ON d.id = p.doleance_id
        LEFT JOIN historique_doleance h ON d.id = h.doleance_id
        LEFT JOIN commentaires_doleance ci ON d.id = ci.doleance_id LEFT JOIN users u_ci ON ci.agent_id = u_ci.id
        LEFT JOIN agents_doleance ad_list ON d.id = ad_list.doleance_id LEFT JOIN users u_assign ON ad_list.agent_id = u_assign.id
        LEFT JOIN interventions i ON d.intervention_liee_id = i.id
        WHERE d.id = $1
        GROUP BY d.id, i.titre, i.statut
      `;
			const result = await pool.query(query, [doleanceId]);
			if (result.rows.length === 0) {
				return res.status(404).json({ message: "Doléance non trouvée" });
			}
			const doleance = result.rows[0];
			doleance.photos = doleance.photos_files.map((photo: any) => ({
				id: photo.id,
				url: `/uploads/doleances/${photo.nom_fichier}`,
				nom: photo.nom_original,
			}));
			doleance.historique = doleance.historique_list;
			doleance.commentairesInternes = doleance.commentaires_internes_list;
			doleance.agentsAssignes = doleance.agents_assignes_details;

			res.json(doleance);
		} catch (error: any) {
			console.error("Erreur getDoleanceByIdInternal:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	updateDoleanceInternal: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		if (!req.user || !req.user.id) {
			return res
				.status(401)
				.json({ message: "Authentification requise pour cette action." });
		}
		const { doleanceId } = req.params;
		const {
			titre,
			description,
			statut,
			urgence,
			categorie,
			interventionLieeId,
			assigneA,
			localisation, // `assigneA` est géré par une route dédiée
		} = req.body.parsedData || req.body; // Si pas de 'data', on prend direct du body (cas sans upload)

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const currentDoleanceRes = await client.query(
				"SELECT * FROM doleances WHERE id = $1",
				[doleanceId]
			);
			if (currentDoleanceRes.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Doléance non trouvée" });
			}
			const currentDoleance = currentDoleanceRes.rows[0];

			const updateFields: any = {};
			if (titre !== undefined) updateFields.titre = titre;
			if (description !== undefined) updateFields.description = description;
			if (statut !== undefined && statut !== currentDoleance.statut)
				updateFields.statut = statut;
			if (urgence !== undefined) updateFields.urgence = urgence;
			if (categorie !== undefined) updateFields.categorie = categorie;
			if (interventionLieeId !== undefined)
				updateFields.intervention_liee_id = interventionLieeId;
			if (localisation?.adresse !== undefined)
				updateFields.adresse = localisation.adresse;
			if (localisation?.coordonnees?.latitude !== undefined)
				updateFields.latitude = localisation.coordonnees.latitude;
			if (localisation?.coordonnees?.longitude !== undefined)
				updateFields.longitude = localisation.coordonnees.longitude;

			if (Object.keys(updateFields).length > 0) {
				const setClauses = Object.keys(updateFields)
					.map((key, index) => `${key} = $${index + 1}`)
					.join(", ");
				const values = Object.values(updateFields);
				values.push(doleanceId);

				await client.query(
					`UPDATE doleances SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length}`,
					values
				);
			}

			// Gérer l'historique si le statut change
			if (updateFields.statut) {
				await client.query(
					"INSERT INTO historique_doleance (doleance_id, statut_precedent, statut_actuel, agent_id, commentaire) VALUES ($1, $2, $3, $4, $5)",
					[
						doleanceId,
						currentDoleance.statut,
						updateFields.statut,
						req.user.id,
						`Statut mis à jour par agent ${req.user.username || req.user.id}`,
					]
				);
			}

			await client.query("COMMIT");
			return doleancesController.getDoleanceByIdInternal(req, res); // Renvoyer la doléance mise à jour
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur updateDoleanceInternal:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	deleteDoleanceInternal: async (req: Request, res: Response) => {
		const { doleanceId } = req.params;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const photos = await client.query(
				"SELECT nom_fichier FROM photos_doleance WHERE doleance_id = $1",
				[doleanceId]
			);
			for (const photo of photos.rows) {
				if (photo.nom_fichier) {
					const photoPath = path.join(UPLOAD_DOLEANCES_DIR, photo.nom_fichier);
					if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
				}
			}
			await client.query("DELETE FROM photos_doleance WHERE doleance_id = $1", [
				doleanceId,
			]);
			await client.query(
				"DELETE FROM historique_doleance WHERE doleance_id = $1",
				[doleanceId]
			);
			await client.query(
				"DELETE FROM commentaires_doleance WHERE doleance_id = $1",
				[doleanceId]
			);
			await client.query(
				"DELETE FROM reponses_publiques_doleance WHERE doleance_id = $1",
				[doleanceId]
			);
			await client.query("DELETE FROM agents_doleance WHERE doleance_id = $1", [
				doleanceId,
			]);
			await client.query(
				"DELETE FROM blockchain_doleances WHERE doleance_id = $1",
				[doleanceId]
			);

			const result = await client.query(
				"DELETE FROM doleances WHERE id = $1 RETURNING *",
				[doleanceId]
			);
			if (result.rowCount === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Doléance non trouvée" });
			}
			await client.query("COMMIT");
			res.json({ message: "Doléance supprimée avec succès" });
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur deleteDoleanceInternal:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	// --- Actions spécifiques ---
	changeDoleanceStatus: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		if (!req.user || !req.user.id) {
			return res
				.status(401)
				.json({ message: "Authentification requise pour cette action." });
		}
		const { doleanceId } = req.params;
		const { statut, commentaire } = req.body;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const currentDoleanceRes = await client.query(
				"SELECT statut FROM doleances WHERE id = $1",
				[doleanceId]
			);
			if (currentDoleanceRes.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Doléance non trouvée" });
			}
			const oldStatus = currentDoleanceRes.rows[0].statut;

			if (oldStatus === statut) {
				await client.query("ROLLBACK");
				return res
					.status(400)
					.json({ message: "La doléance a déjà ce statut." });
			}

			await client.query(
				"UPDATE doleances SET statut = $1, updated_at = NOW() WHERE id = $2",
				[statut, doleanceId]
			);
			await client.query(
				"INSERT INTO historique_doleance (doleance_id, statut_precedent, statut_actuel, agent_id, commentaire) VALUES ($1, $2, $3, $4, $5)",
				[
					doleanceId,
					oldStatus,
					statut,
					req.user.id,
					commentaire ||
						`Statut changé par ${req.user.username || req.user.id}`,
				]
			);

			// Si le statut est 'résolue' ou 'clôturée', et qu'on veut enregistrer sur la blockchain
			if (
				blockchainService &&
				(statut === "résolue" || statut === "clôturée")
			) {
				const doleanceToRecord = (
					await client.query("SELECT * FROM doleances WHERE id = $1", [
						doleanceId,
					])
				).rows[0];
				// Vérifier si elle n'est pas déjà enregistrée pour cet état
				// ... (logique similaire à recordDoleanceOnBlockchain)
				try {
					const bcResult = await blockchainService.enregistrerDoleance(
						doleanceToRecord
					);
					await client.query(
						"INSERT INTO blockchain_doleances (doleance_id, transaction_hash, block_number, timestamp_blockchain, document_hash, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (doleance_id) DO UPDATE SET transaction_hash = EXCLUDED.transaction_hash, block_number = EXCLUDED.block_number, timestamp_blockchain = EXCLUDED.timestamp_blockchain, document_hash = EXCLUDED.document_hash, created_at = NOW()",
						[
							doleanceId,
							bcResult.transactionHash,
							bcResult.blockNumber,
							bcResult.timestamp,
							bcResult.documentHash, 
						]
					);
				} catch (bcError: any) {
					await client.query("ROLLBACK");
					console.error(
						"Erreur blockchain lors du changement de statut :",
						bcError
					);
					return res.status(500).json({
						message: `Erreur lors de l'enregistrement sur la blockchain: ${bcError.message}`,
					});
				}
			}

			await client.query("COMMIT");
			return doleancesController.getDoleanceByIdInternal(req, res);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur changeDoleanceStatus:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	assignDoleanceToAgent: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		if (!req.user || !req.user.id) {
			return res
				.status(401)
				.json({ message: "Authentification requise pour cette action." });
		}
		const { doleanceId } = req.params;
		const { agentIds } = req.body; // Tableau d'IDs d'utilisateurs
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			// Optionnel: supprimer les anciennes assignations ou ajouter seulement les nouvelles
			await client.query("DELETE FROM agents_doleance WHERE doleance_id = $1", [
				doleanceId,
			]);
			for (const agentId of agentIds) {
				await client.query(
					"INSERT INTO agents_doleance (doleance_id, agent_id) VALUES ($1, $2)",
					[doleanceId, agentId]
				);
			}
			// Mettre à jour le statut de la doléance à 'assignée' si ce n'est pas déjà un statut plus avancé
			const currentDoleance = (
				await client.query("SELECT statut FROM doleances WHERE id = $1", [
					doleanceId,
				])
			).rows[0];
			if (["reçue", "qualifiée"].includes(currentDoleance.statut)) {
				await client.query(
					"UPDATE doleances SET statut = $1, updated_at = NOW() WHERE id = $2",
					["assignée", doleanceId]
				);
				await client.query(
					"INSERT INTO historique_doleance (doleance_id, statut_precedent, statut_actuel, agent_id, commentaire) VALUES ($1, $2, $3, $4, $5)",
					[
						doleanceId,
						currentDoleance.statut,
						"assignée",
						req.user.id,
						`Assignée par ${req.user.username || req.user.id}`,
					]
				);
			}
			await client.query("COMMIT");
			return doleancesController.getDoleanceByIdInternal(req, res);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur assignDoleanceToAgent:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	linkDoleanceToIntervention: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		if (!req.user || !req.user.id) {
			return res
				.status(401)
				.json({ message: "Authentification requise pour cette action." });
		}
		const { doleanceId } = req.params;
		const { interventionId } = req.body;
		try {
			await pool.query(
				"UPDATE doleances SET intervention_liee_id = $1, updated_at = NOW() WHERE id = $2",
				[interventionId, doleanceId]
			);
			// Ajouter à l'historique
			await pool.query(
				"INSERT INTO historique_doleance (doleance_id, commentaire, agent_id) VALUES ($1, $2, $3)",
				[
					doleanceId,
					`Liée à l'intervention ID: ${interventionId} par ${
						req.user.username || req.user.id
					}`,
					req.user.id,
				]
			);
			return doleancesController.getDoleanceByIdInternal(req, res);
		} catch (error: any) {
			console.error("Erreur linkDoleanceToIntervention:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	resolveDoleance: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		if (!req.user || !req.user.id) {
			return res
				.status(401)
				.json({ message: "Authentification requise pour cette action." });
		}
		const { doleanceId } = req.params;
		const { coutResolution, commentaireResolution } = req.body;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const currentDoleanceRes = await client.query(
				"SELECT statut FROM doleances WHERE id = $1",
				[doleanceId]
			);
			if (currentDoleanceRes.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Doléance non trouvée" });
			}
			const oldStatus = currentDoleanceRes.rows[0].statut;
			const newStatus = "résolue";

			await client.query(
				"UPDATE doleances SET statut = $1, cout_resolution = $2, date_resolution = NOW(), updated_at = NOW() WHERE id = $3",
				[newStatus, coutResolution || null, doleanceId]
			);
			await client.query(
				"INSERT INTO historique_doleance (doleance_id, statut_precedent, statut_actuel, agent_id, commentaire) VALUES ($1, $2, $3, $4, $5)",
				[
					doleanceId,
					oldStatus,
					newStatus,
					req.user.id,
					commentaireResolution ||
						`Doléance résolue par ${req.user.username || req.user.id}`,
				]
			);

			// Enregistrer sur blockchain car résolue
			const doleanceToRecord = (
				await client.query("SELECT * FROM doleances WHERE id = $1", [
					doleanceId,
				])
			).rows[0];
			try {
				const bcResult = await blockchainService.enregistrerDoleance(
					doleanceToRecord
				);
				await client.query(
					"INSERT INTO blockchain_doleances (doleance_id, transaction_hash, block_number, timestamp_blockchain, document_hash, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (doleance_id) DO UPDATE SET transaction_hash = EXCLUDED.transaction_hash, block_number = EXCLUDED.block_number, timestamp_blockchain = EXCLUDED.timestamp_blockchain, document_hash = EXCLUDED.document_hash, created_at = NOW()",
					[
						doleanceId,
						bcResult.transactionHash,
						bcResult.blockNumber,
						bcResult.timestamp,
						bcResult.documentHash,
					]
				);
			} catch (bcError: any) {
				await client.query("ROLLBACK");
				console.error("Erreur blockchain lors de la résolution :", bcError);
				return res.status(500).json({
					message: `Erreur lors de l'enregistrement sur la blockchain: ${bcError.message}`,
				});
			}

			await client.query("COMMIT");
			return doleancesController.getDoleanceByIdInternal(req, res);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur resolveDoleance:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	addPhotosToDoleance: async (req: Request, res: Response) => {
		const { doleanceId } = req.params;
		const uploadedPhotos = req.files as Express.Multer.File[];
		if (!uploadedPhotos || uploadedPhotos.length === 0) {
			return res.status(400).json({ message: "Aucune photo fournie." });
		}
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			for (const photoFile of uploadedPhotos) {
				const newFilename = `${uuidv4()}-${photoFile.originalname.replace(
					/\s+/g,
					"_"
				)}`;
				const newPath = path.join(UPLOAD_DOLEANCES_DIR, newFilename);
				fs.renameSync(photoFile.path, newPath);

				await client.query(
					"INSERT INTO photos_doleance (doleance_id, nom_original, nom_fichier, type_mime, taille_fichier) VALUES ($1, $2, $3, $4, $5)",
					[
						doleanceId,
						photoFile.originalname,
						newFilename,
						photoFile.mimetype,
						photoFile.size,
					]
				);
			}
			await client.query("COMMIT");
			return doleancesController.getDoleanceByIdInternal(req, res);
		} catch (error: any) {
			await client.query("ROLLBACK");
			uploadedPhotos.forEach(
				(f) => fs.existsSync(f.path) && fs.unlinkSync(f.path)
			);
			console.error("Erreur addPhotosToDoleance:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},

	deletePhotoFromDoleance: async (req: Request, res: Response) => {
		const { photoId } = req.params; // doleanceId est aussi dans req.params
		try {
			const photoResult = await pool.query(
				"SELECT nom_fichier FROM photos_doleance WHERE id = $1",
				[photoId]
			);
			if (photoResult.rows.length === 0) {
				return res.status(404).json({ message: "Photo non trouvée." });
			}
			const nomFichier = photoResult.rows[0].nom_fichier;

			await pool.query("DELETE FROM photos_doleance WHERE id = $1", [photoId]);
			if (nomFichier) {
				const photoPath = path.join(UPLOAD_DOLEANCES_DIR, nomFichier);
				if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
			}
			res.json({ message: "Photo supprimée avec succès." });
		} catch (error: any) {
			console.error("Erreur deletePhotoFromDoleance:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	addInternalCommentToDoleance: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		if (!req.user || !req.user.id) {
			return res
				.status(401)
				.json({ message: "Authentification requise pour cette action." });
		}

		const { doleanceId } = req.params;
		const { texte } = req.body;
		try {
			await pool.query(
				"INSERT INTO commentaires_doleance (doleance_id, texte, agent_id, date) VALUES ($1, $2, $3, NOW())",
				[doleanceId, texte, req.user.id]
			);
			return doleancesController.getDoleanceByIdInternal(req, res);
		} catch (error: any) {
			console.error("Erreur addInternalCommentToDoleance:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	addPublicResponseToDoleance: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}
		if (!req.user || !req.user.id) {
			return res
				.status(401)
				.json({ message: "Authentification requise pour cette action." });
		}
		const { doleanceId } = req.params;
		const { texte } = req.body;
		try {
			// Supprimer l'ancienne réponse publique s'il y en a une (ou permettre plusieurs, selon la logique métier)
			// await pool.query('DELETE FROM reponses_publiques_doleance WHERE doleance_id = $1', [doleanceId]);
			await pool.query(
				"INSERT INTO reponses_publiques_doleance (doleance_id, texte, agent_id, date) VALUES ($1, $2, $3, NOW())",
				[doleanceId, texte, req.user.id]
			);
			await pool.query(
				"INSERT INTO historique_doleance (doleance_id, commentaire, agent_id) VALUES ($1, $2, $3)",
				[
					doleanceId,
					`Réponse publique ajoutée par ${req.user.username || req.user.id}`,
					req.user.id,
				]
			);
			return doleancesController.getDoleanceByIdInternal(req, res);
		} catch (error: any) {
			console.error("Erreur addPublicResponseToDoleance:", error);
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		}
	},

	recordDoleanceOnBlockchain: async (req: Request, res: Response) => {
		const { doleanceId } = req.params;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const doleanceResult = await client.query(
				"SELECT * FROM doleances WHERE id = $1",
				[doleanceId]
			);
			if (doleanceResult.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Doléance non trouvée" });
			}
			const doleance = doleanceResult.rows[0];

			// Vérifier si un enregistrement avec le même hash de contenu existe déjà pour éviter les doublons inutiles
			const dataToHash = JSON.stringify({
				id: doleance.id,
				numeroSuivi: doleance.numero_suivi,
				description: doleance.description,
				statut: doleance.statut,
				dateCreation: doleance.date_creation,
			});
			const documentHash = createHash("sha256").update(dataToHash).digest("hex");

			const existingRecord = await client.query(
				"SELECT * FROM blockchain_doleances WHERE doleance_id = $1 AND document_hash = $2 ORDER BY created_at DESC LIMIT 1",
				[doleanceId, documentHash]
			);

			if (existingRecord.rows.length > 0) {
				await client.query("ROLLBACK");
				return res.status(409).json({
					message:
						"Cette version de la doléance a déjà été enregistrée sur la blockchain.",
					blockchainInfo: existingRecord.rows[0],
				});
			}

			const bcResult = await blockchainService.enregistrerDoleance(doleance);
			await client.query(
				"INSERT INTO blockchain_doleances (doleance_id, transaction_hash, block_number, timestamp_blockchain, document_hash, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (doleance_id) DO UPDATE SET transaction_hash = EXCLUDED.transaction_hash, block_number = EXCLUDED.block_number, timestamp_blockchain = EXCLUDED.timestamp_blockchain, document_hash = EXCLUDED.document_hash, created_at = NOW()",
				[
					doleanceId,
					bcResult.transactionHash,
					bcResult.blockNumber,
					bcResult.timestamp,
					bcResult.documentHash,
				]
			);
			await client.query("COMMIT");
			return doleancesController.getDoleanceByIdInternal(req, res);
		} catch (error: any) {
			await client.query("ROLLBACK");
			console.error("Erreur recordDoleanceOnBlockchain:", error);
			if (error.message.startsWith("Erreur Blockchain:")) {
				return res.status(500).json({ message: error.message });
			}
			res.status(500).json({ message: "Erreur serveur", error: error.message });
		} finally {
			client.release();
		}
	},
};

export default doleancesController;
