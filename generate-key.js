const { Wallet } = require('ethers'); // Make sure you have ethers installed (npm install ethers)

const wallet = Wallet.createRandom();
console.log('New Wallet Address:', wallet.address);
console.log('New Wallet Private Key:', wallet.privateKey);