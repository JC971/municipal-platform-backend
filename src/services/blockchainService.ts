import {
	walletClient,
	publicClient,
	CONTRACT_ADDRESSES,
	CONTRACT_ABIS,
} from "../config/blockchain";
import {
	createPublicClient,
	createWalletClient,
	http,
	parseAbi,
	encodeFunctionData,
} from "viem";
import { polygonMumbai } from "viem/chains";
import crypto from "crypto";

// Service pour les opérations blockchain
const blockchainService = {
	// Fonction générique pour enregistrer un hash sur la blockchain
	async enregistrerHash(
		contractAddress: string,
		contractAbi: any,
		entiteId: string,
		hashData: string,
		metadata: Record<string, any> = {}
	) {
		try {
			// Créer un hash de sécurité
			//const hash = crypto.createHash("sha256").update(hashData).digest("hex");

			// Timestamp actuel
			const timestamp = Math.floor(Date.now() / 1000);

			// Préparer les données pour la transaction
			const functionData = encodeFunctionData({
				abi: contractAbi,
				functionName: "enregistrerDocument",
				args: [entiteId, hashData, timestamp, JSON.stringify(metadata)],
			});

			// Envoyer la transaction
			const hash_tx = await walletClient.sendTransaction({
				to: contractAddress as `0x${string}`,
				data: functionData,
				account: walletClient.account!,
			});

			// Attendre la confirmation de la transaction
			const transactionReceipt = await publicClient.waitForTransactionReceipt({
				hash: hash_tx,
			});

			// Retourner les détails de la transaction
			return {
				success: true,
				transactionHash: hash_tx,
				blockNumber: transactionReceipt.blockNumber,
				timestamp,
				documentHash: hashData,
			};
		} catch (error) {
			console.error(
				"Erreur lors de l'enregistrement sur la blockchain:",
				error
			);
			throw error;
		}
	},

	// Vérifier l'existence d'un hash sur la blockchain
	async verifierHash(
		contractAddress: string,
		contractAbi: any,
		entiteId: string,
		hashData: string
	) {
		try {
			// Créer un hash de sécurité
			const hash = crypto.createHash("sha256").update(hashData).digest("hex");

			// Appeler la fonction de lecture du contrat
			const result = await publicClient.readContract({
				address: contractAddress as `0x${string}`,
				abi: contractAbi,
				functionName: "verifierDocument",
				args: [entiteId, hash],
			});

			return {
				success: true,
				exists: Boolean(result),
				timestamp: Number(result) > 0 ? Number(result) : 0,
			};
		} catch (error) {
			console.error("Erreur lors de la vérification sur la blockchain:", error);
			throw error;
		}
	},

	// Enregistrer une intervention sur la blockchain
	async enregistrerIntervention(intervention: any) {
		const dataToHash = JSON.stringify({
			id: intervention.id,
			titre: intervention.titre,
			description: intervention.description,
			statut: intervention.statut,
			dateCreation: intervention.date_creation,
			coutFinal: intervention.cout_final || 0,
		});

		return this.enregistrerHash(
			CONTRACT_ADDRESSES.INTERVENTIONS,
			CONTRACT_ABIS.INTERVENTIONS,
			intervention.id,
			dataToHash,
			{
				statut: intervention.statut,
				coutFinal: intervention.cout_final || 0,
				dateChangementStatut: new Date().toISOString(),
			}
		);
	},

	// Enregistrer une doléance sur la blockchain
	async enregistrerDoleance(doleance: any) {
		const dataToHash = JSON.stringify({
			id: doleance.id,
			titre: doleance.titre,
			description: doleance.description,
			statut: doleance.statut,
			dateCreation: doleance.date_creation,
		});

		return this.enregistrerHash(
			CONTRACT_ADDRESSES.DOLEANCES,
			CONTRACT_ABIS.DOLEANCES,
			doleance.id,
			dataToHash,
			{
				statut: doleance.statut,
				dateChangementStatut: new Date().toISOString(),
			}
		);
	},
};

export default blockchainService;
