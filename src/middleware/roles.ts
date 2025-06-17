import { Request, Response, NextFunction } from "express";
import { DecodedToken } from "../types/auth"; 

const checkRole = (roles: string[]) => {
	return (req: Request, res: Response, next: NextFunction) => {
		const user = req.user as DecodedToken | undefined;

		if (!user) {
			return res.status(401).json({ message: "Non autorisé" });
		}

		if (roles.includes(user.role)) {
			next();
		} else {
			res.status(403).json({
				message: "Accès refusé. Vous n'avez pas les droits suffisants.",
			});
		}
	};
};

export default checkRole;
