// src/types/auth.d.ts
// (You might have more properties based on your JWT payload)
export interface DecodedToken {
	id: string; // Assuming user ID is a string
	role: string;
	iat: number;
	exp: number;
	// Add any other properties you expect on the decoded JWT payload
}
/*
export interface AuthRequest extends Express.Request {
    user?: DecodedToken; // Optional user property for authenticated requests
    files?: {
        [fieldname: string]: Express.Multer.File[]; // For file uploads
    };
}*/