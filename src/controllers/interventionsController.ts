import crypto from "crypto";
import { Request, Response } from "express";
import { v4 as uuidv4, validate as uuidValidate } from "uuid";
import { validationResult } from "express-validator";
import pool from "../config/database";
import fs from "fs";
import path from "path";
import blockchainService from "../services/blockchainService";

/* ----------------------------------------------------------------------
 * CONFIG & HELPERS
 * --------------------------------------------------------------------*/

const UPLOAD_INTERVENTIONS_DIR = path.join(
	__dirname,
	"../../uploads/interventions"
);
if (!fs.existsSync(UPLOAD_INTERVENTIONS_DIR)) {
	fs.mkdirSync(UPLOAD_INTERVENTIONS_DIR, { recursive: true });
}

/** Vérifie qu'une valeur est un UUID valide */
const isUuid = (v: unknown): v is string =>
	typeof v === "string" && uuidValidate(v);

/**
 * Renvoie true si le paramètre est un UUID, sinon répond 400 et stoppe le handler.
 */
const assertUuid = (
	value: unknown,
	res: Response,
	field = "id"
): value is string => {
	if (!isUuid(value)) {
		res.status(400).json({ message: `${field} must be a valid UUID` });
		return false;
	}
	return true;
};

/* ----------------------------------------------------------------------
 * CONTROLLER
 * --------------------------------------------------------------------*/


