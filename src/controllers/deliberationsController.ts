/*import { Request, Response } from "express";
import { validationResult } from "express-validator";
import pool from "../config/database";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { DecodedToken } from "../middleware/auth";


const deliberationsController = {
	// Récupérer toutes les délibérations
	getAll: async (req: Request, res: Response) => {
		try {
			const { texte, dateDebut, dateFin, statut, thematique } = req.query;

			let query = `
        SELECT d.*, 
               COALESCE(json_agg(a) FILTER (WHERE a.id IS NOT NULL), '[]') as annexes
        FROM deliberations d
        LEFT JOIN annexes a ON d.id = a.deliberation_id
      `;

			// Construction des clauses WHERE basées sur les filtres
			const whereConditions = [];
			const queryParams: unknown[] = [];

			if (texte) {
				queryParams.push(`%${texte}%`);
				whereConditions.push(
					`(d.titre ILIKE $${queryParams.length} OR d.description ILIKE $${queryParams.length})`
				);
			}

			if (dateDebut) {
				queryParams.push(dateDebut);
				whereConditions.push(`d.date >= $${queryParams.length}`);
			}

			if (dateFin) {
				queryParams.push(dateFin);
				whereConditions.push(`d.date <= $${queryParams.length}`);
			}

			if (statut) {
				queryParams.push(statut);
				whereConditions.push(`d.statut = $${queryParams.length}`);
			}

			if (thematique) {
				queryParams.push(thematique);
				whereConditions.push(`d.thematique = $${queryParams.length}`);
			}

			// Ajouter les conditions WHERE si nécessaire
			if (whereConditions.length > 0) {
				query += " WHERE " + whereConditions.join(" AND ");
			}

			// Grouper par délibération et trier
			query += `
        GROUP BY d.id
        ORDER BY d.date DESC
      `;

			const result = await pool.query(query, queryParams);

			res.json(result.rows);
		} catch (error) {
			console.error("Erreur lors de la récupération des délibérations:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},

	// Récupérer une délibération par ID
	getById: async (req: Request, res: Response) => {
		try {
			const { id } = req.params;

			const query = `
        SELECT d.*, 
               COALESCE(json_agg(a) FILTER (WHERE a.id IS NOT NULL), '[]') as annexes
        FROM deliberations d
        LEFT JOIN annexes a ON d.id = a.deliberation_id
        WHERE d.id = $1
        GROUP BY d.id
      `;

			const result = await pool.query(query, [id]);

			if (result.rows.length === 0) {
				return res.status(404).json({ message: "Délibération non trouvée" });
			}

			res.json(result.rows[0]);
		} catch (error) {
			console.error(
				"Erreur lors de la récupération de la délibération:",
				error
			);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},

	// Créer une nouvelle délibération
	create: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		try {
			const { titre, description, date, statut, thematique } = JSON.parse(
				req.body.data
			);
			const files = req.files as { [fieldname: string]: Express.Multer.File[] };

			const uploadDir = path.join(__dirname, "../../uploads");
			if (!fs.existsSync(uploadDir)) {
				fs.mkdirSync(uploadDir, { recursive: true });
			}
			const user = req.user as DecodedToken;
			const userId = user.id;
			if (!userId) {
				return res.status(401).json({ message: "Utilisateur non connecté" });
			}
			// Insérer la délibération
			const deliberationResult = await pool.query(
				`INSERT INTO deliberations 
         (titre, description, date, statut, thematique, created_by, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) 
         RETURNING *`,
				[titre, description, date, statut, thematique || null, userId]
			);

			const deliberation = deliberationResult.rows[0];

			// Traiter le fichier PDF principal
			if (files.fichierPdf && files.fichierPdf.length > 0) {
				const pdfFile = files.fichierPdf[0];
				const fileName = `${uuidv4()}-${pdfFile.originalname}`;
				const filePath = path.join(uploadDir, fileName);

				fs.writeFileSync(filePath, pdfFile.buffer);

				// Mettre à jour le chemin du fichier
				await pool.query(
					"UPDATE deliberations SET fichier_pdf_url = $1 WHERE id = $2",
					[`/uploads/${fileName}`, deliberation.id]
				);

				deliberation.fichier_pdf_url = `/uploads/${fileName}`;
			}

			// Traiter les annexes
			const annexes = [];
			if (files.annexes && files.annexes.length > 0) {
				for (const annexe of files.annexes) {
					const fileName = `${uuidv4()}-${annexe.originalname}`;
					const filePath = path.join(uploadDir, fileName);

					fs.writeFileSync(filePath, annexe.buffer);

					// Insérer l'annexe
					const annexeResult = await pool.query(
						`INSERT INTO annexes 
             (deliberation_id, nom, url, type, created_at) 
             VALUES ($1, $2, $3, $4, NOW()) 
             RETURNING *`,
						[
							deliberation.id,
							annexe.originalname,
							`/uploads/${fileName}`,
							annexe.mimetype,
						]
					);

					annexes.push(annexeResult.rows[0]);
				}
			}

			// Retourner la délibération avec ses annexes
			deliberation.annexes = annexes;

			res.status(201).json(deliberation);
		} catch (error) {
			console.error("Erreur lors de la création de la délibération:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},

	// Mettre à jour une délibération
	update: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		const { id } = req.params;

		try {
			// Vérifier si la délibération existe
			const checkResult = await pool.query(
				"SELECT * FROM deliberations WHERE id = $1",
				[id]
			);

			if (checkResult.rows.length === 0) {
				return res.status(404).json({ message: "Délibération non trouvée" });
			}

			const { titre, description, date, statut, thematique } = JSON.parse(
				req.body.data
			);
			const files = req.files as { [fieldname: string]: Express.Multer.File[] };

			// Mettre à jour la délibération
			const updateResult = await pool.query(
				`UPDATE deliberations 
         SET titre = $1, description = $2, date = $3, statut = $4, thematique = $5, updated_at = NOW() 
         WHERE id = $6 
         RETURNING *`,
				[titre, description, date, statut, thematique || null, id]
			);

			const deliberation = updateResult.rows[0];

			const uploadDir = path.join(__dirname, "../../uploads");

			// Traiter le fichier PDF principal s'il est fourni
			if (files.fichierPdf && files.fichierPdf.length > 0) {
				const pdfFile = files.fichierPdf[0];
				const fileName = `${uuidv4()}-${pdfFile.originalname}`;
				const filePath = path.join(uploadDir, fileName);

				// Supprimer l'ancien fichier si existant
				if (deliberation.fichier_pdf_url) {
					const oldPath = path.join(
						__dirname,
						"../../",
						deliberation.fichier_pdf_url
					);
					if (fs.existsSync(oldPath)) {
						fs.unlinkSync(oldPath);
					}
				}

				fs.writeFileSync(filePath, pdfFile.buffer);

				// Mettre à jour le chemin du fichier
				await pool.query(
					"UPDATE deliberations SET fichier_pdf_url = $1 WHERE id = $2",
					[`/uploads/${fileName}`, id]
				);

				deliberation.fichier_pdf_url = `/uploads/${fileName}`;
			}

			// Traiter les nouvelles annexes
			if (files.annexes && files.annexes.length > 0) {
				for (const annexe of files.annexes) {
					const fileName = `${uuidv4()}-${annexe.originalname}`;
					const filePath = path.join(uploadDir, fileName);

					fs.writeFileSync(filePath, annexe.buffer);

					// Insérer l'annexe
					await pool.query(
						`INSERT INTO annexes 
             (deliberation_id, nom, url, type, created_at) 
             VALUES ($1, $2, $3, $4, NOW())`,
						[id, annexe.originalname, `/uploads/${fileName}`, annexe.mimetype]
					);
				}
			}

			// Récupérer la délibération mise à jour avec les annexes
			const result = await pool.query(
				`
        SELECT d.*, 
               COALESCE(json_agg(a) FILTER (WHERE a.id IS NOT NULL), '[]') as annexes
        FROM deliberations d
        LEFT JOIN annexes a ON d.id = a.deliberation_id
        WHERE d.id = $1
        GROUP BY d.id
      `,
				[id]
			);

			res.json(result.rows[0]);
		} catch (error) {
			console.error("Erreur lors de la mise à jour de la délibération:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},

	// Supprimer une délibération
	delete: async (req: Request, res: Response) => {
		const { id } = req.params;

		try {
			// Vérifier si la délibération existe
			const checkResult = await pool.query(
				"SELECT * FROM deliberations WHERE id = $1",
				[id]
			);

			if (checkResult.rows.length === 0) {
				return res.status(404).json({ message: "Délibération non trouvée" });
			}

			const deliberation = checkResult.rows[0];

			// Récupérer les annexes
			const annexesResult = await pool.query(
				"SELECT * FROM annexes WHERE deliberation_id = $1",
				[id]
			);

			// Supprimer les fichiers physiques
			if (deliberation.fichier_pdf_url) {
				const pdfPath = path.join(
					__dirname,
					"../../",
					deliberation.fichier_pdf_url
				);
				if (fs.existsSync(pdfPath)) {
					fs.unlinkSync(pdfPath);
				}
			}

			for (const annexe of annexesResult.rows) {
				if (annexe.url) {
					const annexePath = path.join(__dirname, "../../", annexe.url);
					if (fs.existsSync(annexePath)) {
						fs.unlinkSync(annexePath);
					}
				}
			}

			// Supprimer les annexes de la base de données
			await pool.query("DELETE FROM annexes WHERE deliberation_id = $1", [id]);

			// Supprimer la délibération
			await pool.query("DELETE FROM deliberations WHERE id = $1", [id]);

			res.json({ message: "Délibération supprimée avec succès" });
		} catch (error) {
			console.error("Erreur lors de la suppression de la délibération:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},

	// Publier une délibération
	publier: async (req: Request, res: Response) => {
		const { id } = req.params;

		try {
			// Vérifier si la délibération existe
			const checkResult = await pool.query(
				"SELECT * FROM deliberations WHERE id = $1",
				[id]
			);

			if (checkResult.rows.length === 0) {
				return res.status(404).json({ message: "Délibération non trouvée" });
			}

			// Mettre à jour le statut
			await pool.query(
				`UPDATE deliberations 
				 SET statut = $1, updated_at = NOW() 
				 WHERE id = $2`,
				["publié", id]
			);
			  

			// Récupérer la délibération mise à jour avec les annexes
			const result = await pool.query(
				`
        SELECT d.*, 
               COALESCE(json_agg(a) FILTER (WHERE a.id IS NOT NULL), '[]') as annexes
        FROM deliberations d
        LEFT JOIN annexes a ON d.id = a.deliberation_id
        WHERE d.id = $1
        GROUP BY d.id
      `,
				[id]
			);

			res.json(result.rows[0]);
		} catch (error) {
			console.error("Erreur lors de la publication de la délibération:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
};

export default deliberationsController;
*/
import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import pool from "../config/database";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { DecodedToken } from "../middleware/auth";

