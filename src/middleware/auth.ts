import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface DecodedToken {
	id: string;
	email: string;
	role: string;
	username?: string; 
	iat: number;
	exp: number;
}

declare module "express-serve-static-core" {
	interface Request {
		user?: DecodedToken;
	}
}

export const authMiddleware = (
	req: Request,
	res: Response,
	next: NextFunction
) => {
	const header = req.headers["authorization"];
	console.log("🔐 Authorization header :", header);

	if (!header || !header.startsWith("Bearer ")) {
		console.warn("⛔ Aucun token ou format invalide");
		return res.status(401).json({ message: "Accès refusé. Token manquant." });
	}

	const token = header.replace("Bearer ", "").trim();

	try {
		const decoded = jwt.verify(
			token,
			process.env.JWT_SECRET || "supersecret"
		) as DecodedToken;
		req.user = decoded;
		console.log("✅ Token décodé :", decoded);
		next();
	} catch (err) {
		console.error("⛔ Token invalide ou expiré :", err);
		return res.status(401).json({ message: "Token invalide ou expiré." });
	}
};
