import { Request, Response } from "express";
import { validationResult } from "express-validator";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../config/database";

const authController = {
	// Inscription d'un nouvel utilisateur
	register: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		const { username, email, password, role } = req.body;

		try {
			
			// Vérifier si l'utilisateur existe déjà
			const userCheck = await pool.query(
				"SELECT * FROM users WHERE email = $1",
				[email]
			); 

			if (userCheck.rows.length > 0) {
				return res.status(400).json({ message: "L'utilisateur existe déjà" });
			}

			// Hacher le mot de passe
			const salt = await bcrypt.genSalt(10);
			const hashedPassword = await bcrypt.hash(password, salt);

			// Insérer l'utilisateur dans la base de données
			const result = await pool.query(
				"INSERT INTO users (username, email, password, role, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, username, email, role",
				[username, email, hashedPassword, role || "user"]
			);

			const user = result.rows[0];

			// Générer un JWT
			const token = jwt.sign(
				{ id: user.id, role: user.role },
				process.env.JWT_SECRET || "municipalplatformsecret",
				{ expiresIn: "24h" }
			);

			res.status(201).json({
				success: true,
				token,
				user: {
					id: user.id,
					username: user.username,
					email: user.email,
					role: user.role,
				},
			});
		} catch (error) {
			console.error("Erreur lors de l'inscription:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},

	// Connexion utilisateur
	login: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		const { email, password } = req.body;

		try {
			// Vérifier si l'utilisateur existe
			const result = await pool.query("SELECT * FROM users WHERE email = $1", [
				email,
			]);

			if (result.rows.length === 0) {
				return res.status(400).json({ message: "Identifiants invalides" });
			}

			const user = result.rows[0];

			// Vérifier le mot de passe
			const isMatch = await bcrypt.compare(password, user.password);

			if (!isMatch) {
				return res.status(400).json({ message: "Identifiants invalides" });
			}

			// Générer un JWT
			const token = jwt.sign(
				{ id: user.id, role: user.role },
				process.env.JWT_SECRET || "municipalplatformsecret",
				{ expiresIn: "24h" }
			);

			res.json({
				success: true,
				token,
				user: {
					id: user.id,
					username: user.username,
					email: user.email,
					role: user.role,
				},
			});
		} catch (error) {
			console.error("Erreur lors de la connexion:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},

	// Obtenir les informations de l'utilisateur connecté
	getUser: async (req: Request, res: Response) => {
		try {
			const userId = req.user.id;

			const result = await pool.query(
				"SELECT id, username, email, role FROM users WHERE id = $1",
				[userId]
			);

			if (result.rows.length === 0) {
				return res.status(404).json({ message: "Utilisateur non trouvé" });
			}

			res.json({
				success: true,
				user: result.rows[0],
			});
		} catch (error) {
			console.error("Erreur lors de la récupération de l'utilisateur:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},

	// Mettre à jour le profil utilisateur
	updateProfile: async (req: Request, res: Response) => {
		const { username, email } = req.body;
		const userId = req.user.id;

		try {
			// Vérifier si l'email est déjà utilisé par un autre utilisateur
			if (email) {
				const emailCheck = await pool.query(
					"SELECT id FROM users WHERE email = $1 AND id != $2",
					[email, userId]
				);

				if (emailCheck.rows.length > 0) {
					return res
						.status(400)
						.json({ message: "Cet email est déjà utilisé" });
				}
			}

			let query = "UPDATE users SET ";
			const queryParams = [];
			let paramCounter = 1;

			if (username) {
				query += `username = $${paramCounter}, `;
				queryParams.push(username);
				paramCounter++;
			}

			if (email) {
				query += `email = $${paramCounter}, `;
				queryParams.push(email);
				paramCounter++;
			}

			// Supprimer la virgule finale et ajouter la condition WHERE
			query =
				query.slice(0, -2) +
				` WHERE id = $${paramCounter} RETURNING id, username, email, role`;
			queryParams.push(userId);

			const result = await pool.query(query, queryParams);

			res.json({
				success: true,
				user: result.rows[0],
			});
		} catch (error) {
			console.error("Erreur lors de la mise à jour du profil:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},

	// Changer le mot de passe
	changePassword: async (req: Request, res: Response) => {
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ errors: errors.array() });
		}

		const { currentPassword, newPassword } = req.body;
		const userId = req.user.id;

		try {
			// Vérifier le mot de passe actuel
			const userResult = await pool.query(
				"SELECT password FROM users WHERE id = $1",
				[userId]
			);

			if (userResult.rows.length === 0) {
				return res.status(404).json({ message: "Utilisateur non trouvé" });
			}

			const isMatch = await bcrypt.compare(
				currentPassword,
				userResult.rows[0].password
			);

			if (!isMatch) {
				return res
					.status(400)
					.json({ message: "Mot de passe actuel incorrect" });
			}

			// Hasher le nouveau mot de passe
			const salt = await bcrypt.genSalt(10);
			const hashedPassword = await bcrypt.hash(newPassword, salt);

			// Mettre à jour le mot de passe
			await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
				hashedPassword,
				userId,
			]);

			res.json({
				success: true,
				message: "Mot de passe changé avec succès",
			});
		} catch (error) {
			console.error("Erreur lors du changement de mot de passe:", error);
			res.status(500).json({ message: "Erreur serveur" });
		}
	},
};

export default authController;

