import multer from "multer";
import { Request } from "express";

// Configuration du stockage en mémoire
const storage = multer.memoryStorage();

// Filtrer les types de fichiers
const fileFilter = (
	req: Request,
	file: Express.Multer.File,
	cb: multer.FileFilterCallback
) => {
	// Accepter les PDF et les images
	if (
		file.mimetype === "application/pdf" ||
		file.mimetype === "image/jpeg" ||
		file.mimetype === "image/png" ||
		file.mimetype === "application/msword" ||
		file.mimetype ===
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
		file.mimetype === "application/vnd.ms-excel" ||
		file.mimetype ===
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	) {
		cb(null, true);
	} else {
		cb(
			new Error(
				"Format de fichier non supporté. Veuillez télécharger un fichier PDF, image, Word ou Excel."
			)
		);
	}
};

// Configuration de multer
const upload = multer({
	storage: storage,
	fileFilter: fileFilter,
	limits: {
		fileSize: 10 * 1024 * 1024, // 10MB limite de taille
	},
});

export default upload;
