/*
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Configuration de la connexion PostgreSQL
const pool = new Pool({
	user: process.env.DB_USER,
	host: process.env.DB_HOST,
	database: process.env.DB_NAME,
	password: process.env.DB_PASSWORD,
	port: parseInt(process.env.DB_PORT || "5432"),
});

// Test de la connexion
pool.connect((err, client, release) => {
	if (err) {
		return console.error("Erreur de connexion à PostgreSQL:", err);
	}
	console.log("Connexion PostgreSQL établie avec succès");
	client.query("SELECT NOW()", (err, result) => {
		release();
		if (err) {
			return console.error("Erreur lors de l'exécution de la requête:", err);
		}
		console.log("Heure PostgreSQL:", result.rows[0].now);
	});
});

export default pool;
*/
import { Pool, PoolClient, QueryResult } from "pg";
import dotenv from "dotenv";
dotenv.config();
console.log("Mot de passe utilisé :", process.env.DB_PASSWORD);
const pool = new Pool({
	host: process.env.DB_HOST || "localhost",
	user: process.env.DB_USER || "postgres",
	password: process.env.DB_PASSWORD || "postgres",
	database: process.env.DB_NAME || "municipale",
	port: parseInt(process.env.DB_PORT || "5432", 10),
});

pool.connect(
	(
		err: Error | undefined,
		client: PoolClient | undefined,
		release: (release?: unknown) => void
	) => {
		if (err) {
			console.error("❌ Erreur de connexion PostgreSQL :", err);
			return;
		}

		if (!client) {
			console.error("❌ Client PostgreSQL indéfini");
			return;
		}

		client.query(
			"SELECT NOW()",
			(err: Error | undefined, result: QueryResult) => {
				release();

				if (err) {
					console.error("❌ Erreur requête SELECT NOW() :", err.stack);
				} else {
					console.log("✅ Connecté à PostgreSQL :", result.rows[0]);
				}
			}
		);
	}
);

export default pool;