const interventionsController = {
	/* ========================== GET ALL ================================= */
	async getAllInterventions(req: Request, res: Response) {
		try {
			const {
				texte,
				type,
				statut,
				priorité,
				dateDebut,
				dateFin,
				page = 1,
				limit = 10,
			} = req.query;

			let query = `SELECT i.*,  
           (SELECT username FROM users WHERE id = i.created_by) AS createur_username,
           COALESCE(json_agg(jsonb_build_object('id', d.id, 'nom', d.nom, 'url', d.url, 'date_ajout', d.date_ajout) ORDER BY d.date_ajout DESC) FILTER (WHERE d.id IS NOT NULL), '[]') AS documents_files,
           COALESCE(json_agg(jsonb_build_object('id', c.id, 'texte', c.texte, 'date', c.date, 'auteur_id', c.auteur_id) ORDER BY c.date DESC) FILTER (WHERE c.id IS NOT NULL), '[]') AS commentaires_list,
           COALESCE(json_agg(jsonb_build_object('id', u.id, 'username', u.username, 'email', u.email)) FILTER (WHERE u.id IS NOT NULL), '[]') AS equipe_assignee_noms,
           (SELECT json_build_object('transactionHash', bi.transaction_hash, 'blockNumber', bi.block_number, 'timestamp', bi.timestamp_blockchain)
              FROM blockchain_interventions bi
              WHERE bi.intervention_id = i.id
              ORDER BY bi.created_at DESC LIMIT 1) AS blockchain_info
        FROM interventions i
        LEFT JOIN documents_intervention d ON i.id = d.intervention_id
        LEFT JOIN commentaires_intervention c ON i.id = c.intervention_id
        LEFT JOIN equipes_intervention ei ON i.id = ei.intervention_id
        LEFT JOIN users u ON ei.agent_id = u.id`;

			const where: string[] = [];
			const params: any[] = [];
			let idx = 1;

			const push = (cond: string, val: any) => {
				where.push(cond.replace("$", `$${idx}`));
				params.push(val);
				idx++;
			};

			if (texte)
				push(
					"(i.titre ILIKE $ OR i.description ILIKE $ OR i.adresse ILIKE $)",
					`%${texte}%`
				);
			if (type) push("i.type = $", type);
			if (statut) push("i.statut = $", statut);
			if (priorité) push("i.priorite = $", priorité);
			if (dateDebut) push("i.date_creation >= $", dateDebut);
			if (dateFin) push("i.date_creation <= $", dateFin);

			if (where.length) query += ` WHERE ${where.join(" AND ")}`;
			query += " GROUP BY i.id ORDER BY i.date_creation DESC";

			// total
			const totalQuery = `SELECT COUNT(DISTINCT i.id) FROM interventions i ${
				where.length ? `WHERE ${where.join(" AND ")}` : ""
			}`;
			const totalItems = parseInt(
				(await pool.query(totalQuery, params)).rows[0].count,
				10
			);

			// pagination
			query += ` LIMIT $${idx} OFFSET $${idx + 1}`;
			params.push(limit);
			params.push((Number(page) - 1) * Number(limit));

			const { rows } = await pool.query(query, params);

			res.json({
				data: rows.map((r) => ({
					...r,
					documents: r.documents_files.map((d: any) => ({
						...d,
						url: d.url ? `/uploads/interventions/${d.url}` : null,
					})),
					commentaires: r.commentaires_list,
					equipeAssignee: r.equipe_assignee_noms,
				})),
				pagination: {
					currentPage: Number(page),
					totalPages: Math.ceil(totalItems / Number(limit)),
					totalItems,
					itemsPerPage: Number(limit),
				},
			});
		} catch (err: any) {
			console.error("Erreur getAllInterventions", err);
			res.status(500).json({ message: "Erreur serveur", error: err.message });
		}
	},
	/* ===========================addCommentToInltervention================*/
	async addCommentToIntervention(req: Request, res: Response) {
		try {
			const errors = validationResult(req);
			if (!errors.isEmpty())
				return res.status(400).json({ errors: errors.array() });

			const { interventionId } = req.params;
			const { texte } = req.body;

			// validate texte
			if (!texte || texte.trim() === "") {
				return res
					.status(400)
					.json({ error: "Le texte du commentaire est requis" });
			}

			// validate UUID param
			if (!assertUuid(interventionId, res, "interventionId")) return;

			// verify intervention exists
			const exists = await pool.query(
				"SELECT 1 FROM interventions WHERE id=$1",
				[interventionId]
			);
			if (!exists.rows.length)
				return res.status(404).json({ error: "Intervention non trouvée" });

			// insert
			const {
				rows: [comment],
			} = await pool.query(
				`INSERT INTO commentaires_intervention (id, intervention_id, texte, auteur_id, date)
			 VALUES ($1,$2,$3,$4,NOW()) RETURNING *`,
				[uuidv4(), interventionId, texte.trim(), req.user?.id || null]
			);

			res
				.status(201)
				.json({ message: "Commentaire ajouté avec succès", comment });
		} catch (err: any) {
			console.error("Erreur addCommentToIntervention", err);
			res.status(500).json({ error: "Erreur interne du serveur" });
		}
	},

	/* ========================== CREATE =================================== */
	async createIntervention(req: Request, res: Response) {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			(req.files as Express.Multer.File[] | undefined)?.forEach((f) =>
				fs.unlinkSync(f.path)
			);
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

		if (!assertUuid(req.user?.id, res, "created_by")) return;

		if (
			equipeAssignee &&
			(!Array.isArray(equipeAssignee) || !equipeAssignee.every(isUuid))
		) {
			return res
				.status(400)
				.json({ message: "equipeAssignee doit être un tableau d'UUID" });
		}

		const files = req.files as Express.Multer.File[] | undefined;
		const client = await pool.connect();

		try {
			await client.query("BEGIN");
			const interventionId = uuidv4();

			const {
				rows: [intervention],
			} = await client.query(
				`INSERT INTO interventions (id, titre, description, type, adresse, latitude, longitude, statut, priorite, date_creation, date_planification, date_debut, date_fin, cout_estime, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10,$11,$12,$13,$14) RETURNING *`,
				[
					interventionId,
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
					req.user!.id,
				]
			);

			// équipe
			if (equipeAssignee?.length) {
				const values = equipeAssignee
					.map((agentId: string) => `('${interventionId}','${agentId}')`)
					.join(",");
				await client.query(
					`INSERT INTO equipes_intervention (intervention_id, agent_id) VALUES ${values}`
				);
			}

			// documents
			const docs: any[] = [];
			if (files?.length) {
				for (const file of files) {
					const newName = `${uuidv4()}-${file.originalname.replace(
						/\s+/g,
						"_"
					)}`;
					fs.renameSync(
						file.path,
						path.join(UPLOAD_INTERVENTIONS_DIR, newName)
					);
					const docType =
						req.body.parsedData.documentTypes?.[file.originalname] || "autre";

					const {
						rows: [doc],
					} = await client.query(
						`INSERT INTO documents_intervention (id, intervention_id, nom, url, type, date_ajout) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
						[uuidv4(), interventionId, file.originalname, newName, docType]
					);
					docs.push({ ...doc, url: `/uploads/interventions/${newName}` });
				}
			}
			(intervention as any).documents = docs;

			await client.query("COMMIT");
			res.status(201).json(intervention);
		} catch (err: any) {
			await client.query("ROLLBACK");
			files?.forEach((f) => fs.existsSync(f.path) && fs.unlinkSync(f.path));
			console.error("Erreur createIntervention", err);
			res.status(500).json({ message: "Erreur serveur", error: err.message });
		} finally {
			client.release();
		}
	},

	/* ========================== GET ONE ================================== */
	async getInterventionById(req: Request, res: Response) {
		const { interventionId } = req.params;
		if (!assertUuid(interventionId, res, "interventionId")) return;

		try {
			const { rows } = await pool.query(
				`SELECT i.*,  
               (SELECT username FROM users WHERE id = i.created_by) AS createur_username,
               COALESCE(json_agg(DISTINCT jsonb_build_object('id', d.id, 'nom', d.nom, 'url', d.url, 'date_ajout', d.date_ajout) ORDER BY d.date_ajout DESC) FILTER (WHERE d.id IS NOT NULL), '[]') AS documents_files,
               COALESCE(json_agg(DISTINCT jsonb_build_object('id', c.id, 'texte', c.texte, 'date', c.date, 'auteur_id', c.auteur_id, 'auteur_username', u_com.username) ORDER BY c.date DESC) FILTER (WHERE c.id IS NOT NULL), '[]') AS commentaires_list,
               COALESCE(json_agg(DISTINCT jsonb_build_object('id', u_eq.id, 'username', u_eq.username, 'email', u_eq.email)) FILTER (WHERE u_eq.id IS NOT NULL), '[]') AS equipe_assignee_details,
               (
                 SELECT json_build_object('transactionHash', bi.transaction_hash, 'blockNumber', bi.block_number, 'timestamp', bi.timestamp_blockchain, 'documentHash', bi.document_hash)
                 FROM blockchain_interventions bi WHERE bi.intervention_id = i.id ORDER BY bi.created_at DESC LIMIT 1
               ) AS blockchain_info
         FROM interventions i
         LEFT JOIN documents_intervention d ON i.id = d.intervention_id
         LEFT JOIN commentaires_intervention c ON i.id = c.intervention_id
         LEFT JOIN users u_com ON c.auteur_id = u_com.id
         LEFT JOIN equipes_intervention ei ON i.id = ei.intervention_id
         LEFT JOIN users u_eq ON ei.agent_id = u_eq.id
         WHERE i.id = $1 GROUP BY i.id`,
				[interventionId]
			);

			if (!rows.length)
				return res.status(404).json({ message: "Intervention non trouvée" });

			const result = rows[0];
			result.documents = result.documents_files.map((d: any) => ({
				...d,
				url: d.url ? `/uploads/interventions/${d.url}` : null,
			}));
			result.commentaires = result.commentaires_list;
			result.equipeAssignee = result.equipe_assignee_details;
			res.json(result);
		} catch (err: any) {
			console.error("Erreur getInterventionById", err);
			res.status(500).json({ message: "Erreur serveur", error: err.message });
		}
	},

	/* ========================== UPDATE =================================== */
	async updateIntervention(req: Request, res: Response) {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });
		const { interventionId } = req.params;
		if (!assertUuid(interventionId, res, "interventionId")) return;

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

		if (
			equipeAssignee &&
			(!Array.isArray(equipeAssignee) || !equipeAssignee.every(isUuid))
		) {
			return res
				.status(400)
				.json({ message: "equipeAssignee doit être un tableau d'UUID" });
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const { rowCount } = await client.query(
				`UPDATE interventions SET titre=$1, description=$2, type=$3, adresse=$4, latitude=$5, longitude=$6, statut=$7, priorite=$8, date_planification=$9, date_debut=$10, date_fin=$11, cout_estime=$12, updated_at=NOW() WHERE id=$13`,
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
			if (!rowCount) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Intervention non trouvée" });
			}

			await client.query(
				"DELETE FROM equipes_intervention WHERE intervention_id=$1",
				[interventionId]
			);
			if (equipeAssignee?.length) {
				const values = equipeAssignee
					.map((a: string) => `('${interventionId}','${a}')`)
					.join(",");
				await client.query(
					`INSERT INTO equipes_intervention (intervention_id, agent_id) VALUES ${values}`
				);
			}
			await client.query("COMMIT");
			return this.getInterventionById(req, res);
		} catch (err: any) {
			await client.query("ROLLBACK");
			console.error("Erreur updateIntervention", err);
			res.status(500).json({ message: "Erreur serveur", error: err.message });
		} finally {
			client.release();
		}
	},

	/* ========================== DELETE =================================== */
	async deleteIntervention(req: Request, res: Response) {
		const { interventionId } = req.params;
		if (!assertUuid(interventionId, res, "interventionId")) return;

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const docs = await client.query(
				"SELECT url FROM documents_intervention WHERE intervention_id=$1",
				[interventionId]
			);
			docs.rows.forEach((d) => {
				if (d.url) {
					const p = path.join(UPLOAD_INTERVENTIONS_DIR, d.url);
					if (fs.existsSync(p)) fs.unlinkSync(p);
				}
			});

			await client.query(
				"DELETE FROM documents_intervention WHERE intervention_id=$1",
				[interventionId]
			);
			await client.query(
				"DELETE FROM commentaires_intervention WHERE intervention_id=$1",
				[interventionId]
			);
			await client.query(
				"DELETE FROM equipes_intervention WHERE intervention_id=$1",
				[interventionId]
			);
			await client.query(
				"DELETE FROM blockchain_interventions WHERE intervention_id=$1",
				[interventionId]
			);

			const { rowCount } = await client.query(
				"DELETE FROM interventions WHERE id=$1",
				[interventionId]
			);
			if (!rowCount) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Intervention non trouvée" });
			}
			await client.query("COMMIT");
			res.json({ message: "Intervention supprimée avec succès" });
		} catch (err: any) {
			await client.query("ROLLBACK");
			console.error("Erreur deleteIntervention", err);
			res.status(500).json({ message: "Erreur serveur", error: err.message });
		} finally {
			client.release();
		}
	},

	/* ====================== CHANGE STATUS ================================ */
	async changeInterventionStatus(req: Request, res: Response) {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });

		const { interventionId } = req.params;
		if (!assertUuid(interventionId, res, "interventionId")) return;

		const { statut } = req.body;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const { rows } = await client.query(
				"SELECT * FROM interventions WHERE id=$1",
				[interventionId]
			);
			if (!rows.length) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Intervention non trouvée" });
			}
			const intervention = rows[0];

			await client.query(
				"UPDATE interventions SET statut=$1, updated_at=NOW() WHERE id=$2",
				[statut, interventionId]
			);

			if (statut === "validée" && intervention.statut !== "validée") {
				if (!intervention.cout_final) {
					await client.query("ROLLBACK");
					return res
						.status(400)
						.json({ message: "Le coût final doit être défini pour valider." });
				}
				try {
					const bc = await blockchainService.enregistrerIntervention({
						...intervention,
						statut: "validée",
					});
					await client.query(
						"INSERT INTO blockchain_interventions (intervention_id, transaction_hash, block_number, timestamp_blockchain, document_hash, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
						[
							interventionId,
							bc.transactionHash,
							bc.blockNumber,
							bc.timestamp,
							bc.documentHash,
						]
					);
				} catch (bcErr: any) {
					await client.query("ROLLBACK");
					console.error("Erreur blockchain", bcErr);
					return res
						.status(500)
						.json({ message: `Erreur blockchain : ${bcErr.message}` });
				}
			}
			await client.query("COMMIT");
			return this.getInterventionById(req, res);
		} catch (err: any) {
			await client.query("ROLLBACK");
			console.error("Erreur changeInterventionStatus", err);
			res.status(500).json({ message: "Erreur serveur", error: err.message });
		} finally {
			client.release();
		}
	},

	/* ====================== ADD DOCUMENT ================================ */
	async addDocumentToIntervention(req: Request, res: Response) {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			if (req.file) fs.unlinkSync(req.file.path);
			return res.status(400).json({ errors: errors.array() });
		}
		const { interventionId } = req.params;
		if (!assertUuid(interventionId, res, "interventionId")) {
			if (req.file) fs.unlinkSync(req.file.path);
			return;
		}

		if (!req.file) return res.status(400).json({ message: "Aucun fichier" });

		const file = req.file;
		const newName = `${uuidv4()}-${file.originalname.replace(/\s+/g, "_")}`;
		const dest = path.join(UPLOAD_INTERVENTIONS_DIR, newName);

		try {
			fs.renameSync(file.path, dest);
			await pool.query(
				"INSERT INTO documents_intervention (id, intervention_id, nom, url, type, date_ajout) VALUES ($1,$2,$3,$4,$5,NOW())",
				[
					uuidv4(),
					interventionId,
					file.originalname,
					newName,
					req.body.type || "autre",
				]
			);
			return this.getInterventionById(req, res);
		} catch (err: any) {
			fs.existsSync(dest) ? fs.unlinkSync(dest) : fs.unlinkSync(file.path);
			console.error("Erreur addDocumentToIntervention", err);
			res.status(500).json({ message: "Erreur serveur", error: err.message });
		}
	},

	/* ====================== DELETE DOCUMENT ============================= */
	async deleteDocumentFromIntervention(req: Request, res: Response) {
		const { documentId } = req.params;
		if (!assertUuid(documentId, res, "documentId")) return;

		try {
			const { rows } = await pool.query(
				"SELECT url, intervention_id FROM documents_intervention WHERE id=$1",
				[documentId]
			);
			if (!rows.length)
				return res.status(404).json({ message: "Document non trouvé" });

			const doc = rows[0];
			await pool.query("DELETE FROM documents_intervention WHERE id=$1", [
				documentId,
			]);
			const p = path.join(UPLOAD_INTERVENTIONS_DIR, doc.url);
			if (fs.existsSync(p)) fs.unlinkSync(p);
			req.params.interventionId = doc.intervention_id;
			return this.getInterventionById(req, res);
		} catch (err: any) {
			console.error("Erreur deleteDocumentFromIntervention", err);
			res.status(500).json({ message: "Erreur serveur", error: err.message });
		}
	},

	/* ====================== FINALIZE ==================================== */
	async finalizeIntervention(req: Request, res: Response) {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });

		const { interventionId } = req.params;
		if (!assertUuid(interventionId, res, "interventionId")) return;

		const { coutFinal } = req.body;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const { rows } = await client.query(
				"SELECT * FROM interventions WHERE id=$1",
				[interventionId]
			);
			if (!rows.length) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Intervention non trouvée" });
			}
			let intervention = rows[0];

			if (intervention.statut === "validée") {
				await client.query(
					"UPDATE interventions SET cout_final=$1, updated_at=NOW() WHERE id=$2",
					[coutFinal, interventionId]
				);
			} else {
				await client.query(
					"UPDATE interventions SET statut='validée', cout_final=$1, date_validation=NOW(), updated_at=NOW() WHERE id=$2",
					[coutFinal, interventionId]
				);
				intervention = (
					await client.query("SELECT * FROM interventions WHERE id=$1", [
						interventionId,
					])
				).rows[0];
				const bc = await blockchainService.enregistrerIntervention(
					intervention
				);
				await client.query(
					"INSERT INTO blockchain_interventions (intervention_id, transaction_hash, block_number, timestamp_blockchain, document_hash, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
					[
						interventionId,
						bc.transactionHash,
						bc.blockNumber,
						bc.timestamp,
						bc.documentHash,
					]
				);
			}
			await client.query("COMMIT");
			return this.getInterventionById(req, res);
		} catch (err: any) {
			await client.query("ROLLBACK");
			console.error("Erreur finalizeIntervention", err);
			res.status(500).json({ message: "Erreur serveur", error: err.message });
		} finally {
			client.release();
		}
	},

	/* ================ RECORD (manuelle) ON CHAIN ======================== */
	async recordInterventionOnBlockchain(req: Request, res: Response) {
		const { interventionId } = req.params;
		if (!assertUuid(interventionId, res, "interventionId")) return;

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const { rows } = await client.query(
				"SELECT * FROM interventions WHERE id=$1",
				[interventionId]
			);
			if (!rows.length) {
				await client.query("ROLLBACK");
				return res.status(404).json({ message: "Intervention non trouvée" });
			}
			const intervention = rows[0];

			if (!["validée", "terminée"].includes(intervention.statut)) {
				await client.query("ROLLBACK");
				return res
					.status(400)
					.json({ message: "Statut invalide pour enregistrement blockchain" });
			}
			if (intervention.statut === "validée" && !intervention.cout_final) {
				await client.query("ROLLBACK");
				return res
					.status(400)
					.json({ message: "Le coût final doit être défini" });
			}

			const dataHash =
				"0x" +
				crypto
					.createHash("sha256")
					.update(
						JSON.stringify({
							id: intervention.id,
							titre: intervention.titre,
							statut: intervention.statut,
							dateFin: intervention.date_fin,
							coutFinal: intervention.cout_final,
						})
					)
					.digest("hex");

			const existing = await client.query(
				"SELECT 1 FROM blockchain_interventions WHERE intervention_id=$1 AND document_hash=$2 LIMIT 1",
				[interventionId, dataHash]
			);
			if (existing.rows.length) {
				await client.query("ROLLBACK");
				return res
					.status(409)
					.json({ message: "Déjà enregistré sur la blockchain" });
			}

			const bc = await blockchainService.enregistrerIntervention(intervention);
			await client.query(
				"INSERT INTO blockchain_interventions (intervention_id, transaction_hash, block_number, timestamp_blockchain, document_hash, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
				[
					interventionId,
					bc.transactionHash,
					bc.blockNumber,
					bc.timestamp,
					dataHash,
				]
			);
			await client.query("COMMIT");
			return this.getInterventionById(req, res);
		} catch (err: any) {
			await client.query("ROLLBACK");
			console.error("Erreur recordInterventionOnBlockchain", err);
			res.status(500).json({ message: "Erreur serveur", error: err.message });
		} finally {
			client.release();
		}
	},
};

export default interventionsController;
