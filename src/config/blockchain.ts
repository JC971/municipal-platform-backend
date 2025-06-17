import dotenv from "dotenv";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from 'viem/chains'; // Import the sepolia chain definition

dotenv.config();

const privateKey = process.env.BLOCKCHAIN_PRIVATE_KEY as `0x${string}`;

if (!privateKey) {
	throw new Error("La clé privée pour la blockchain n'est pas configurée.");
}


// Configuration de la connexion à la blockchain
{/*const RPC_URL = process.env.RPC_URL || "https://rpc-mumbai.maticvigil.com";*/ }


// Vérification des variables d'environnement essentielles
if (!privateKey) {
	console.error(
		"ERREUR: La clé privée pour la blockchain n'est pas configurée."
	);
	process.exit(1);
}

// Création du compte à partir de la clé privée
const account = privateKeyToAccount(privateKey);

// Client public pour lire des données
export const publicClient = createPublicClient({
	chain: sepolia, // Use the imported sepolia chain
	transport: http(process.env.SEPOLIA_RPC_URL), // Ensure this env var exists
});

// Client wallet pour signer et envoyer des transactions
export const walletClient = createWalletClient({
	account,
	chain: sepolia, // Use the imported sepolia chain
	transport: http(process.env.SEPOLIA_RPC_URL), // Ensure this env var exists
});

// Adresses des contrats
export const CONTRACT_ADDRESSES = {
	INTERVENTIONS: process.env.INTERVENTIONS_CONTRACT_ADDRESS || "0x...",
	DOLEANCES: process.env.DOLEANCES_CONTRACT_ADDRESS || "0x...",
};

// ABIs des contrats (à définir)
export const CONTRACT_ABIS = {
	INTERVENTIONS: [],
	DOLEANCES: [],
};

export default {
	publicClient,
	walletClient,
	account,
	CONTRACT_ADDRESSES,
	CONTRACT_ABIS,
};
