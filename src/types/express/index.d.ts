
import { DecodedToken } from "../auth"; // Keep this import for DecodedToken type

// On fusionne proprement avec Express
declare global {
    namespace Express {
        interface Request {
            user?: DecodedToken; // Now TypeScript will know about req.user
            files?: {
                [fieldname: string]: import("multer").File[]; // Use import("multer").File for Multer.File if Multer isn't globally available
            };
        }
    }
}

// You no longer need `export type { DecodedToken };` here.
// If DecodedToken needs to be exported, it should be exported from its own `../auth.ts` file.