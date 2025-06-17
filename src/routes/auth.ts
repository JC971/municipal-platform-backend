// src/routes/auth.ts
/*
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

// Base de données simulée d'utilisateurs
const users = [
	{
		id: 1,
		email: "admin@example.com",
		passwordHash: bcrypt.hashSync("admin123", 10),
		role: "admin",
	},
	{
		id: 2,
		email: "user@example.com",
		passwordHash: bcrypt.hashSync("user123", 10),
		role: "user",
	},
];

// Route de connexion sans annotations de type explicites
router.post("/login", (req, res) => {
	const { email, password } = req.body;

	if (!email || !password) {
		return res.status(400).json({ message: "Email et mot de passe requis." });
	}

	const user = users.find((u) => u.email === email);

	if (!user) {
		return res.status(401).json({ message: "Utilisateur non trouvé." });
	}

	bcrypt
		.compare(password, user.passwordHash)
		.then((isPasswordValid) => {
			if (!isPasswordValid) {
				return res.status(401).json({ message: "Mot de passe incorrect." });
			}

			const token = jwt.sign(
				{ id: user.id, email: user.email, role: user.role },
				JWT_SECRET,
				{ expiresIn: "2h" }
			);

			res.json({
				user: {
					id: user.id,
					email: user.email,
					role: user.role,
				},
				token,
			});
		})
		.catch(() => {
			res.status(500).json({ message: "Erreur interne du serveur." });
		});
});

export default router;
*/
/*
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

// Base simulée
const users = [
	{
		id: 1,
		email: "admin@example.com",
		passwordHash: bcrypt.hashSync("admin123", 10),
		role: "admin",
	},
	{
		id: 2,
		email: "user@example.com",
		passwordHash: bcrypt.hashSync("user123", 10),
		role: "user",
	},
];

// ✅ Corrigé pour éviter TS2769
router.post("/login", function (req, res) {
	void (async () => {
		const { email, password } = req.body;


		if (!email || !password) {
			return res.status(400).json({ message: "Email et mot de passe requis." });
		}

		const user = users.find((u) => u.email === email);

		if (!user) {
			return res.status(401).json({ message: "Utilisateur non trouvé." });
		}

		const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

		if (!isPasswordValid) {
			return res.status(401).json({ message: "Mot de passe incorrect." });
		}

		const token = jwt.sign(
			{ id: user.id, email: user.email, role: user.role },
			JWT_SECRET,
			{ expiresIn: "2h" }
		);

		return res.json({
			user: {
				id: user.id,
				email: user.email,
				role: user.role,
			},
			token,
		});
	});
})
export default router;
*/

import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

// Base simulée
const users = [
	{
		id: 1,
		email: "admin@example.com",
		passwordHash: bcrypt.hashSync("admin123", 10),
		role: "admin",
	},
	{
		id: 2,
		email: "user@example.com",
		passwordHash: bcrypt.hashSync("user123", 10),
		role: "user",
	},
];

router.post("/login", async (req, res) => {
	const { email, password } = req.body;

	if (!email || !password) {
		return res.status(400).json({ message: "Email et mot de passe requis." });
	}

	const user = users.find((u) => u.email === email);
	if (!user) {
		return res.status(401).json({ message: "Utilisateur non trouvé." });
	}

	const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
	if (!isPasswordValid) {
		return res.status(401).json({ message: "Mot de passe incorrect." });
	}

	const token = jwt.sign(
		{ id: user.id, email: user.email, role: user.role },
		JWT_SECRET,
		{ expiresIn: "2h" }
	);

	return res.json({
		user: {
			id: user.id,
			email: user.email,
			role: user.role,
		},
		token,
	});
});

export default router;