/* -------------------------------------------------------------------------- */
/*  Constants & helpers                                                       */
/* -------------------------------------------------------------------------- */

const UPLOAD_DIR = path.join(__dirname, "../../uploads/deliberations");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const STATUTS = ["brouillon", "publié"] as const;

const parseIntOr = (val: unknown, fallback: number) => {
	const n = Number(val);
	return Number.isFinite(n) && n > 0 ? n : fallback;
};

const safeUnlink = (filePath: string) => {
	try {
		if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
	} catch (_) {
		/* ignore */
	}
};

/* -------------------------------------------------------------------------- */
/*  Controller                                                                */
/* -------------------------------------------------------------------------- */

const deliberationsController = {
	/* ----------------------------- GET / ------------------------------------ */
	async getAll(req: Request, res: Response, next: NextFunction) {
		try {
			const page = parseIntOr(req.query.page, 1);
			const limit = Math.min(100, parseIntOr(req.query.limit, 10));
			const offset = (page - 1) * limit;

			const { texte, dateDebut, dateFin, statut, thematique } = req.query;
			const filters: string[] = [];
			const params: unknown[] = [];

			if (texte) {
				params.push(`%${texte}%`);
				filters.push(
					`(d.titre ILIKE $${params.length} OR d.description ILIKE $${params.length})`
				);
			}
			if (dateDebut) {
				params.push(dateDebut);
				filters.push(`d.date >= $${params.length}`);
			}
			if (dateFin) {
				params.push(dateFin);
				filters.push(`d.date <= $${params.length}`);
			}
			if (statut) {
				if (!STATUTS.includes(statut as any))
					return res
						.status(400)
						.json({ message: `Statut invalide (${statut}).` });
				params.push(statut);
				filters.push(`d.statut = $${params.length}`);
			}
			if (thematique) {
				params.push(thematique);
				filters.push(`d.thematique = $${params.length}`);
			}

			const whereSQL = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

			const totalSQL = `SELECT COUNT(*) FROM deliberations d ${whereSQL}`;
			const total = Number((await pool.query(totalSQL, params)).rows[0].count);

			const rowsSQL = `
        SELECT d.*, COALESCE(json_agg(a) FILTER (WHERE a.id IS NOT NULL), '[]') AS annexes
        FROM deliberations d
        LEFT JOIN annexes a ON d.id = a.deliberation_id
        ${whereSQL}
        GROUP BY d.id
        ORDER BY d.date DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

			const rows = (await pool.query(rowsSQL, [...params, limit, offset])).rows;
			return res.json({ total, page, limit, rows });
		} catch (err) {
			next(err);
		}
	},

	/* ----------------------------- GET /:id --------------------------------- */
	async getById(req: Request, res: Response, next: NextFunction) {
		try {
			const { id } = req.params;
			const sql = `
        SELECT d.*, COALESCE(json_agg(a) FILTER (WHERE a.id IS NOT NULL), '[]') AS annexes
        FROM deliberations d
        LEFT JOIN annexes a ON d.id = a.deliberation_id
        WHERE d.id = $1
        GROUP BY d.id`;
			const result = await pool.query(sql, [id]);
			if (!result.rows.length)
				return res.status(404).json({ message: "Délibération non trouvée" });
			return res.json(result.rows[0]);
		} catch (err) {
			next(err);
		}
	},

	/* ----------------------------- POST / ----------------------------------- */
	async create(req: Request, res: Response, next: NextFunction) {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });

		try {
		    const body = req.body.data ? JSON.parse(req.body.data) : req.body;

				const { titre, description, date, statut, thematique } = body;
				if (!STATUTS.includes(statut))
					return res.status(400).json({ message: "Statut invalide" });

			const files = req.files as Record<string, Express.Multer.File[]>;
			const user = req.user as DecodedToken;
			if (!user?.id)
				return res.status(401).json({ message: "Utilisateur non connecté" });

			const insert = await pool.query(
				`INSERT INTO deliberations (titre, description, date, statut, thematique, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
				[titre, description, date, statut, thematique ?? null, user.id]
			);
			const deliberation = insert.rows[0];

			/* PDF principal */
			if (files?.fichierPdf?.length) {
				const pdf = files.fichierPdf[0];
				const filename = `${uuid()}-${pdf.originalname.replace(/\s+/g, "_")}`;
				fs.writeFileSync(path.join(UPLOAD_DIR, filename), pdf.buffer);
				await pool.query(
					"UPDATE deliberations SET fichier_pdf_url=$1 WHERE id=$2",
					[`/uploads/deliberations/${filename}`, deliberation.id]
				);
				deliberation.fichier_pdf_url = `/uploads/deliberations/${filename}`;
			}

			/* Annexes */
			const annexes: any[] = [];
			if (files?.annexes?.length) {
				for (const a of files.annexes) {
					const filename = `${uuid()}-${a.originalname.replace(/\s+/g, "_")}`;
					fs.writeFileSync(path.join(UPLOAD_DIR, filename), a.buffer);
					const resA = await pool.query(
						`INSERT INTO annexes (deliberation_id, nom, url, type, created_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING *`,
						[
							deliberation.id,
							a.originalname,
							`/uploads/deliberations/${filename}`,
							a.mimetype,
						]
					);
					annexes.push(resA.rows[0]);
				}
			}
			deliberation.annexes = annexes;

			return res.status(201).json(deliberation);
		} catch (err) {
			next(err);
		}
	},

	/* ----------------------------- PUT /:id --------------------------------- */
	async update(req: Request, res: Response, next: NextFunction) {
		const errors = validationResult(req);
		if (!errors.isEmpty())
			return res.status(400).json({ errors: errors.array() });

		const { id } = req.params;
		try {
			const existing = await pool.query(
				"SELECT * FROM deliberations WHERE id=$1",
				[id]
			);
			if (!existing.rows.length)
				return res.status(404).json({ message: "Délibération non trouvée" });

			const { titre, description, date, statut, thematique } = JSON.parse(
				req.body.data
			);
			await pool.query(
				`UPDATE deliberations SET titre=$1, description=$2, date=$3, statut=$4, thematique=$5, updated_at=NOW() WHERE id=$6`,
				[titre, description, date, statut, thematique ?? null, id]
			);

			const files = req.files as Record<string, Express.Multer.File[]>;

			if (files?.fichierPdf?.length) {
				const pdf = files.fichierPdf[0];
				const filename = `${uuid()}-${pdf.originalname.replace(/\s+/g, "_")}`;
				fs.writeFileSync(path.join(UPLOAD_DIR, filename), pdf.buffer);
				await pool.query(
					"UPDATE deliberations SET fichier_pdf_url=$1 WHERE id=$2",
					[`/uploads/deliberations/${filename}`, id]
				);
			}

			if (files?.annexes?.length) {
				for (const a of files.annexes) {
					const filename = `${uuid()}-${a.originalname.replace(/\s+/g, "_")}`;
					fs.writeFileSync(path.join(UPLOAD_DIR, filename), a.buffer);
					await pool.query(
						`INSERT INTO annexes (deliberation_id, nom, url, type, created_at) VALUES ($1,$2,$3,$4,NOW())`,
						[
							id,
							a.originalname,
							`/uploads/deliberations/${filename}`,
							a.mimetype,
						]
					);
				}
			}

			/* Refresh */
			const refreshed = await pool.query(
				`SELECT d.*, COALESCE(json_agg(a) FILTER (WHERE a.id IS NOT NULL), '[]') AS annexes
         FROM deliberations d
         LEFT JOIN annexes a ON d.id=a.deliberation_id
         WHERE d.id=$1 GROUP BY d.id`,
				[id]
			);
			return res.json(refreshed.rows[0]);
		} catch (err) {
			next(err);
		}
	},

	/* ----------------------------- DELETE /:id ------------------------------ */
	async delete(req: Request, res: Response, next: NextFunction) {
		const { id } = req.params;
		try {
			const check = await pool.query(
				"SELECT * FROM deliberations WHERE id=$1",
				[id]
			);
			if (!check.rows.length)
				return res.status(404).json({ message: "Délibération non trouvée" });
			const delib = check.rows[0];

			safeUnlink(path.join(__dirname, "../../", delib.fichier_pdf_url || ""));

			const ann = await pool.query(
				"SELECT url FROM annexes WHERE deliberation_id=$1",
				[id]
			);
			for (const a of ann.rows)
				safeUnlink(path.join(__dirname, "../../", a.url));
			await pool.query("DELETE FROM annexes WHERE deliberation_id=$1", [id]);
			await pool.query("DELETE FROM deliberations WHERE id=$1", [id]);

			return res.json({ message: "Délibération supprimée avec succès" });
		} catch (err) {
			next(err);
		}
	},

	/* ----------------------------- POST /:id/publier ------------------------ */
	async publier(req: Request, res: Response, next: NextFunction) {
		const { id } = req.params;
		try {
			const check = await pool.query(
				"SELECT * FROM deliberations WHERE id=$1",
				[id]
			);
			if (!check.rows.length)
				return res.status(404).json({ message: "Délibération non trouvée" });
			await pool.query(
				"UPDATE deliberations SET statut='publié', updated_at=NOW() WHERE id=$1",
				[id]
			);

			const refreshed = await pool.query(
				`SELECT d.*, COALESCE(json_agg(a) FILTER (WHERE a.id IS NOT NULL), '[]') AS annexes
         FROM deliberations d
         LEFT JOIN annexes a ON d.id = a.deliberation_id
         WHERE d.id=$1 GROUP BY d.id`,
				[id]
			);
			return res.json(refreshed.rows[0]);
		} catch (err) {
			next(err);
		}
	},
};

export default deliberationsController;

